import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso, safeJson } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { AiEmployeeError } from "@/modules/ai-employees/errors";
import { provisionDefaultAiEmployees } from "@/modules/ai-employees/provisioning";
import {
  findCurrentAiEmployeeProfile,
  getNextAiEmployeeVersion,
  insertAiEmployeeActivity,
  insertAiEmployeeProfile,
  listAiEmployeeActivities,
  listAiEmployeeMemory,
  listCurrentAiEmployeeProfiles,
  supersedeAiEmployeeProfile,
} from "@/modules/ai-employees/repository";
import {
  reviseAiEmployeeProfileSchema,
  type ReviseAiEmployeeProfileInput,
} from "@/modules/ai-employees/schemas";
import type {
  AiEmployeeApprovalLimits,
  AiEmployeeKpi,
  AiEmployeePermission,
  AiEmployeeSkill,
  AiEmployeeTool,
  AiEmployeeWorkingHours,
} from "@/modules/ai-employees/templates";
import type { BusinessBrainDomain } from "@/modules/business-brain";
import { assertTenantAccess } from "@/modules/tenants";

const aiEmployeeManageRoles = ["owner", "administrator", "manager"] as const;

export async function getAiEmployeeWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const [profiles, activities, memory] = await Promise.all([
    listCurrentAiEmployeeProfiles(db, tenantId),
    listAiEmployeeActivities(db, tenantId),
    listAiEmployeeMemory(db, tenantId),
  ]);
  return {
    employees: profiles.map((profile) => {
      const memoryDomains = safeJson<BusinessBrainDomain[]>(
        profile.memory_domains,
        [],
      );
      return {
        id: profile.id,
        employeeKey: profile.employee_key,
        role: profile.role_key,
        displayName: profile.display_name,
        purpose: profile.purpose,
        status: profile.operational_status,
        skills: safeJson<AiEmployeeSkill[]>(profile.skills, []),
        memoryDomains,
        memory: memory
          .filter((item) => memoryDomains.includes(item.domain as BusinessBrainDomain))
          .map((item) => ({
            id: item.id,
            domain: item.domain,
            title: item.title,
            version: Number(item.version),
          })),
        permissions: safeJson<AiEmployeePermission[]>(profile.permissions, []),
        workingHours: safeJson<AiEmployeeWorkingHours>(profile.working_hours, {
          timeZone: "America/Martinique",
          workingDays: [1, 2, 3, 4, 5],
          start: "08:00",
          end: "17:00",
        }),
        tools: safeJson<AiEmployeeTool[]>(profile.tools, []),
        approvalLimits: safeJson<AiEmployeeApprovalLimits>(
          profile.approval_limits,
          {
            internalDrafts: "approval_required",
            externalCommunications: "prohibited",
            productionWrites: "prohibited",
            financialTransactions: "prohibited",
            connectorActivation: "prohibited",
          },
        ),
        kpis: safeJson<AiEmployeeKpi[]>(profile.kpis, []),
        version: Number(profile.version),
        updatedAt: profile.updated_at,
      };
    }),
    activities: activities.map((activity) => ({
      id: activity.id,
      employeeKey: activity.employee_key,
      profileId: activity.profile_id,
      type: activity.activity_type,
      summary: activity.summary,
      metadata: safeJson<Record<string, unknown>>(activity.safe_metadata, {}),
      actorId: activity.actor_id ?? undefined,
      createdAt: activity.created_at,
    })),
  };
}

export async function initializeAiEmployeeTeam(
  db: DbClient,
  userId: string,
  tenantId: string,
  timeZone = "America/Martinique",
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...aiEmployeeManageRoles,
    ]);
    const createdIds = await provisionDefaultAiEmployees(transaction, tenantId, {
      actorId: userId,
      timeZone,
      activityType: "initialized",
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "ai_employee.team_initialized",
      targetType: "tenant",
      targetId: tenantId,
      metadata: {
        createdCount: createdIds.length,
        externalExecutionEnabled: false,
      },
    });
    return { createdIds };
  });
}

