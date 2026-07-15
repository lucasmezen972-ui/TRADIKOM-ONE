import { z } from "zod";

export const exportFormatSchema = z.enum(["csv", "xlsx", "json"]);
export const exportEntitySchema = z.enum([
  "contacts",
  "companies",
  "opportunities",
  "tasks",
  "activities",
  "products",
  "workflows",
  "connector_health",
]);

export const exportFieldDefinitions = {
  contacts: {
    name: "Nom",
    email: "E-mail",
    phone: "Téléphone",
    status: "Statut",
    source: "Source",
    tags: "Étiquettes",
    created_at: "Créé le",
  },
  companies: {
    name: "Nom",
    domain: "Domaine",
    created_at: "Créée le",
  },
  opportunities: {
    contact_email: "E-mail du contact",
    stage_name: "Étape",
    value_cents: "Valeur en centimes",
    next_follow_up_at: "Prochaine action",
    lost_reason: "Motif de perte",
    created_at: "Créée le",
  },
  tasks: {
    title: "Titre",
    status: "Statut",
    due_at: "Échéance",
    related_type: "Type associé",
    created_at: "Créée le",
  },
  activities: {
    type: "Type",
    summary: "Résumé",
    target_type: "Type de cible",
    created_at: "Créée le",
  },
  products: {
    name: "Nom",
    sku: "Référence",
    price_cents: "Prix en centimes",
    active: "Actif",
    created_at: "Créé le",
  },
  workflows: {
    name: "Nom",
    trigger_name: "Déclencheur",
    status: "Statut",
    approval_policy: "Politique d'approbation",
    created_at: "Créé le",
  },
  connector_health: {
    software_name: "Logiciel",
    account_label: "Compte",
    environment: "Environnement",
    health_state: "Santé",
    authentication_state: "Authentification",
    last_successful_sync_at: "Dernière synchronisation réussie",
    last_failed_sync_at: "Dernier échec",
    api_version: "Version API",
    connector_version: "Version du connecteur",
    recommended_action: "Action recommandée",
    observed_at: "Observé le",
  },
} as const;

export type ExportEntity = keyof typeof exportFieldDefinitions;
export type ExportFormat = z.infer<typeof exportFormatSchema>;

export const createExportSchema = z.object({
  entityType: exportEntitySchema,
  format: exportFormatSchema,
  selectedFields: z.array(z.string().trim().min(1).max(64)).min(1).max(12),
  dateFrom: z.string().datetime(),
  dateTo: z.string().datetime(),
});

export const exportJobReferenceSchema = z.object({
  exportId: z.string().trim().min(1).max(96),
});

export type CreateExportInput = z.input<typeof createExportSchema>;

export function exportFieldNames(entityType: ExportEntity) {
  return Object.keys(exportFieldDefinitions[entityType]);
}
