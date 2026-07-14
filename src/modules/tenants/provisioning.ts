import type { DbClient } from "@/lib/db";
import { id, nowIso, toJson } from "@/lib/security";
import { connectorCatalog } from "@/modules/connectors/catalog";
import {
  configureWebhookEndpointSecret,
  generateWebhookEndpointSecretValue,
} from "@/modules/connectors/webhooks";
import {
  insertProvisionedConnector,
  insertProvisionedPipeline,
  insertProvisionedPipelineStage,
  insertProvisionedWebhookEndpoint,
  insertProvisionedWorkflow,
} from "@/modules/tenants/provisioning-repository";
import { leadFollowUpWorkflow } from "@/modules/workflows/engine";
import { provisionDefaultAiEmployees } from "@/modules/ai-employees/provisioning";

const defaultPipelineStages = [
  "Nouveau contact",
  "A qualifier",
  "Rendez-vous prevu",
  "Devis envoye",
  "Gagne",
  "Perdu",
];

export async function createDefaultTenantResources(
  db: DbClient,
  tenantId: string,
) {
  const now = nowIso();
  const pipelineId = id("pipeline");
  await insertProvisionedPipeline(db, {
    id: pipelineId,
    tenantId,
    name: "Pipeline commercial",
    createdAt: now,
  });

  for (const [index, stage] of defaultPipelineStages.entries()) {
    await insertProvisionedPipelineStage(db, {
      id: id("stage"),
      tenantId,
      pipelineId,
      name: stage,
      position: index + 1,
    });
  }

  await insertProvisionedWorkflow(db, {
    id: id("workflow"),
    tenantId,
    workflowKey: leadFollowUpWorkflow.key,
    name: "Suivi automatique des nouveaux leads site",
    triggerName: leadFollowUpWorkflow.trigger,
    status: "active",
    approvalPolicy: leadFollowUpWorkflow.approvalPolicy,
    definition: toJson(leadFollowUpWorkflow),
    createdAt: now,
  });

  for (const connector of connectorCatalog.slice(0, 3)) {
    await insertProvisionedConnector(db, {
      id: id("connector"),
      tenantId,
      connectorKey: connector.key,
      status: connector.status,
      health: connector.health,
      safeConfig: toJson({ sandbox: true }),
      lastSyncAt: connector.lastSyncAt ?? null,
      createdAt: now,
    });
  }

  const webhookEndpointId = id("webhook");
  await insertProvisionedWebhookEndpoint(db, {
    id: webhookEndpointId,
    tenantId,
    token: id("wh"),
    status: "active",
    createdAt: now,
  });
  await configureWebhookEndpointSecret(db, {
    tenantId,
    endpointId: webhookEndpointId,
    secret: generateWebhookEndpointSecretValue(),
  });

  await provisionDefaultAiEmployees(db, tenantId);
}
