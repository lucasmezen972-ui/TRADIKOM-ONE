import type { DbClient } from "@/lib/db";
import type { DashboardData } from "@/lib/types";
import { getConnectors } from "@/modules/connectors";
import { getTenantActivities } from "@/modules/crm";
import { DashboardError } from "@/modules/dashboard/errors";
import {
  getDashboardMetrics,
  listOpportunityStageCounts,
} from "@/modules/dashboard/repository";
import {
  dashboardQuerySchema,
  type DashboardQueryInput,
} from "@/modules/dashboard/schemas";
import { getOpportunityRadar } from "@/modules/opportunity-radar";
import { getTenantById } from "@/modules/tenants";
import { findMembershipRole } from "@/modules/tenants/repository";
import { getWebsite } from "@/modules/websites";
import { getWorkflowRuns } from "@/modules/workflows";

export async function getDashboardData(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: DashboardQueryInput = {},
) {
  const role = await findMembershipRole(db, userId, tenantId);
  if (!role) {
    throw new DashboardError(
      "dashboard_access_denied",
      "Acces refuse pour cette organisation.",
    );
  }
  const parsed = dashboardQuerySchema.parse(input);
  const [
    tenant,
    website,
    metrics,
    stages,
    activities,
    workflowRuns,
    connectors,
    radar,
  ] = await Promise.all([
    getTenantById(db, tenantId),
    getWebsite(db, tenantId),
    getDashboardMetrics(db, tenantId),
    listOpportunityStageCounts(db, tenantId),
    getTenantActivities(db, tenantId, parsed.activityLimit),
    getWorkflowRuns(db, userId, tenantId),
    getConnectors(db, userId, tenantId),
    getOpportunityRadar(db, userId, tenantId),
  ]);

  return {
    tenant,
    metrics,
    websiteStatus: website?.status === "published" ? "Publie" : "Brouillon",
    opportunitiesByStage: stages,
    connectorHealth: connectors,
    recentActivities: activities,
    workflowRuns: workflowRuns.slice(0, parsed.workflowLimit),
    detectedOpportunities: radar.filter((alert) => alert.status === "active"),
  } satisfies DashboardData;
}
