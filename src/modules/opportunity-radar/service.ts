import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { getContactDuplicateCandidates } from "@/modules/crm/service";
import {
  dismissOpportunityRadarAlertRecord,
  findOpportunityRadarAlert,
  listOpportunityRadarAlerts,
  resolveOpportunityRadarAlert,
  upsertDetectedOpportunityAlert,
  type DetectedOpportunityAlert,
} from "@/modules/opportunity-radar/repository";
import { dismissOpportunityAlertSchema } from "@/modules/opportunity-radar/schemas";
import { assertTenantAccess } from "@/modules/tenants";

export async function getOpportunityRadar(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const detected = await detectOpportunityRadarAlerts(db, userId, tenantId);
  const existing = await listOpportunityRadarAlerts(db, tenantId);
  const detectedKeys = new Set(detected.map(alertKey));
  const now = nowIso();

  for (const alert of detected) {
    await upsertDetectedOpportunityAlert(db, {
      ...alert,
      id: id("radar"),
      tenantId,
      detectedAt: now,
      updatedAt: now,
    });
  }

  for (const alert of existing) {
    if (!detectedKeys.has(alertKey(alert))) {
      await resolveOpportunityRadarAlert(db, tenantId, alert.id, now);
    }
  }

  return listOpportunityRadarAlerts(db, tenantId);
}

export async function dismissOpportunityRadarAlert(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { alertId: string },
) {
  await assertTenantAccess(db, userId, tenantId, [
    "owner",
    "administrator",
    "manager",
    "collaborator",
  ]);
  const parsed = dismissOpportunityAlertSchema.parse(input);
  const existing = await findOpportunityRadarAlert(db, tenantId, parsed.alertId);

  if (!existing) {
    throw new Error("Alerte introuvable.");
  }

  const dismissed = await dismissOpportunityRadarAlertRecord(
    db,
    tenantId,
    parsed.alertId,
    nowIso(),
  );

  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "opportunity_radar.dismissed",
    targetType: "opportunity_radar_alert",
    targetId: parsed.alertId,
    metadata: { ruleKey: existing.ruleKey, entityId: existing.entityId },
  });

  return dismissed ?? existing;
}

async function detectOpportunityRadarAlerts(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const alerts: DetectedOpportunityAlert[] = [];
  const now = new Date();
  const leadSlaCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const staleOpportunityCutoff = new Date(
    now.getTime() - 5 * 24 * 60 * 60 * 1000,
  ).toISOString();

  alerts.push(...(await detectLeadSlaAlerts(db, tenantId, leadSlaCutoff)));
  alerts.push(...(await detectOverdueTaskAlerts(db, tenantId, now.toISOString())));
  alerts.push(
    ...(await detectStaleOpportunityAlerts(
      db,
      tenantId,
      staleOpportunityCutoff,
    )),
  );
  alerts.push(...(await detectUnassignedContactAlerts(db, tenantId)));
  alerts.push(...(await detectFailedWorkflowAlerts(db, tenantId)));
  alerts.push(...(await detectConnectorErrorAlerts(db, tenantId)));
  alerts.push(...(await detectUnpublishedDraftAlerts(db, tenantId)));
  alerts.push(...(await detectFailedFormProcessingAlerts(db, tenantId)));
  alerts.push(...(await detectDuplicateContactAlerts(db, userId, tenantId)));

  return alerts;
}

async function detectLeadSlaAlerts(
  db: DbClient,
  tenantId: string,
  cutoff: string,
) {
  const result = await db.query<{
    id: string;
    contact_id: string;
    name: string;
    created_at: string;
  }>(
    `select leads.id, leads.contact_id, contacts.name, leads.created_at
     from leads
     join contacts on contacts.id = leads.contact_id and contacts.tenant_id = leads.tenant_id
     where leads.tenant_id = $1
       and leads.created_at < $2
       and not exists (
         select 1 from activities
         where activities.tenant_id = leads.tenant_id
           and activities.type <> $3
           and (
             (activities.target_type = $4 and activities.target_id = leads.id)
             or (activities.target_type = $5 and activities.target_id = contacts.id)
           )
       )
     order by leads.created_at asc
     limit 20`,
    [tenantId, cutoff, "lead.created", "lead", "contact"],
  );

  return result.rows.map((row) => ({
    ruleKey: "lead_sla_missed" as const,
    severity: "critical" as const,
    title: "Lead non contacte dans le SLA",
    explanation: `${row.name} attend une action depuis plus de 24h.`,
    entityType: "lead",
    entityId: row.id,
    actionLabel: "Ouvrir le contact",
    actionHref: `/contacts/${row.contact_id}`,
  }));
}

async function detectOverdueTaskAlerts(
  db: DbClient,
  tenantId: string,
  now: string,
) {
  const result = await db.query<{
    id: string;
    title: string;
    related_type: string;
    related_id: string;
    contact_id: string | null;
  }>(
    `select tasks.id, tasks.title, tasks.related_type, tasks.related_id, leads.contact_id
     from tasks
     left join leads on tasks.related_type = $4 and leads.id = tasks.related_id and leads.tenant_id = tasks.tenant_id
     where tasks.tenant_id = $1 and tasks.status = $2 and tasks.due_at < $3
     order by tasks.due_at asc
     limit 20`,
    [tenantId, "open", now, "lead"],
  );

  return result.rows.map((row) => {
    const contactId = row.related_type === "contact" ? row.related_id : row.contact_id;
    return {
      ruleKey: "overdue_task" as const,
      severity: "warning" as const,
      title: "Tache en retard",
      explanation: row.title,
      entityType: "task",
      entityId: row.id,
      actionLabel: contactId ? "Ouvrir le contact" : "Ouvrir les contacts",
      actionHref: contactId ? `/contacts/${contactId}` : "/contacts",
    };
  });
}

