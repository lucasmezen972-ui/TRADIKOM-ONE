import type { ChannelAdapterState } from "@/modules/channels/contracts";
import {
  verifyAndPrepareTeamsActivity,
  type PreparedTeamsInboundMessage,
} from "@/modules/channels/teams-microsoft-webhook";

const maxTeamsWebhookBytes = 1024 * 1024;

type SafeReceiveResult =
  | { accepted: true }
  | { accepted: false; code: string };

export async function handlePreparedTeamsWebhookRequest(
  request: Request,
  dependencies: {
    state: ChannelAdapterState;
    clientId: string | undefined;
    tenantId: string | undefined;
    receive: (
      message: PreparedTeamsInboundMessage,
    ) => Promise<SafeReceiveResult> | SafeReceiveResult;
    verify?: typeof verifyAndPrepareTeamsActivity;
  },
) {
  if (dependencies.state !== "ready") {
    return jsonResponse(
      { ok: false, error: "Canal Microsoft Teams indisponible." },
      { status: 503, headers: { "Retry-After": "300" } },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return jsonResponse(
      { ok: false, error: "Type de contenu refusé." },
      { status: 415 },
    );
  }

  const body = await readBoundedUtf8Body(request);
  if (!body.ok) {
    return jsonResponse(
      {
        ok: false,
        error:
          body.code === "payload_too_large"
            ? "Webhook trop volumineux."
            : "Webhook invalide.",
      },
      { status: body.code === "payload_too_large" ? 413 : 400 },
    );
  }

  const verify = dependencies.verify ?? verifyAndPrepareTeamsActivity;
  const verified = await verify(
    {
      authorization: request.headers.get("authorization") ?? undefined,
      rawBody: body.value,
    },
    { clientId: dependencies.clientId, tenantId: dependencies.tenantId },
  );
  if (!verified.ok) {
    if (verified.code === "unsupported_activity") {
      return jsonResponse({ ok: true, ignored: true }, { status: 202 });
    }
    if (verified.code === "payload_too_large") {
      return jsonResponse(
        { ok: false, error: "Webhook trop volumineux." },
        { status: 413 },
      );
    }
    return jsonResponse(
      { ok: false, error: "Webhook refusé." },
      { status: verified.code === "invalid_authorization" ? 401 : 400 },
    );
  }

  const result = await dependencies.receive(verified.message);
  if (result.accepted) return jsonResponse({ ok: true });
  if (result.code === "channel_provider_endpoint_not_found") {
    return jsonResponse(
      { ok: false, error: "Webhook temporairement non attribué." },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
  return jsonResponse(
    { ok: false, error: "Webhook invalide." },
    { status: 400 },
  );
}

async function readBoundedUtf8Body(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && !/^\d+$/.test(contentLength)) {
    return { ok: false as const, code: "payload_invalid" as const };
  }
  if (contentLength && Number(contentLength) > maxTeamsWebhookBytes) {
    return { ok: false as const, code: "payload_too_large" as const };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true as const, value: "" };
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxTeamsWebhookBytes) {
        await reader.cancel();
        return { ok: false as const, code: "payload_too_large" as const };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      ok: true as const,
      value: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return { ok: false as const, code: "payload_invalid" as const };
  }
}

function jsonResponse(body: Record<string, unknown>, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

