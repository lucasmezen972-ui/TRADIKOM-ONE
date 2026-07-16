import { z } from "zod";

export const connectorInstallationStatusSchema = z.enum([
  "proposed",
  "sandbox_approved",
  "installed_disabled",
  "read_only_enabled",
  "write_approval_required",
  "write_enabled",
  "suspended",
  "authentication_expired",
  "unhealthy",
  "disconnected",
  "revoked",
]);

export const connectorHealthStateSchema = z.enum([
  "healthy",
  "degraded",
  "action_required",
  "authentication_required",
  "rate_limited",
  "schema_changed",
  "suspended",
  "disconnected",
  "unknown",
]);

export const prepareMockInstallationSchema = z.object({
  connectionId: z.string().trim().min(1).max(160),
});

export const connectorInstallationReferenceSchema = z.object({
  installationId: z.string().trim().min(1).max(160),
});

export const executeConnectorOperationSchema = z.object({
  installationId: z.string().trim().min(1).max(160),
  operation: z.string().trim().min(1).max(120),
  capability: z.enum(["read", "write"]),
  environment: z.enum(["mock", "sandbox", "production"]),
  idempotencyKey: z.string().trim().min(8).max(160),
  correlationId: z
    .string()
    .trim()
    .min(8)
    .max(160)
    .regex(/^[A-Za-z0-9._:-]+$/),
});

export type ConnectorInstallationStatus = z.infer<
  typeof connectorInstallationStatusSchema
>;
export type ConnectorHealthState = z.infer<typeof connectorHealthStateSchema>;
export type ExecuteConnectorOperationInput = z.input<
  typeof executeConnectorOperationSchema
>;
