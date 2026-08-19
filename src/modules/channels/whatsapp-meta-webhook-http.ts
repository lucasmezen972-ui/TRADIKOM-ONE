import { timingSafeEqual } from "node:crypto";
import type { ChannelAdapterState } from "@/modules/channels/contracts";

const maxWebhookBytes = 512 * 1024;
const maxChallengeLength = 256;

type SafeReceiveResult =
  | { accepted: true }
  | { accepted: false; code: string };

export async function handlePreparedMetaWhatsAppWebhookRequest(
  request: Request,
  dependencies: {
    state: ChannelAdapterState;
    appSecret: string | undefined;
    verifyToken: string | undefined;
    receive: (input: {
      rawBody: string;
      signature: string;
    }) => Promise<SafeReceiveResult> | SafeReceiveResult;
  },
) {
  if (request.method === "GET") {
    return verifyMetaWebhookChallenge(request, dependencies);
  }
  if (request.method === "POST") {
    return receiveMetaWebhookEvent(request, dependencies);
  }
  return jsonResponse(
    { ok: false, error: "Méthode non autorisée." },
    { status: 405, headers: { allow: "GET, POST" } },
  );
}

function verifyMetaWebhookChallenge(
  request: Request,
  dependencies: {
    state: ChannelAdapterState;
    verifyToken: string | undefined;
    receive: (input: {
      rawBody: string;
      signature: string;
    }) => Promise<SafeReceiveResult> | SafeReceiveResult;
  },
) {
  if (dependencies.state !== "ready" || !dependencies.verifyToken?.trim()) {
    return unavailableResponse();
  }

  const search = new URL(request.url).searchParams;
  const mode = singleSearchParameter(search, "hub.mode");
  const token = singleSearchParameter(search, "hub.verify_token");
  const challenge = singleSearchParameter(search, "hub.challenge");
  if (
    mode !== "subscribe" ||
    !token ||
    !challenge ||
    !isSafeChallenge(challenge) ||
    !safeTokenEquals(token, dependencies.verifyToken.trim())
  ) {
    return jsonResponse(
      { ok: false, error: "Validation du webhook refusée." },
      { status: 403 },
    );
  }

  return textResponse(challenge);
}

async function receiveMetaWebhookEvent(
  request: Request,
  dependencies: {
    state: ChannelAdapterState;
    appSecret: string | undefined;
    receive: (input: {
      rawBody: string;
      signature: string;
    }) => Promise<SafeReceiveResult> | SafeReceiveResult;
  },
) {
  if (dependencies.state !== "ready" || !dependencies.appSecret?.trim()) {
    return unavailableResponse();
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!isJsonContentType(contentType)) {
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

  const result = await dependencies.receive({
    rawBody: body.value,
    signature: request.headers.get("x-hub-signature-256") ?? "",
  });
  if (result.accepted) return jsonResponse({ ok: true });
  return rejectedResponse(result.code);
}

function singleSearchParameter(search: URLSearchParams, name: string) {
  const values = search.getAll(name);
  return values.length === 1 ? values[0] : null;
}

function isSafeChallenge(value: string) {
  return (
    value.length > 0 &&
    value.length <= maxChallengeLength &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

function safeTokenEquals(supplied: string, expected: string) {
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

async function readBoundedUtf8Body(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && !/^\d+$/.test(contentLength)) {
    return { ok: false as const, code: "payload_invalid" as const };
  }
  if (contentLength && Number(contentLength) > maxWebhookBytes) {
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
      if (receivedBytes > maxWebhookBytes) {
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

function rejectedResponse(code: string) {
  if (code === "not_configured") return unavailableResponse();
  if (code === "channel_provider_endpoint_not_found") {
    return jsonResponse(
      { ok: false, error: "Webhook temporairement non attribué." },
      { status: 503, headers: { "retry-after": "60" } },
    );
  }
  if (code === "payload_too_large") {
    return jsonResponse(
      { ok: false, error: "Webhook trop volumineux." },
      { status: 413 },
    );
  }
  if (code === "invalid_signature") {
    return jsonResponse(
      { ok: false, error: "Webhook refusé." },
      { status: 401 },
    );
  }
  return jsonResponse(
    { ok: false, error: "Webhook invalide." },
    { status: 400 },
  );
}

function isJsonContentType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function unavailableResponse() {
  return jsonResponse(
    { ok: false, error: "Canal WhatsApp indisponible." },
    { status: 503, headers: { "retry-after": "300" } },
  );
}

function jsonResponse(body: Record<string, unknown>, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function textResponse(value: string) {
  return new Response(value, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
