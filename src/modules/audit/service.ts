import type { DbClient } from "@/lib/db";
import { correlationId, id, nowIso, toJson } from "@/lib/security";

export async function recordAuditLog(
  db: DbClient,
  input: {
    tenantId: string;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata: Record<string, unknown>;
  },
) {
  await db.query(
    "insert into audit_logs (id, tenant_id, actor_id, action, target_type, target_id, safe_metadata, correlation_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      id("audit"),
      input.tenantId,
      input.actorId,
      input.action,
      input.targetType,
      input.targetId,
      toJson(input.metadata),
      correlationId(),
      nowIso(),
    ],
  );
}
