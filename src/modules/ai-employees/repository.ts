import type { DbClient } from "@/lib/db";
import type { AiEmployeeRole, AiEmployeeStatus } from "@/modules/ai-employees/schemas";
import type {
  AiEmployeeApprovalLimits,
  AiEmployeeKpi,
  AiEmployeePermission,
  AiEmployeeSkill,
  AiEmployeeTool,
  AiEmployeeWorkingHours,
} from "@/modules/ai-employees/templates";

export type AiEmployeeProfileRow = {
  id: string;
  tenant_id: string;
  employee_key: string;
  role_key: AiEmployeeRole;
  display_name: string;
  purpose: string;
  operational_status: AiEmployeeStatus;
  record_status: "current" | "superseded";
  skills: string;
  memory_domains: string;
  permissions: string;
  working_hours: string;
  tools: string;
  approval_limits: string;
  kpis: string;
  version: number | string;
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AiEmployeeActivityRow = {
  id: string;
  employee_key: string;
  profile_id: string;
  activity_type: "provisioned" | "initialized" | "profile_revised" | "paused" | "resumed";
  summary: string;
  safe_metadata: string;
  actor_id: string | null;
  created_at: string;
};

export type AiEmployeeMemoryRow = {
  id: string;
  domain: string;
  title: string;
  version: number | string;
};

export async function listCurrentAiEmployeeProfiles(db: DbClient, tenantId: string) {
  const result = await db.query<AiEmployeeProfileRow>(
    `select * from ai_employee_profiles
     where tenant_id = $1 and record_status = 'current'
     order by role_key asc, employee_key asc`,
    [tenantId],
  );
  return result.rows;
}

export async function findCurrentAiEmployeeProfile(
  db: DbClient,
  tenantId: string,
  employeeId: string,
) {
  const result = await db.query<AiEmployeeProfileRow>(
    `select * from ai_employee_profiles
     where tenant_id = $1 and id = $2 and record_status = 'current'`,
    [tenantId, employeeId],
  );
  return result.rows[0] ?? null;
}

export async function getNextAiEmployeeVersion(
  db: DbClient,
  tenantId: string,
  employeeKey: string,
) {
  const result = await db.query<{ version: number | string }>(
    `select coalesce(max(version), 0) + 1 as version
     from ai_employee_profiles where tenant_id = $1 and employee_key = $2`,
    [tenantId, employeeKey],
  );
  return Number(result.rows[0]?.version ?? 1);
}

export async function supersedeAiEmployeeProfile(
  db: DbClient,
  tenantId: string,
  employeeId: string,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update ai_employee_profiles
     set record_status = 'superseded', updated_at = $3
     where tenant_id = $1 and id = $2 and record_status = 'current'
     returning id`,
    [tenantId, employeeId, now],
  );
  return result.rows[0] ?? null;
}

export async function insertAiEmployeeProfile(db: DbClient, input: {
  id: string;
  tenantId: string;
  employeeKey: string;
  role: AiEmployeeRole;
  displayName: string;
  purpose: string;
  status: AiEmployeeStatus;
  skills: AiEmployeeSkill[];
  memoryDomains: string[];
  permissions: AiEmployeePermission[];
  workingHours: AiEmployeeWorkingHours;
  tools: AiEmployeeTool[];
  approvalLimits: AiEmployeeApprovalLimits;
  kpis: AiEmployeeKpi[];
  version: number;
  supersedesId?: string;
  now: string;
}) {
  await db.query(
    `insert into ai_employee_profiles (
       id, tenant_id, employee_key, role_key, display_name, purpose,
       operational_status, record_status, skills, memory_domains, permissions,
       working_hours, tools, approval_limits, kpis, version, supersedes_id,
       created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, 'current', $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17, $17
     )`,
    [
      input.id,
      input.tenantId,
      input.employeeKey,
      input.role,
      input.displayName,
      input.purpose,
      input.status,
      JSON.stringify(input.skills),
      JSON.stringify(input.memoryDomains),
      JSON.stringify(input.permissions),
      JSON.stringify(input.workingHours),
      JSON.stringify(input.tools),
      JSON.stringify(input.approvalLimits),
      JSON.stringify(input.kpis),
      input.version,
      input.supersedesId ?? null,
      input.now,
    ],
  );
}

export async function insertAiEmployeeActivity(db: DbClient, input: {
  id: string;
  tenantId: string;
  employeeKey: string;
  profileId: string;
  activityType: AiEmployeeActivityRow["activity_type"];
  summary: string;
  safeMetadata: Record<string, unknown>;
  actorId?: string;
  now: string;
}) {
  await db.query(
    `insert into ai_employee_activity_logs (
       id, tenant_id, employee_key, profile_id, activity_type, summary,
       safe_metadata, actor_id, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.id,
      input.tenantId,
      input.employeeKey,
      input.profileId,
      input.activityType,
      input.summary,
      JSON.stringify(input.safeMetadata),
      input.actorId ?? null,
      input.now,
    ],
  );
}

export async function listAiEmployeeActivities(db: DbClient, tenantId: string) {
  const result = await db.query<AiEmployeeActivityRow>(
    `select id, employee_key, profile_id, activity_type, summary,
       safe_metadata, actor_id, created_at
     from ai_employee_activity_logs where tenant_id = $1
     order by created_at desc, id desc limit 200`,
    [tenantId],
  );
  return result.rows;
}

export async function listAiEmployeeMemory(db: DbClient, tenantId: string) {
  const result = await db.query<AiEmployeeMemoryRow>(
    `select id, domain, title, version from business_brain_entries
     where tenant_id = $1 and status = 'active'
     order by updated_at desc, id asc limit 500`,
    [tenantId],
  );
  return result.rows;
}
