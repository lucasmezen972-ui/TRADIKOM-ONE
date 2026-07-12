import { z } from "zod";

export const emailAddressSchema = z.string().trim().email().transform((value) =>
  value.toLowerCase(),
);

export const passwordResetEmailSchema = z.object({
  to: emailAddressSchema,
  token: z.string().min(32),
  appUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});

export const invitationEmailSchema = z.object({
  to: emailAddressSchema,
  token: z.string().min(32),
  appUrl: z.string().url(),
  expiresAt: z.string().datetime(),
  organizationName: z.string().min(1),
  roleLabel: z.string().min(1),
});

export type PasswordResetEmailInput = z.input<typeof passwordResetEmailSchema>;
export type InvitationEmailInput = z.input<typeof invitationEmailSchema>;
