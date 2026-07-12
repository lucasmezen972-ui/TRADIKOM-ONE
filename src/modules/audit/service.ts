import type { DbClient } from "@/lib/db";
import { correlationId, id, nowIso, safeJson, toJson } from "@/lib/security";
import type { AuditLog } from "@/lib/types";
import { AuditError } from "@/modules/audit/errors";
import {
  insertAuditLogRow,
  listAuditLogRows,
} from "@/modules/audit/repository";
import {
  auditLogQuerySchema,
  type AuditLogQueryInput,
} from "@/modules/audit/schemas";
import { findMembershipRole } from "@/modules/tenants/repository";

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
  await insertAuditLogRow(db, {
    id: id("audit"),
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    safeMetadata: toJson(input.metadata),
    correlationId: correlationId(),
    createdAt: nowIso(),
  });
}

export async function getAuditLogs(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: AuditLogQueryInput = {},
) {
  const role = await findMembershipRole(db, userId, tenantId);
  if (!role) {
    throw new AuditError(
      "audit_access_denied",
      "Acces refuse pour cette organisation.",
    );
  }
  const parsed = auditLogQuerySchema.parse(input);
  const rows = await listAuditLogRows(db, tenantId, parsed.limit);

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: safeJson(row.safe_metadata, {}),
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  })) satisfies AuditLog[];
}
