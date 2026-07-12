import { z } from "zod";
import type { DbClient } from "@/lib/db";
import { id, nowIso, toJson } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { WorkflowError } from "@/modules/workflows/errors";

export const workflowWebhookRequestedEventType = "workflow.webhook_requested";

const maxPayloadBytes = 64 * 1024;
const requestTimeoutMs = 10_000;
const sensitiveKeyPattern = /(authorization|cookie|password|secret|token|api[_-]?key)/i;

const workflowWebhookPayloadSchema = z.object({
  runId: z.string().min(1),
  targetUrl: z.string().url(),
  body: z.record(z.string(), z.unknown()),
});

export type WorkflowWebhookFetch = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number }>;

export async function queueWorkflowWebhook(
  db: DbClient,
  input: {
    tenantId: string;
    actorId: string;
    runId: string;
    targetUrl: string;
    body: Record<string, unknown>;
    actionIdempotencyKey: string;
    correlationId: string;
    causationId: string;
    createdAt?: string;
  },
) {
  const payload = validateWebhookPayload({
    runId: input.runId,
    targetUrl: input.targetUrl,
    body: input.body,
  });
  const idempotencyKey = `workflow.webhook:${input.runId}:${input.actionIdempotencyKey}`;
  const existing = await db.query<{ id: string }>(
    "select id from domain_events where tenant_id = $1 and idempotency_key = $2 limit 1",
    [input.tenantId, idempotencyKey],
  );

  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const eventId = id("event");
  const createdAt = input.createdAt ?? nowIso();
  await db.query(
    `insert into domain_events (
       id,
       tenant_id,
       actor_id,
       event_type,
       payload,
       status,
       attempts,
       idempotency_key,
       correlation_id,
       causation_id,
       next_run_at,
       last_error,
       created_at,
       updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (tenant_id, idempotency_key) do nothing`,
    [
      eventId,
      input.tenantId,
      input.actorId,
      workflowWebhookRequestedEventType,
      toJson(payload),
      "pending",
      0,
      idempotencyKey,
      input.correlationId,
      input.causationId,
      createdAt,
      null,
      createdAt,
      createdAt,
    ],
  );

  return eventId;
}

export async function dispatchWorkflowWebhook(
  db: DbClient,
  input: {
    tenantId: string;
    actorId: string;
    eventId: string;
    idempotencyKey: string;
    correlationId: string;
    payload: Record<string, unknown>;
    fetchImpl?: WorkflowWebhookFetch;
  },
) {
  const payload = validateWebhookPayload(input.payload);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response: { ok: boolean; status: number };

  try {
    try {
      response = await (input.fetchImpl ?? defaultWebhookFetch)(payload.targetUrl, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-tradikom-correlation-id": input.correlationId,
          "x-tradikom-idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify(payload.body),
      });
    } catch {
      throw new WorkflowError(
        "workflow_action_failed",
        controller.signal.aborted
          ? "Appel webhook expire."
          : "Appel webhook indisponible.",
      );
    }
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new WorkflowError(
      "workflow_action_failed",
      `Appel webhook echoue (HTTP ${response.status}).`,
    );
  }

  const target = new URL(payload.targetUrl);
  await db.query(
    "insert into activities (id, tenant_id, type, summary, target_type, target_id, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [
      id("activity"),
      input.tenantId,
      "workflow.webhook_dispatched",
      `Webhook workflow livre a ${target.hostname}.`,
      "workflow_run",
      payload.runId,
      nowIso(),
    ],
  );
  await recordAuditLog(db, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: "workflow.webhook_dispatched",
    targetType: "domain_event",
    targetId: input.eventId,
    metadata: {
      runId: payload.runId,
      targetHost: target.hostname,
      responseStatus: response.status,
      correlationId: input.correlationId,
    },
  });
}

function validateWebhookPayload(value: unknown) {
  const result = workflowWebhookPayloadSchema.safeParse(value);
  if (!result.success) {
    throw new WorkflowError(
      "workflow_action_failed",
      "Configuration webhook invalide.",
    );
  }

  const parsed = result.data;
  const target = new URL(parsed.targetUrl);

  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.search ||
    isPrivateHostname(target.hostname)
  ) {
    throw new WorkflowError(
      "workflow_action_failed",
      "URL webhook non autorisee.",
    );
  }

  if (containsSensitiveField(parsed.body)) {
    throw new WorkflowError(
      "workflow_action_failed",
      "La charge webhook contient un champ sensible interdit.",
    );
  }

  let serializedBody: string | undefined;
  try {
    serializedBody = JSON.stringify(parsed.body);
  } catch {
    throw new WorkflowError(
      "workflow_action_failed",
      "La charge webhook doit etre un objet JSON valide.",
    );
  }

  if (typeof serializedBody !== "string") {
    throw new WorkflowError(
      "workflow_action_failed",
      "La charge webhook doit etre un objet JSON valide.",
    );
  }

  if (Buffer.byteLength(serializedBody, "utf8") > maxPayloadBytes) {
    throw new WorkflowError(
      "workflow_action_failed",
      "La charge webhook depasse la taille autorisee.",
    );
  }

  return parsed;
}

function containsSensitiveField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsSensitiveField);
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  return Object.entries(value).some(
    ([key, child]) => sensitiveKeyPattern.test(key) || containsSensitiveField(child),
  );
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized === "::1" ||
    (normalized.includes(":") &&
      (normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe80:")))
  ) {
    return true;
  }

  const parts = normalized.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

async function defaultWebhookFetch(url: string, init: RequestInit) {
  return fetch(url, init);
}
