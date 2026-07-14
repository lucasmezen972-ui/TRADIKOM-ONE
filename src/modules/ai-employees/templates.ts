import type { BusinessBrainDomain } from "@/modules/business-brain";
import type { AiEmployeeRole } from "@/modules/ai-employees/schemas";

export type AiEmployeeSkill = {
  key: string;
  label: string;
  level: 1 | 2 | 3 | 4 | 5;
};

export type AiEmployeePermission = {
  capability: string;
  access: "read" | "propose";
  approvalRequired: boolean;
};

export type AiEmployeeTool = {
  key: string;
  label: string;
  mode: "read_only" | "draft_only";
};

export type AiEmployeeKpi = {
  key: string;
  label: string;
  target: string;
};

export type AiEmployeeWorkingHours = {
  timeZone: string;
  workingDays: number[];
  start: string;
  end: string;
};

export type AiEmployeeApprovalLimits = {
  internalDrafts: "approval_required";
  externalCommunications: "prohibited";
  productionWrites: "prohibited";
  financialTransactions: "prohibited";
  connectorActivation: "prohibited";
};

export type AiEmployeeTemplate = {
  key: string;
  role: AiEmployeeRole;
  displayName: string;
  purpose: string;
  skills: AiEmployeeSkill[];
  memoryDomains: BusinessBrainDomain[];
  permissions: AiEmployeePermission[];
  tools: AiEmployeeTool[];
  kpis: AiEmployeeKpi[];
};

const readBrain: AiEmployeePermission = {
  capability: "business_brain.read",
  access: "read",
  approvalRequired: false,
};

const proposeInternal: AiEmployeePermission = {
  capability: "internal_recommendation.propose",
  access: "propose",
  approvalRequired: true,
};

const brainTool: AiEmployeeTool = {
  key: "business_brain_read",
  label: "Lecture du Cerveau d'entreprise",
  mode: "read_only",
};

const draftTool: AiEmployeeTool = {
  key: "internal_draft",
  label: "Préparation de brouillons internes",
  mode: "draft_only",
};

function template(input: Omit<AiEmployeeTemplate, "permissions" | "tools"> & {
  readCapability: string;
  readTool: AiEmployeeTool;
}): AiEmployeeTemplate {
  return {
    key: input.key,
    role: input.role,
    displayName: input.displayName,
    purpose: input.purpose,
    skills: input.skills,
    memoryDomains: input.memoryDomains,
    permissions: [
      readBrain,
      {
        capability: input.readCapability,
        access: "read",
        approvalRequired: false,
      },
      proposeInternal,
    ],
    tools: [brainTool, input.readTool, draftTool],
    kpis: input.kpis,
  };
}

export const aiEmployeeApprovalLimits: AiEmployeeApprovalLimits = {
  internalDrafts: "approval_required",
  externalCommunications: "prohibited",
  productionWrites: "prohibited",
  financialTransactions: "prohibited",
  connectorActivation: "prohibited",
};

