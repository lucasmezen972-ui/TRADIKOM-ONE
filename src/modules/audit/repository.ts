import type { DbClient } from "@/lib/db";

export type AuditLogRow = {
  id: string;
  tenant_id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  safe_metadata: string;
  correlation_id: string;
  created_at: string;
};

export async function insertAuditLogRow(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    safeMetadata: string;
    correlationId: string;
    createdAt: string;
  },
) {
  await db.query(
    "insert into audit_logs (id, tenant_id, actor_id, action, target_type, target_id, safe_metadata, correlation_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      input.id,
      input.tenantId,
      input.actorId,
      input.action,
      input.targetType,
      input.targetId,
      input.safeMetadata,
      input.correlationId,
      input.createdAt,
    ],
  );
}

export async function listAuditLogRows(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const result = await db.query<AuditLogRow>(
    `select *
     from audit_logs
     where tenant_id = $1
     order by created_at desc
     limit $2`,
    [tenantId, limit],
  );

  return result.rows;
}
