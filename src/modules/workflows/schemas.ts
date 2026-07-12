import { z } from "zod";

export const workflowRunControlSchema = z.object({
  runId: z.string().min(1),
});

export type WorkflowRunControlInput = z.infer<typeof workflowRunControlSchema>;

export const workflowDeadLetterRetrySchema = z.object({
  eventId: z.string().min(1),
});

export type WorkflowDeadLetterRetryInput = z.infer<
  typeof workflowDeadLetterRetrySchema
>;

export const workflowQueueEventControlSchema = z.object({
  eventId: z.string().min(1),
});

export type WorkflowQueueEventControlInput = z.infer<
  typeof workflowQueueEventControlSchema
>;
