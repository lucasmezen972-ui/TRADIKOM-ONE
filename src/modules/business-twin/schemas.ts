import { z } from "zod";

export const onboardingSchema = z.object({
  companyName: z.string().min(2),
  category: z.string().min(2),
  description: z.string().min(10),
  services: z.string().min(2),
  products: z.string().default(""),
  targetCustomers: z.string().min(2),
  address: z.string().min(2),
  serviceAreas: z.string().min(2),
  phone: z.string().min(4),
  email: z.string().email(),
  openingHours: z.string().min(2),
  desiredCallsToAction: z.string().min(2),
  tone: z.string().min(2),
  colors: z.string().default(""),
  existingWebsite: z.string().default(""),
  socialLinks: z.string().default(""),
  photos: z.string().default(""),
  mainObjective: z.string().min(2),
  faqs: z.string().default(""),
  templateKey: z.enum(["artisan", "restaurant", "beauty"]),
});

export type OnboardingInput = z.input<typeof onboardingSchema>;
