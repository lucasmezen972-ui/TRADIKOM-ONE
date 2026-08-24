import { z } from "zod";

import {
  maxStalledOpportunityDays,
  minStalledOpportunityDays,
} from "@/lib/pipeline-stages";
import {
  maxStrategicMuteDays,
  minStrategicMuteDays,
} from "@/modules/strategic-advisor/rules";

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
 * Les bornes reprennent celles des contraintes SQL correspondantes : un refus
 * se voit ici, avec un message lisible, plutôt qu'en erreur de base.
 *
 * Chaque réglage est facultatif et seul ce qui est fourni est écrit : un
 * appelant qui ne touche qu'une préférence n'a pas à connaître la valeur de
 * l'autre, ni à risquer de l'écraser.
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
    )
    .optional(),
  strategicMuteDays: z.coerce
    .number()
    .int("La durée de sourdine doit être un nombre entier de jours.")
    .min(
      minStrategicMuteDays,
      `La sourdine doit durer au moins ${minStrategicMuteDays} jour.`,
    )
    .max(
      maxStrategicMuteDays,
      `La sourdine ne peut pas dépasser ${maxStrategicMuteDays} jours.`,
    )
    .optional(),
});

export type CreateTenantInput = z.input<typeof orgSchema>;
export type UpdateTenantPreferencesInput = z.input<
  typeof tenantPreferencesSchema
>;
export type CreateInvitationInput = z.input<typeof invitationSchema>;
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;
export type UpdateMemberRoleInput = z.input<typeof updateMemberRoleSchema>;
