import { randomUUID } from "node:crypto";
import type { DbClient } from "@/lib/db";
import type { DiscoveryTransport } from "@/modules/api-intelligence/discovery/fetcher";
import { DiscoveryError } from "@/modules/api-intelligence/discovery/errors";
import { fetchApprovedApiSource } from "@/modules/api-intelligence/discovery/service";
import {
  claimApiSourceRecheckSchedule,
  listDueApiSourceRecheckSchedules,
  markApiSourceRecheckBlocked,
  markApiSourceRecheckRetrying,
  markApiSourceRecheckSucceeded,
  requeueStaleApiSourceRechecks,
} from "@/modules/api-intelligence/discovery/recheck/repository";
import { PlatformAdminError } from "@/modules/platform-admin/errors";
import { RateLimitError } from "@/modules/rate-limit/errors";
import { TenantError } from "@/modules/tenants/errors";

export type ApiSourceRecheckWorkerOptions = {
  limit?: number;
  now?: Date;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  processingTimeoutMs?: number;
  transport?: DiscoveryTransport;
};

export type ApiSourceRecheckSummary = {
  selected: number;
  processed: number;
  succeeded: number;
  retried: number;
  blocked: number;
  skipped: number;
  requeued: number;
};

const defaultLimit = 3;
const defaultBaseBackoffMs = 60_000;
const defaultMaxBackoffMs = 6 * 60 * 60 * 1_000;
const defaultProcessingTimeoutMs = 5 * 60 * 1_000;

export async function processDueApiSourceRechecks(
  db: DbClient,
  options: ApiSourceRecheckWorkerOptions = {},
): Promise<ApiSourceRecheckSummary> {
  const now = options.now ?? new Date();
  const nowValue = now.toISOString();
  const limit = positiveInteger(options.limit, defaultLimit);
  const baseBackoffMs = positiveInteger(
    options.baseBackoffMs,
    defaultBaseBackoffMs,
  );
  const maxBackoffMs = positiveInteger(
    options.maxBackoffMs,
    defaultMaxBackoffMs,
  );
  const processingTimeoutMs = positiveInteger(
    options.processingTimeoutMs,
    defaultProcessingTimeoutMs,
  );
  const summary: ApiSourceRecheckSummary = {
    selected: 0,
    processed: 0,
    succeeded: 0,
    retried: 0,
    blocked: 0,
    skipped: 0,
    requeued: 0,
  };

  const staleBefore = new Date(
    now.getTime() - processingTimeoutMs,
  ).toISOString();
  summary.requeued = await requeueStaleApiSourceRechecks(db, {
    staleBefore,
    retryAt: new Date(now.getTime() + baseBackoffMs).toISOString(),
    now: nowValue,
  });

  const due = await listDueApiSourceRecheckSchedules(db, nowValue, limit);
  summary.selected = due.length;

  for (const candidate of due) {
    const leaseId = randomUUID();
    const schedule = await claimApiSourceRecheckSchedule(db, {
      scheduleId: candidate.id,
      leaseId,
      now: nowValue,
    });
    if (!schedule) {
      summary.skipped += 1;
      continue;
    }
    summary.processed += 1;

    try {
      await fetchApprovedApiSource(
        db,
        schedule.configured_by,
        schedule.context_tenant_id,
        schedule.source_id,
        { transport: options.transport },
      );
      const nextRunAt = new Date(
        now.getTime() + schedule.interval_seconds * 1_000,
      ).toISOString();
      if (
        await markApiSourceRecheckSucceeded(db, {
          scheduleId: schedule.id,
          leaseId,
          nextRunAt,
          now: nowValue,
        })
      ) {
        summary.succeeded += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      const failure = classifyRecheckFailure(error);
      if (failure.blocked) {
        if (
          await markApiSourceRecheckBlocked(db, {
            scheduleId: schedule.id,
            leaseId,
            errorCode: failure.code,
            now: nowValue,
          })
        ) {
          summary.blocked += 1;
        } else {
          summary.skipped += 1;
        }
        continue;
      }

      const retryDelayMs = retryDelay(
        schedule.consecutive_failures,
        baseBackoffMs,
        maxBackoffMs,
        failure.retryAfterMs,
      );
      if (
        await markApiSourceRecheckRetrying(db, {
          scheduleId: schedule.id,
          leaseId,
          nextRunAt: new Date(now.getTime() + retryDelayMs).toISOString(),
          errorCode: failure.code,
          now: nowValue,
        })
      ) {
        summary.retried += 1;
      } else {
        summary.skipped += 1;
      }
    }
  }

  return summary;
}

function classifyRecheckFailure(error: unknown) {
  if (error instanceof PlatformAdminError) {
    return { code: error.code, blocked: true, retryAfterMs: 0 };
  }
  if (error instanceof TenantError) {
    return { code: error.code, blocked: true, retryAfterMs: 0 };
  }
  if (error instanceof RateLimitError) {
    return {
      code: error.code,
      blocked: false,
      retryAfterMs: error.retryAfterSeconds * 1_000,
    };
  }
  if (error instanceof DiscoveryError) {
    return {
      code: error.code,
      blocked: permanentDiscoveryErrors.has(error.code),
      retryAfterMs: 0,
    };
  }
  return { code: "recheck_failed", blocked: false, retryAfterMs: 0 };
}

const permanentDiscoveryErrors = new Set<DiscoveryError["code"]>([
  "source_not_found",
  "source_not_official",
  "domain_not_approved",
  "url_not_allowed",
  "private_address_blocked",
  "robots_denied",
  "redirect_blocked",
  "response_too_large",
  "unsupported_encoding",
  "not_modified_without_snapshot",
]);

function retryDelay(
  previousFailures: number,
  baseBackoffMs: number,
  maxBackoffMs: number,
  retryAfterMs: number,
) {
  const exponential = Math.min(
    maxBackoffMs,
    baseBackoffMs * 2 ** Math.min(previousFailures, 10),
  );
  return Math.max(exponential, retryAfterMs);
}

function positiveInteger(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}
