import { z } from "zod";

export const softwareConnectionStatusSchema = z.enum([
  "oauth_pending",
  "connected",
  "authentication_expired",
  "unhealthy",
  "disconnected",
  "revoked",
]);

export const softwareConnectionEnvironmentSchema = z.enum([
  "mock",
  "sandbox",
  "production",
]);

export type SoftwareConnectionStatus = z.infer<
  typeof softwareConnectionStatusSchema
>;
