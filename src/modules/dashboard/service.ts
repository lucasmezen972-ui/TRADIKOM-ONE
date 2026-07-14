import type { DbClient } from "@/lib/db";
import type {
  DashboardActionItem,
  DashboardData,
  Role,
  WorkflowDeadLetterEvent,
  WorkflowRun,
} from "@/lib/types";
import { getConnectors } from "@/modules/connectors";
import { getTenantActivities } from "@/modules/crm";
import { DashboardError } from "@/modules/dashboard/errors";
import {
  getDashboardMetrics,
  listApiSourceFailureActions,
  listBreakingApiChangeActions,
  listNewLeadActions,
  listOpportunityFollowUpActions,
  listOpportunityStageCounts,
  listOverdueTaskActions,
  listPendingApprovalActions,
} from "@/modules/dashboard/repository";
import {
  dashboardQuerySchema,
  type DashboardQueryInput,
} from "@/modules/dashboard/schemas";
import { listOpportunityRadarAlerts } from "@/modules/opportunity-radar/repository";
import { getTenantById } from "@/modules/tenants";
import { findMembershipRole } from "@/modules/tenants/repository";
import { getWebsite } from "@/modules/websites";
import { getWorkflowDeadLetters, getWorkflowRuns } from "@/modules/workflows";

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
      "Accès refusé pour cette organisation.",
    );
  }
  const parsed = dashboardQuerySchema.parse(input);
  const period = getBusinessDayPeriod(parsed.now, parsed.timeZone);
  const canApprove = approvalRoles.includes(role);
  const [
    tenant,
    website,
    metrics,
    stages,
    activities,
    workflowRuns,
    connectors,
    radar,
    deadLetters,
    newLeads,
    overdueTasks,
    opportunitiesNeedingFollowUp,
    apiSourceFailures,
    breakingApiChanges,
    pendingApprovals,
  ] = await Promise.all([
    getTenantById(db, tenantId),
    getWebsite(db, tenantId),
    getDashboardMetrics(db, tenantId, {
      now: parsed.now.toISOString(),
      dayStartedAt: period.dayStartedAt,
      dayEndsAt: period.dayEndsAt,
      canApprove,
    }),
    listOpportunityStageCounts(db, tenantId),
    getTenantActivities(db, tenantId, parsed.activityLimit),
    getWorkflowRuns(db, userId, tenantId),
    getConnectors(db, userId, tenantId),
    listOpportunityRadarAlerts(db, tenantId),
    getWorkflowDeadLetters(db, userId, tenantId),
    listNewLeadActions(
      db,
      tenantId,
      period.dayStartedAt,
      period.dayEndsAt,
      parsed.itemLimit,
    ),
    listOverdueTaskActions(
      db,
      tenantId,
      parsed.now.toISOString(),
      parsed.itemLimit,
    ),
    listOpportunityFollowUpActions(
      db,
      tenantId,
      period.dayEndsAt,
      parsed.itemLimit,
    ),
    listApiSourceFailureActions(db, tenantId, parsed.itemLimit),
    listBreakingApiChangeActions(db, tenantId, parsed.itemLimit),
    listPendingApprovalActions(db, tenantId, canApprove, parsed.itemLimit),
  ]);

  const visibleWorkflowRuns = workflowRuns.slice(0, parsed.workflowLimit);
  const workflowFailures = mapWorkflowFailures(workflowRuns, parsed.itemLimit);
  const deadLetterActions = mapDeadLetters(deadLetters, parsed.itemLimit);
  const activeRadar = radar.filter((alert) => alert.status === "active");
  const websiteSummary = summarizeWebsite(website);
  const priorityActions = selectPriorityActions(
    [
      ...overdueTasks,
      ...breakingApiChanges,
      ...workflowFailures,
      ...deadLetterActions,
      ...apiSourceFailures,
      ...activeRadar.map((alert) => ({
        id: `radar:${alert.id}`,
        title: alert.title,
        explanation: alert.explanation,
        actionLabel: alert.actionLabel,
        actionHref: alert.actionHref,
        severity: alert.severity,
      })),
      ...newLeads,
      ...opportunitiesNeedingFollowUp,
      ...pendingApprovals,
      ...mapConnectorIssues(connectors),
      ...mapWebsiteAction(websiteSummary),
    ],
    8,
  );

  return {
    tenant,
    metrics,
    websiteStatus: websiteSummary.label,
    opportunitiesByStage: stages,
    connectorHealth: connectors,
    recentActivities: activities,
    workflowRuns: visibleWorkflowRuns,
    detectedOpportunities: activeRadar,
    commandCenter: {
      capturedAt: parsed.now.toISOString(),
      timeZone: parsed.timeZone,
      ...period,
      priorityActions,
      overdueTasks,
      newLeads,
      opportunitiesNeedingFollowUp,
      workflowFailures,
      deadLetters: deadLetterActions,
      apiSourceFailures,
      breakingApiChanges,
      pendingApprovals,
      website: websiteSummary,
    },
  } satisfies DashboardData;
}

