import { z } from "zod";
import {
  normalizeConnectorError,
  type ConnectorDefinition,
} from "@/modules/connectors/sdk";

export const genericWebhookConnector: ConnectorDefinition<{ secret?: string }> = {
  metadata: {
    key: "generic_webhook",
    name: "Webhook générique",
    description: "Réception JSON sécurisée avec signature optionnelle.",
    status: "Connecté",
    capabilities: ["webhook", "hmac", "mapping contact", "journal livraisons"],
    auth: { type: "webhook_secret", signatureHeader: "x-tradikom-signature" },
  },
  configSchema: z.object({ secret: z.string().optional() }),
  async testConnection() {
    return {
      status: "healthy",
      message: "Endpoint webhook prêt.",
      checkedAt: new Date().toISOString(),
    };
  },
  normalizeError: normalizeConnectorError,
};

export const csvContactsConnector: ConnectorDefinition<{ maxRows: number }> = {
  metadata: {
    key: "csv_contacts",
    name: "Import CSV contacts",
    description: "Import robuste avec guillemets, virgules et prévisualisation.",
    status: "Disponible",
    capabilities: ["csv", "validation", "doublons", "rapport import"],
    auth: { type: "csv_upload" },
  },
  configSchema: z.object({ maxRows: z.number().int().positive().default(1000) }),
  async testConnection() {
    return {
      status: "inactive",
      message: "Import disponible à la demande.",
      checkedAt: new Date().toISOString(),
    };
  },
  normalizeError: normalizeConnectorError,
};

export const mockBusinessConnector: ConnectorDefinition<{ cursor?: string }> = {
  metadata: {
    key: "mock_business",
    name: "Logiciel métier démo",
    description: "Connecteur SDK d'exemple avec données déterministes.",
    status: "Configuration requise",
    capabilities: ["sync", "clients", "rendez-vous", "devis", "idempotence"],
    auth: { type: "none" },
  },
  configSchema: z.object({ cursor: z.string().optional() }),
  async testConnection() {
    return {
      status: "healthy",
      message: "Connecteur mock disponible.",
      checkedAt: new Date().toISOString(),
    };
  },
  normalizeError: normalizeConnectorError,
};

export const connectorRegistry = [
  genericWebhookConnector,
  csvContactsConnector,
  mockBusinessConnector,
];