async function detectStaleOpportunityAlerts(
  db: DbClient,
  tenantId: string,
  cutoff: string,
) {
  const result = await db.query<{
    id: string;
    contact_name: string;
  }>(
    `select opportunities.id, contacts.name as contact_name
     from opportunities
     join contacts on contacts.id = opportunities.contact_id and contacts.tenant_id = opportunities.tenant_id
     where opportunities.tenant_id = $1
       and opportunities.updated_at < $2
       and not exists (
         select 1 from activities
         where activities.tenant_id = opportunities.tenant_id
           and activities.target_type = $3
           and activities.target_id = opportunities.id
           and activities.created_at >= $2
       )
     order by opportunities.updated_at asc
     limit 20`,
    [tenantId, cutoff, "opportunity"],
  );

  return result.rows.map((row) => ({
    ruleKey: "opportunity_without_activity" as const,
    severity: "warning" as const,
    title: "Opportunite sans activite recente",
    explanation: `${row.contact_name} n'a pas eu de mouvement depuis cinq jours.`,
    entityType: "opportunity",
    entityId: row.id,
    actionLabel: "Ouvrir l'opportunite",
    actionHref: `/opportunites/${row.id}`,
  }));
}

async function detectUnassignedContactAlerts(db: DbClient, tenantId: string) {
  const result = await db.query<{ id: string; name: string }>(
    `select id, name
     from contacts
     where tenant_id = $1 and assigned_user_id is null
     order by created_at asc
     limit 20`,
    [tenantId],
  );

  return result.rows.map((row) => ({
    ruleKey: "unassigned_contact" as const,
    severity: "info" as const,
    title: "Contact sans responsable",
    explanation: `${row.name} doit etre assigne pour eviter une relance perdue.`,
    entityType: "contact",
    entityId: row.id,
    actionLabel: "Assigner le contact",
    actionHref: `/contacts/${row.id}`,
  }));
}

async function detectFailedWorkflowAlerts(db: DbClient, tenantId: string) {
  const result = await db.query<{ id: string; summary: string }>(
    `select id, summary
     from workflow_runs
     where tenant_id = $1 and status = $2
     order by created_at desc
     limit 20`,
    [tenantId, "failed"],
  );

  return result.rows.map((row) => ({
    ruleKey: "failed_workflow" as const,
    severity: "critical" as const,
    title: "Workflow en echec",
    explanation: row.summary,
    entityType: "workflow_run",
    entityId: row.id,
    actionLabel: "Ouvrir les automatisations",
    actionHref: "/automatisations",
  }));
}

async function detectConnectorErrorAlerts(db: DbClient, tenantId: string) {
  const result = await db.query<{ id: string; connector_key: string }>(
    `select id, connector_key
     from connectors
     where tenant_id = $1 and health = $2
     order by updated_at desc
     limit 20`,
    [tenantId, "error"],
  );

  return result.rows.map((row) => ({
    ruleKey: "connector_error" as const,
    severity: "critical" as const,
    title: "Connexion en erreur",
    explanation: `${row.connector_key} doit etre inspecte avant de manquer des leads.`,
    entityType: "connector",
    entityId: row.id,
    actionLabel: "Inspecter la connexion",
    actionHref: "/connexions",
  }));
}

async function detectUnpublishedDraftAlerts(db: DbClient, tenantId: string) {
  const result = await db.query<{ id: string; name: string }>(
    `select id, name
     from websites
     where tenant_id = $1
       and (
         status <> $2
         or coalesce(current_draft_version_id, '') <> coalesce(current_published_version_id, '')
       )
     order by updated_at desc
     limit 20`,
    [tenantId, "published"],
  );

  return result.rows.map((row) => ({
    ruleKey: "unpublished_draft_changes" as const,
    severity: "info" as const,
    title: "Modifications de site non publiees",
    explanation: `${row.name} contient des changements qui ne sont pas encore en ligne.`,
    entityType: "website",
    entityId: row.id,
    actionLabel: "Ouvrir le site",
    actionHref: "/mon-site",
  }));
}

async function detectFailedFormProcessingAlerts(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<{ id: string; error: string | null }>(
    `select id, error
     from webhook_deliveries
     where tenant_id = $1 and status = $2
     order by created_at desc
     limit 20`,
    [tenantId, "rejected"],
  );

  return result.rows.map((row) => ({
    ruleKey: "failed_form_processing" as const,
    severity: "warning" as const,
    title: "Traitement de formulaire echoue",
    explanation: row.error ?? "Une entree publique a ete rejetee.",
    entityType: "webhook_delivery",
    entityId: row.id,
    actionLabel: "Inspecter les connexions",
    actionHref: "/connexions",
  }));
}

async function detectDuplicateContactAlerts(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const candidates = await getContactDuplicateCandidates(db, userId, tenantId);

  return candidates.slice(0, 20).map((candidate) => ({
    ruleKey: "likely_duplicate_contact" as const,
    severity: "warning" as const,
    title: "Doublon contact probable",
    explanation: candidate.reasons.map((reason) => reason.label).join(", "),
    entityType: "duplicate_contact",
    entityId: candidate.id,
    actionLabel: "Revoir le doublon",
    actionHref: candidate.actionHref,
  }));
}

function alertKey(alert: {
  ruleKey: string;
  entityType: string;
  entityId: string;
}) {
  return `${alert.ruleKey}:${alert.entityType}:${alert.entityId}`;
}
