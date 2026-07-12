import { z } from "zod";

export const notificationChannelSchema = z.enum([
  "mock_email",
  "mock_sms",
  "mock_whatsapp",
]);

export const notificationDispatchPayloadSchema = z.object({
  notificationId: z.string().min(1),
});

export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export type NotificationDispatchPayload = z.infer<
  typeof notificationDispatchPayloadSchema
>;
