import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import type { Role } from "@/lib/types";
import { listDueWhatsAppOutboundDeliveries } from "@/modules/channels/whatsapp-twilio-outbound-repository";
import {
  attemptPreparedMetaWhatsAppOutboundDelivery,
  type WhatsAppMetaOutboundAttemptOptions,
  type WhatsAppMetaOutboundDependencies,
} from "@/modules/channels/whatsapp-meta-outbound-service";
import { assertTenantAccess } from "@/modules/tenants";

const workerRoles: Role[] = [
  "owner",
  "administrator",
  "manager",
  "collaborator",
];
const defaultLimit = 25;

export type WhatsAppMetaOutboundWorkerOptions =
  WhatsAppMetaOutboundAttemptOptions & { limit?: number };

export type WhatsAppMetaOutboundWorkerSummary = {
  selected: number;
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
  skipped: number;
};

/** Reprend seulement les livraisons Meta dues du tenant demandé. */
export async function processMetaWhatsAppOutboundDeliveryWorker(
  db: DbClient,
  actorId: string,
  tenantId: string,
  dependencies: WhatsAppMetaOutboundDependencies,
  options: WhatsAppMetaOutboundWorkerOptions = {},
): Promise<WhatsAppMetaOutboundWorkerSummary> {
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
        provider: "whatsapp_meta",
      });
    },
  );
  const summary: WhatsAppMetaOutboundWorkerSummary = {
    selected: due.length,
    processed: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
  };

  for (const delivery of due) {
    const result = await attemptPreparedMetaWhatsAppOutboundDelivery(
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