const approvalRoles: Role[] = ["owner", "administrator", "manager"];

function mapWorkflowFailures(runs: WorkflowRun[], limit: number) {
  return runs
    .filter((run) => run.status === "failed")
    .slice(0, limit)
    .map((run) => ({
      id: `workflow:${run.id}`,
      title: run.summary,
      explanation: "Cette exécution a atteint un échec terminal.",
      actionLabel: "Ouvrir les automatisations",
      actionHref: "/automatisations",
      severity: "critical" as const,
    }));
}

function mapDeadLetters(events: WorkflowDeadLetterEvent[], limit: number) {
  return events.slice(0, limit).map((event) => ({
    id: `dead-letter:${event.id}`,
    title: event.eventType,
    explanation: `Événement en échec après ${event.attempts} tentative${event.attempts > 1 ? "s" : ""}.`,
    actionLabel: "Examiner la file",
    actionHref: "/automatisations",
    severity: "critical" as const,
  }));
}

function mapConnectorIssues(connectors: DashboardData["connectorHealth"]) {
  return connectors
    .filter((connector) => ["warning", "error"].includes(connector.health))
    .map((connector) => ({
      id: `connector:${connector.key}`,
      title: connector.name,
      explanation:
        connector.health === "error"
          ? "Le connecteur est en erreur."
          : "Le connecteur demande une vérification.",
      actionLabel: "Ouvrir les connexions",
      actionHref: "/connexions",
      severity:
        connector.health === "error"
          ? ("critical" as const)
          : ("warning" as const),
    }));
}

function summarizeWebsite(website: Awaited<ReturnType<typeof getWebsite>>) {
  if (!website) {
    return {
      status: "absent" as const,
      label: "Aucun site",
      hasUnpublishedChanges: false,
      publishedAt: null,
    };
  }
  const published = website.status === "published" && Boolean(website.currentPublishedVersionId);
  return {
    status: published ? ("published" as const) : ("draft" as const),
    label: published ? "Publié" : "Brouillon",
    hasUnpublishedChanges:
      published &&
      Boolean(website.currentDraftVersionId) &&
      website.currentDraftVersionId !== website.currentPublishedVersionId,
    publishedAt: website.publishedAt ?? null,
  };
}

function mapWebsiteAction(
  website: DashboardData["commandCenter"]["website"],
) {
  if (website.status !== "published") {
    return [{
      id: "website:publish",
      title: "Publier le site",
      explanation: "La vitrine publique n'est pas encore publiée.",
      actionLabel: "Ouvrir le site",
      actionHref: "/mon-site",
      severity: "warning" as const,
    }];
  }
  if (website.hasUnpublishedChanges) {
    return [{
      id: "website:draft",
      title: "Vérifier les changements du site",
      explanation: "Un brouillon plus récent attend une publication.",
      actionLabel: "Ouvrir le brouillon",
      actionHref: "/mon-site",
      severity: "info" as const,
    }];
  }
  return [];
}

function selectPriorityActions(actions: DashboardActionItem[], limit: number) {
  const order = { critical: 0, warning: 1, info: 2 } as const;
  const unique = new Map<string, DashboardActionItem>();
  for (const action of actions) {
    unique.set(action.id, action);
  }
  return [...unique.values()]
    .sort((left, right) => order[left.severity] - order[right.severity])
    .slice(0, limit);
}

function getBusinessDayPeriod(now: Date, timeZone: string) {
  const local = dateParts(now, timeZone);
  const dayStartedAt = zonedDateTimeToUtc(local, timeZone).toISOString();
  const nextDay = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  const dayEndsAt = zonedDateTimeToUtc(
    {
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
    },
    timeZone,
  ).toISOString();
  return { dayStartedAt, dayEndsAt };
}

function zonedDateTimeToUtc(
  input: { year: number; month: number; day: number },
  timeZone: string,
) {
  const expected = Date.UTC(input.year, input.month - 1, input.day);
  let candidate = expected;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = dateTimeParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    candidate += expected - represented;
  }
  return new Date(candidate);
}

function dateParts(value: Date, timeZone: string) {
  const parts = dateTimeParts(value, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function dateTimeParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}
