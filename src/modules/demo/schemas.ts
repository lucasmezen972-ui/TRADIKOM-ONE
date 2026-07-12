import { z } from "zod";

export const demoSeedSchema = z.object({
  name: z.string().min(2).default("Malia Occo"),
  email: z
    .string()
    .email()
    .default("patron@garage-caraibes-auto.example"),
  password: z.string().min(8).default("Tradikom!2026"),
  tenantName: z.string().min(2).default("Garage Caraibes Auto"),
  category: z.string().min(2).default("Garage automobile"),
});

export type DemoSeedInput = z.input<typeof demoSeedSchema>;
