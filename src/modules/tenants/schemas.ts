import { z } from "zod";

import {
  maxStalledOpportunityDays,
  minStalledOpportunityDays,
} from "@/lib/pipeline-stages";

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

/**
 * Les bornes reprennent celles de la contrainte SQL `tenants_stalled_
 * opportunity_days_range` : un refus se voit ici, avec un message lisible,
 * plutôt qu'en erreur de base.
 */
export const tenantPreferencesSchema = z.object({
  stalledOpportunityDays: z.coerce
    .number()
    .int("Le seuil doit être un nombre entier de jours.")
    .min(
      minStalledOpportunityDays,
      `Le seuil doit être d'au moins ${minStalledOpportunityDays} jour.`,
    )
    .max(
      maxStalledOpportunityDays,
      `Le seuil ne peut pas dépasser ${maxStalledOpportunityDays} jours.`,
    ),
});

export type CreateTenantInput = z.input<typeof orgSchema>;
export type UpdateTenantPreferencesInput = z.input<
  typeof tenantPreferencesSchema
>;
export type CreateInvitationInput = z.input<typeof invitationSchema>;
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;
export type UpdateMemberRoleInput = z.input<typeof updateMemberRoleSchema>;
