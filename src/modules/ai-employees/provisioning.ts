import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import {
  insertAiEmployeeActivity,
  insertAiEmployeeProfile,
  listCurrentAiEmployeeProfiles,
} from "@/modules/ai-employees/repository";
import {
  aiEmployeeApprovalLimits,
  defaultAiEmployeeTemplates,
  defaultAiEmployeeWorkingHours,
} from "@/modules/ai-employees/templates";

export async function provisionDefaultAiEmployees(
  db: DbClient,
  tenantId: string,
  options: { actorId?: string; timeZone?: string; activityType?: "provisioned" | "initialized" } = {},
) {
  const existing = new Set(
    (await listCurrentAiEmployeeProfiles(db, tenantId)).map(
      (profile) => profile.employee_key,
    ),
  );
  const now = nowIso();
  const createdIds: string[] = [];
  for (const employee of defaultAiEmployeeTemplates) {
    if (existing.has(employee.key)) continue;
    const profileId = id("ai_employee");
    await insertAiEmployeeProfile(db, {
      id: profileId,
      tenantId,
      employeeKey: employee.key,
      role: employee.role,
      displayName: employee.displayName,
      purpose: employee.purpose,
      status: "enabled",
      skills: employee.skills,
      memoryDomains: employee.memoryDomains,
      permissions: employee.permissions,
      workingHours: defaultAiEmployeeWorkingHours(
        options.timeZone ?? "America/Martinique",
      ),
      tools: employee.tools,
      approvalLimits: aiEmployeeApprovalLimits,
      kpis: employee.kpis,
      version: 1,
      now,
    });
    await insertAiEmployeeActivity(db, {
      id: id("ai_employee_activity"),
      tenantId,
      employeeKey: employee.key,
      profileId,
      activityType: options.activityType ?? "provisioned",
      summary: "Profil virtuel préparé avec des droits internes bornés.",
      safeMetadata: {
        role: employee.role,
        skills: employee.skills.length,
        tools: employee.tools.length,
        externalCommunications: "prohibited",
        productionWrites: "prohibited",
      },
      actorId: options.actorId,
      now,
    });
    createdIds.push(profileId);
  }
  return createdIds;
}
