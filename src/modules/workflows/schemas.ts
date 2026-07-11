import { z } from "zod";

export const workflowRunControlSchema = z.object({
  runId: z.string().min(1),
});

export type WorkflowRunControlInput = z.infer<typeof workflowRunControlSchema>;
