import { z } from "zod";

export const opportunityRadarRuleKeySchema = z.enum([
  "lead_sla_missed",
  "overdue_task",
  "opportunity_without_activity",
  "unassigned_contact",
  "failed_workflow",
  "connector_error",
  "unpublished_draft_changes",
  "failed_form_processing",
  "likely_duplicate_contact",
  "api_breaking_change",
]);

export const opportunityRadarAlertStatusSchema = z.enum([
  "active",
  "dismissed",
  "resolved",
]);

export const opportunityRadarAlertSeveritySchema = z.enum([
  "info",
  "warning",
  "critical",
]);

export const opportunityRadarAlertSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  ruleKey: opportunityRadarRuleKeySchema,
  severity: opportunityRadarAlertSeveritySchema,
  title: z.string().min(1),
  explanation: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  detectedAt: z.string().min(1),
  actionLabel: z.string().min(1),
  actionHref: z.string().min(1),
  status: opportunityRadarAlertStatusSchema,
  dismissedAt: z.string().optional(),
  resolvedAt: z.string().optional(),
});

export const dismissOpportunityAlertSchema = z.object({
  alertId: z.string().min(1),
});

export type OpportunityRadarRuleKey = z.infer<
  typeof opportunityRadarRuleKeySchema
>;
export type OpportunityRadarAlertStatus = z.infer<
  typeof opportunityRadarAlertStatusSchema
>;
export type OpportunityRadarAlertSeverity = z.infer<
  typeof opportunityRadarAlertSeveritySchema
>;
export type DismissOpportunityAlertInput = z.input<
  typeof dismissOpportunityAlertSchema
>;
