import { z } from "zod";

export const accountDeletionConfirmationText = "SUPPRIMER";

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Le mot de passe est requis."),
  confirmation: z
    .string()
    .refine(
      (value) => value.trim().toUpperCase() === accountDeletionConfirmationText,
      `Saisissez « ${accountDeletionConfirmationText} » pour confirmer la suppression.`,
    ),
});

export type DeleteAccountInput = z.input<typeof deleteAccountSchema>;