export const defaultAiEmployeeTemplates: AiEmployeeTemplate[] = [
  template({
    key: "marketing-manager",
    role: "marketing_manager",
    displayName: "Responsable marketing IA",
    purpose: "Préparer des recommandations et brouillons marketing fondés sur les preuves approuvées.",
    skills: [
      { key: "campaign_planning", label: "Planification de campagne", level: 4 },
      { key: "audience_analysis", label: "Analyse d'audience", level: 4 },
    ],
    memoryDomains: ["company", "catalog", "objectives", "kpis"],
    readCapability: "marketing.proposals.read",
    readTool: { key: "marketing_read", label: "Lecture des brouillons marketing", mode: "read_only" },
    kpis: [{ key: "approved_drafts", label: "Brouillons utiles", target: "Suivre les brouillons approuvés par un humain" }],
  }),
  template({
    key: "sales-assistant",
    role: "sales_assistant",
    displayName: "Assistant commercial IA",
    purpose: "Prioriser le suivi commercial et préparer des recommandations sans contacter les prospects.",
    skills: [
      { key: "pipeline_review", label: "Lecture du pipeline", level: 5 },
      { key: "follow_up_planning", label: "Planification du suivi", level: 4 },
    ],
    memoryDomains: ["customers", "pricing", "objectives", "kpis"],
    readCapability: "crm.read",
    readTool: { key: "crm_read", label: "Lecture du CRM", mode: "read_only" },
    kpis: [{ key: "overdue_followups", label: "Suivis à traiter", target: "Réduire les suivis en retard signalés" }],
  }),
  template({
    key: "receptionist",
    role: "receptionist",
    displayName: "Réceptionniste IA",
    purpose: "Préparer des réponses internes à partir des informations validées, sans les envoyer.",
    skills: [
      { key: "request_triage", label: "Qualification des demandes", level: 4 },
      { key: "information_lookup", label: "Recherche d'information interne", level: 4 },
    ],
    memoryDomains: ["company", "catalog", "locations"],
    readCapability: "crm.inbound.read",
    readTool: { key: "inbound_requests_read", label: "Lecture des demandes entrantes", mode: "read_only" },
    kpis: [{ key: "triage_quality", label: "Demandes qualifiées", target: "Préparer une qualification complète et vérifiable" }],
  }),
  template({
    key: "customer-support",
    role: "customer_support",
    displayName: "Support client IA",
    purpose: "Préparer des réponses et plans de résolution internes à partir du contexte client autorisé.",
    skills: [
      { key: "case_summary", label: "Synthèse de dossier", level: 5 },
      { key: "resolution_planning", label: "Plan de résolution", level: 4 },
    ],
    memoryDomains: ["company", "customers", "catalog"],
    readCapability: "crm.activities.read",
    readTool: { key: "customer_history_read", label: "Lecture de l'historique client", mode: "read_only" },
    kpis: [{ key: "resolution_drafts", label: "Plans de résolution", target: "Préparer des plans factuels soumis à validation" }],
  }),
  template({
    key: "seo-specialist",
    role: "seo_specialist",
    displayName: "Expert SEO IA",
    purpose: "Analyser le brouillon du site et préparer des améliorations SEO sans publication automatique.",
    skills: [
      { key: "seo_review", label: "Audit SEO interne", level: 5 },
      { key: "content_structure", label: "Structure de contenu", level: 4 },
    ],
    memoryDomains: ["company", "catalog", "locations", "websites"],
    readCapability: "website.draft.read",
    readTool: { key: "website_draft_read", label: "Lecture du brouillon du site", mode: "read_only" },
    kpis: [{ key: "approved_seo_proposals", label: "Propositions SEO", target: "Suivre les améliorations approuvées" }],
  }),
  template({
    key: "content-writer",
    role: "content_writer",
    displayName: "Rédacteur IA",
    purpose: "Préparer des contenus factuels à partir des informations et affirmations approuvées.",
    skills: [
      { key: "factual_writing", label: "Rédaction factuelle", level: 5 },
      { key: "brand_tone", label: "Respect du ton de marque", level: 4 },
    ],
    memoryDomains: ["company", "catalog", "websites"],
    readCapability: "website.content.read",
    readTool: { key: "approved_claims_read", label: "Lecture des affirmations approuvées", mode: "read_only" },
    kpis: [{ key: "factual_drafts", label: "Brouillons factuels", target: "Aucune affirmation non prouvée" }],
  }),
  template({
    key: "business-analyst",
    role: "business_analyst",
    displayName: "Analyste d'entreprise IA",
    purpose: "Synthétiser les signaux opérationnels et financiers pour préparer des décisions humaines.",
    skills: [
      { key: "signal_analysis", label: "Analyse de signaux", level: 5 },
      { key: "financial_reading", label: "Lecture financière indicative", level: 4 },
    ],
    memoryDomains: ["company", "customers", "pricing", "margins", "objectives", "kpis"],
    readCapability: "dashboard.financial.read",
    readTool: { key: "operational_metrics_read", label: "Lecture des indicateurs internes", mode: "read_only" },
    kpis: [{ key: "evidence_coverage", label: "Couverture des preuves", target: "Signaler les décisions sans preuve suffisante" }],
  }),
  template({
    key: "automation-engineer",
    role: "automation_engineer",
    displayName: "Ingénieur automatisation IA",
    purpose: "Diagnostiquer les workflows et préparer des améliorations sans exécuter ni activer de connecteur.",
    skills: [
      { key: "workflow_diagnostics", label: "Diagnostic de workflow", level: 5 },
      { key: "failure_analysis", label: "Analyse d'échec", level: 4 },
    ],
    memoryDomains: ["automations", "connectors", "api"],
    readCapability: "workflow.health.read",
    readTool: { key: "workflow_health_read", label: "Lecture de la santé des workflows", mode: "read_only" },
    kpis: [{ key: "safe_recommendations", label: "Améliorations sûres", target: "Aucune activation ou reprise automatique" }],
  }),
  template({
    key: "website-manager",
    role: "website_manager",
    displayName: "Responsable site IA",
    purpose: "Préparer et suivre les améliorations du brouillon sans toucher à la publication active.",
    skills: [
      { key: "draft_review", label: "Revue de brouillon", level: 5 },
      { key: "publication_safety", label: "Sécurité de publication", level: 5 },
    ],
    memoryDomains: ["company", "catalog", "locations", "websites"],
    readCapability: "website.versions.read",
    readTool: { key: "website_versions_read", label: "Lecture des versions du site", mode: "read_only" },
    kpis: [{ key: "draft_safety", label: "Sécurité du brouillon", target: "Zéro publication autonome" }],
  }),
];

export function defaultAiEmployeeWorkingHours(timeZone: string): AiEmployeeWorkingHours {
  return {
    timeZone,
    workingDays: [1, 2, 3, 4, 5],
    start: "08:00",
    end: "17:00",
  };
}
