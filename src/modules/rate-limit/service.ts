import { createHash } from "node:crypto";
import type { DbClient } from "@/lib/db";
import { id } from "@/lib/security";
import { RateLimitError } from "@/modules/rate-limit/errors";

export type RateLimitInput = {
  operationKey: string;
  subjectKey: string;
  scopeKey?: string;
  limit: number;
  windowSeconds: number;
  now?: Date;
};

export type RateLimitDecision = {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
};

export type RateLimiter = {
  consume: (input: RateLimitInput) => Promise<RateLimitDecision>;
  cleanup?: (input?: { before?: Date; limit?: number }) => Promise<number>;
};

export const rateLimitPolicies = {
  registration: { limit: 5, windowSeconds: 60 * 60 },
  login: { limit: 10, windowSeconds: 15 * 60 },
  passwordReset: { limit: 5, windowSeconds: 60 * 60 },
  invitationCreate: { limit: 10, windowSeconds: 60 * 60 },
  invitationAccept: { limit: 10, windowSeconds: 15 * 60 },
  publicForm: { limit: 10, windowSeconds: 60 },
  publicDemo: { limit: 20, windowSeconds: 60 * 60 },
  inboundWebhook: { limit: 60, windowSeconds: 60 },
} as const;

export function createDatabaseRateLimiter(db: DbClient): RateLimiter {
  return {
    consume: (input) => consumeDatabaseRateLimit(db, input),
    cleanup: (input) => cleanupDatabaseRateLimits(db, input),
  };
}

export function createMemoryRateLimiter(options: { now?: () => Date } = {}): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const clock = options.now ?? (() => new Date());

  return {
    async consume(input) {
      const now = input.now ?? clock();
      const nowMs = now.getTime();
      const key = buildRateLimitKey(input);
      const current = buckets.get(key);
      const resetAt =
        !current || current.resetAt <= nowMs
          ? nowMs + validWindowSeconds(input.windowSeconds) * 1000
          : current.resetAt;
      const count = !current || current.resetAt <= nowMs ? 1 : current.count + 1;
      buckets.set(key, { count, resetAt });

      return decision(count, validLimit(input.limit), resetAt, nowMs);
    },
    async cleanup(input = {}) {
      const before = input.before ?? clock();
      const limit = validBatchLimit(input.limit);
      let deleted = 0;

      for (const [key, bucket] of buckets) {
        if (deleted >= limit) break;
        if (bucket.resetAt <= before.getTime()) {
          buckets.delete(key);
          deleted += 1;
        }
      }

      return deleted;
    },
  };
}

export async function enforceRateLimit(
  db: DbClient,
  input: RateLimitInput,
  limiter: RateLimiter = createDatabaseRateLimiter(db),
) {
  const result = await limiter.consume(input);
  if (!result.allowed) {
    throw new RateLimitError(result.retryAfterSeconds);
  }

  return result;
}

export function buildRateLimitKey(input: Pick<RateLimitInput, "operationKey" | "subjectKey" | "scopeKey">) {
  return digest(
    [
      normalizeOperation(input.operationKey),
      digest(input.scopeKey?.trim() || "global"),
      digest(input.subjectKey.trim()),
    ].join(":"),
  );
}

async function consumeDatabaseRateLimit(
  db: DbClient,
  input: RateLimitInput,
): Promise<RateLimitDecision> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const limit = validLimit(input.limit);
  const resetAt = new Date(
    nowMs + validWindowSeconds(input.windowSeconds) * 1000,
  ).toISOString();
  const operationKey = normalizeOperation(input.operationKey);
  const subjectHash = digest(input.subjectKey.trim());
  const scopeHash = digest(input.scopeKey?.trim() || "global");
  const key = buildRateLimitKey(input);
  const result = await db.query<{ count: number | string; reset_at: string }>(
    `insert into rate_limits (
       id,
       key,
       operation_key,
       subject_hash,
       scope_hash,
       count,
       reset_at,
       created_at,
       updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (key) do update
     set operation_key = excluded.operation_key,
         subject_hash = excluded.subject_hash,
         scope_hash = excluded.scope_hash,
         count = case
           when rate_limits.reset_at <= excluded.updated_at then 1
           else rate_limits.count + 1
         end,
         reset_at = case
           when rate_limits.reset_at <= excluded.updated_at then excluded.reset_at
           else rate_limits.reset_at
         end,
         updated_at = excluded.updated_at
     returning count, reset_at`,
    [
      id("rate"),
      key,
      operationKey,
      subjectHash,
      scopeHash,
      1,
      resetAt,
      nowIso,
      nowIso,
    ],
  );
  const row = result.rows[0];
  const count = Number(row?.count ?? 1);
  const persistedResetAt = row?.reset_at ?? resetAt;

  return decision(count, limit, Date.parse(persistedResetAt), nowMs);
}

async function cleanupDatabaseRateLimits(
  db: DbClient,
  input: { before?: Date; limit?: number } = {},
) {
  const result = await db.query<{ id: string }>(
    `delete from rate_limits
     where id in (
       select id
       from rate_limits
       where reset_at <= $1
       order by reset_at asc
       limit $2
     )
     returning id`,
    [
      (input.before ?? new Date()).toISOString(),
      validBatchLimit(input.limit),
    ],
  );

  return result.rows.length;
}

function decision(
  count: number,
  limit: number,
  resetAtMs: number,
  nowMs: number,
): RateLimitDecision {
  const allowed = count <= limit;
  return {
    allowed,
    count,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt: new Date(resetAtMs).toISOString(),
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000)),
  };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeOperation(value: string) {
  const operation = value.trim().toLowerCase();
  if (!operation || operation.length > 80) {
    throw new Error("Invalid rate-limit operation key.");
  }

  return operation;
}

function validLimit(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 100_000) {
    throw new Error("Invalid rate-limit threshold.");
  }

  return value;
}

function validWindowSeconds(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 31 * 24 * 60 * 60) {
    throw new Error("Invalid rate-limit window.");
  }

  return value;
}

function validBatchLimit(value?: number) {
  if (!value || !Number.isInteger(value)) return 500;
  return Math.max(1, Math.min(5_000, value));
}
