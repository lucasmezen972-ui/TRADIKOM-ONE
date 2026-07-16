import { z } from "zod";

export const mockOAuthScopeSchema = z.enum(["contacts.read", "profile.read"]);

export const startMockOAuthSchema = z.object({
  accountLabel: z.string().trim().min(1).max(120).default("Compte de test"),
  scopes: z
    .array(mockOAuthScopeSchema)
    .min(1)
    .max(2)
    .default(["contacts.read", "profile.read"]),
});

export const mockOAuthCallbackSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{40,160}$/),
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  redirectUri: z.string().url().max(500),
});

export const mockOAuthAuthorizationRequestSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{40,160}$/),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  redirectUri: z.string().url().max(500),
});

export const softwareConnectionReferenceSchema = z.object({
  connectionId: z.string().trim().min(1).max(160),
});

export type StartMockOAuthInput = z.input<typeof startMockOAuthSchema>;
export type MockOAuthCallbackInput = z.input<typeof mockOAuthCallbackSchema>;
export type MockOAuthAuthorizationRequestInput = z.input<
  typeof mockOAuthAuthorizationRequestSchema
>;
