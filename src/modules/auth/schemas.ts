import { z } from "zod";

export const registrationSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

export const passwordResetSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
});

export type RegistrationInput = z.input<typeof registrationSchema>;
export type LoginInput = z.input<typeof loginSchema>;
export type PasswordResetRequestInput = z.input<
  typeof passwordResetRequestSchema
>;
export type PasswordResetInput = z.input<typeof passwordResetSchema>;