export async function reviseAiEmployeeProfile(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ReviseAiEmployeeProfileInput,
) {
  const parsed = reviseAiEmployeeProfileSchema.parse(input);
  if (parsed.workdayStart >= parsed.workdayEnd) {
    throw new AiEmployeeError(
      "ai_employee_invalid_working_hours",
      "L'heure de fin doit être postérieure à l'heure de début.",
    );
  }
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...aiEmployeeManageRoles,
    ]);
    const current = await findCurrentAiEmployeeProfile(
      transaction,
      tenantId,
      parsed.employeeId,
    );
    if (!current) {
      throw new AiEmployeeError(
        "ai_employee_not_found",
        "Ce collègue virtuel n'est pas disponible.",
      );
    }
    const now = nowIso();
    const superseded = await supersedeAiEmployeeProfile(
      transaction,
      tenantId,
      current.id,
      now,
    );
    if (!superseded) {
      throw new AiEmployeeError(
        "ai_employee_revision_conflict",
        "Ce profil a déjà été modifié.",
      );
    }
    const profileId = id("ai_employee");
    const previousWorkingHours = safeJson<AiEmployeeWorkingHours>(
      current.working_hours,
      {
        timeZone: "America/Martinique",
        workingDays: [1, 2, 3, 4, 5],
        start: "08:00",
        end: "17:00",
      },
    );
    const version = await getNextAiEmployeeVersion(
      transaction,
      tenantId,
      current.employee_key,
    );
    await insertAiEmployeeProfile(transaction, {
      id: profileId,
      tenantId,
      employeeKey: current.employee_key,
      role: current.role_key,
      displayName: parsed.displayName,
      purpose: parsed.purpose,
      status: parsed.status,
      skills: safeJson<AiEmployeeSkill[]>(current.skills, []),
      memoryDomains: safeJson<BusinessBrainDomain[]>(current.memory_domains, []),
      permissions: safeJson<AiEmployeePermission[]>(current.permissions, []),
      workingHours: {
        timeZone: previousWorkingHours.timeZone,
        workingDays: [...new Set(parsed.workingDays)].sort(),
        start: parsed.workdayStart,
        end: parsed.workdayEnd,
      },
      tools: safeJson<AiEmployeeTool[]>(current.tools, []),
      approvalLimits: safeJson<AiEmployeeApprovalLimits>(
        current.approval_limits,
        {
          internalDrafts: "approval_required",
          externalCommunications: "prohibited",
          productionWrites: "prohibited",
          financialTransactions: "prohibited",
          connectorActivation: "prohibited",
        },
      ),
      kpis: safeJson<AiEmployeeKpi[]>(current.kpis, []),
      version,
      supersedesId: current.id,
      now,
    });
    const statusChanged = current.operational_status !== parsed.status;
    await insertAiEmployeeActivity(transaction, {
      id: id("ai_employee_activity"),
      tenantId,
      employeeKey: current.employee_key,
      profileId,
      activityType: statusChanged
        ? parsed.status === "paused"
          ? "paused"
          : "resumed"
        : "profile_revised",
      summary: statusChanged
        ? parsed.status === "paused"
          ? "Profil virtuel mis en pause par un responsable."
          : "Profil virtuel réactivé par un responsable."
        : "Configuration interne du profil révisée.",
      safeMetadata: {
        version,
        status: parsed.status,
        workingDayCount: parsed.workingDays.length,
        externalExecutionEnabled: false,
      },
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "ai_employee.profile_revised",
      targetType: "ai_employee_profile",
      targetId: profileId,
      metadata: {
        employeeKey: current.employee_key,
        version,
        status: parsed.status,
        externalExecutionEnabled: false,
      },
    });
    return { profileId, version };
  });
}
