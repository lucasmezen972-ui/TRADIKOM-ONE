import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import type { Role } from "@/lib/types";
import { listDueWhatsAppOutboundDeliveries } from "@/modules/channels/whatsapp-twilio-outbound-repository";
import {
  attemptPreparedWhatsAppOutboundDelivery,
  type WhatsAppOutboundAttemptOptions,
  type WhatsAppOutboundDependencies,
} from "@/modules/channels/whatsapp-twilio-outbound-service";
import { assertTenantAccess } from "@/modules/tenants";

const workerRoles: Role[] = [
  "owner",
  "administrator",
  "manager",
  "collaborator",
];
const defaultLimit = 25;

export type WhatsAppOutboundWorkerOptions = WhatsAppOutboundAttemptOptions & {
  limit?: number;
};

export type WhatsAppOutboundWorkerSummary = {
  selected: number;
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
  skipped: number;
};

export async function processWhatsAppOutboundDeliveryWorker(
  db: DbClient,
  actorId: string,
  tenantId: string,
  dependencies: WhatsAppOutboundDependencies,
  options: WhatsAppOutboundWorkerOptions = {},
): Promise<WhatsAppOutboundWorkerSummary> {
  const now = options.now ?? new Date();
  const limit = boundedLimit(options.limit);
  const due = await withTenantDbTransaction(
    db,
    tenantId,
    actorId,
    async (transaction) => {
      await assertTenantAccess(transaction, actorId, tenantId, workerRoles);
      return listDueWhatsAppOutboundDeliveries(transaction, {
        tenantId,
        dueAt: now.toISOString(),
        limit,
      });
    },
  );
  const summary: WhatsAppOutboundWorkerSummary = {
    selected: due.length,
    processed: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
  };

  for (const delivery of due) {
    const result = await attemptPreparedWhatsAppOutboundDelivery(
      db,
      actorId,
      { tenantId, deliveryId: delivery.id },
      dependencies,
      { ...options, now },
    );
    if (result.idempotentReplay) {
      summary.skipped += 1;
      continue;
    }

    summary.processed += 1;
    if (result.status === "accepted" || result.status === "delivered") {
      summary.succeeded += 1;
    } else if (result.retryable) {
      summary.retried += 1;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}

function boundedLimit(value: number | undefined) {
  return Number.isInteger(value) && value !== undefined && value > 0 && value <= 100
    ? value
    : defaultLimit;
}
