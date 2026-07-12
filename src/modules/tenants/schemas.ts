import { z } from "zod";

export const invitationRoles = [
  "administrator",
  "manager",
  "collaborator",
  "read-only",
] as const;

export const orgSchema = z.object({
  name: z.string().min(2),
  category: z.string().min(2),
});

export const invitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(invitationRoles),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(20),
  name: z.string().min(2),
  password: z.string().min(8),
});

export const updateMemberRoleSchema = z.object({
  targetUserId: z.string().min(1),
  role: z.enum(invitationRoles),
});

export type CreateTenantInput = z.input<typeof orgSchema>;
export type CreateInvitationInput = z.input<typeof invitationSchema>;
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;
export type UpdateMemberRoleInput = z.input<typeof updateMemberRoleSchema>;
