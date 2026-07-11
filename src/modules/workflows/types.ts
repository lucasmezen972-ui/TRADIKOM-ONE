import { z } from "zod";

export const workflowActionSchema = z.object({
  type: z.enum([
    "create_task",
    "update_contact",
    "add_tag",
    "create_activity",
    "send_mock_email",
    "send_mock_sms",
    "send_mock_whatsapp",
    "call_webhook",
    "wait_for_duration",
    "request_approval",
  ]),
  input: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().optional(),
});

export const workflowDefinitionSchema = z.object({
  key: z.string().min(1),
  version: z.number().int().positive(),
  trigger: z.string().min(1),
  active: z.boolean(),
  conditions: z.array(z.string()).default([]),
  actions: z.array(workflowActionSchema).min(1),
  retryPolicy: z.object({
    maxAttempts: z.number().int().min(1).max(10),
    backoffMs: z.number().int().min(0),
  }),
  timeoutMs: z.number().int().min(1000),
  approvalPolicy: z.enum([
    "no_approval_required",
    "user_approval_required",
    "administrator_approval_required",
    "prohibited_automatic_execution",
  ]),
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowAction = z.infer<typeof workflowActionSchema>;

export type WorkflowEvent = {
  id: string;
  tenantId: string;
  actorId: string;
  type: string;
  payload: Record<string, unknown>;
  correlationId: string;
  causationId?: string;
  idempotencyKey: string;
  nextRunAt?: string;
};
