import { z } from "zod";

export const websiteSectionUpdateSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  imageUrl: z.string().optional(),
  buttonLabel: z.string().optional(),
  buttonHref: z.string().optional(),
  enabled: z.boolean(),
});

export const moveWebsiteSectionSchema = z.object({
  direction: z.enum(["up", "down"]),
});

export const restoreWebsiteVersionSchema = z.object({
  versionId: z.string().min(1),
});

export type WebsiteSectionUpdateInput = z.input<
  typeof websiteSectionUpdateSchema
>;
export type MoveWebsiteSectionInput = z.input<typeof moveWebsiteSectionSchema>;
