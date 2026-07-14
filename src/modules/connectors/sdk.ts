import { z } from "zod";

export const connectorStatusSchema = z.enum([
  "Disponible",
  "Connecté",
  "Configuration requise",
  "Erreur",
  "Bientôt disponible",
]);

export type ConnectorStatus = z.infer<typeof connectorStatusSchema>;

export type ConnectorAuthStrategy =
  | { type: "none" }
  | { type: "api_key"; headerName: string }
  | { type: "webhook_secret"; signatureHeader: string }
  | { type: "csv_upload" };

export type ConnectorMetadata = {
  key: string;
  name: string;
  description: string;
  status: ConnectorStatus;
  capabilities: string[];
  auth: ConnectorAuthStrategy;
};

export type ConnectorHealth = {
  status: "healthy" | "warning" | "error" | "inactive";
  message: string;
  checkedAt: string;
};

export type ConnectorError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type ConnectorDefinition<TConfig = unknown> = {
  metadata: ConnectorMetadata;
  configSchema: z.ZodType<TConfig>;
  testConnection: (config: TConfig) => Promise<ConnectorHealth>;
  normalizeError: (error: unknown) => ConnectorError;
};

export function normalizeConnectorError(error: unknown): ConnectorError {
  void error;
  return {
    code: "connector_error",
    message: "Erreur connecteur",
    retryable: false,
  };
}
