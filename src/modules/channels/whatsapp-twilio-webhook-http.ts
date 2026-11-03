import type { ChannelAdapterState } from "@/modules/channels/contracts";
const maxWebhookBytes = 512 * 1024;

type SafeReceiveResult =
  | { accepted: true }
  | { accepted: false; code: string };

export async function handlePreparedTwilioWebhookRequest(
  request: Request,
  dependencies: {
    state: ChannelAdapterState;
    verificationUrl: string | undefined;
    receive: (input: {
      url: string;
      contentType: string;
      rawBody: string;
      signature: string;
    }) => Promise<SafeReceiveResult> | SafeReceiveResult;
  },
) {
  if (
    dependencies.state !== "ready" ||
    !isAcceptedVerificationUrl(dependencies.verificationUrl)
  ) {
    return jsonResponse(
      { ok: false, error: "Canal WhatsApp indisponible." },
      { status: 503, headers: { "Retry-After": "300" } },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!isSupportedContentType(contentType)) {
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
    url: dependencies.verificationUrl.trim(),
    contentType,
    rawBody: body.value,
    signature: request.headers.get("x-twilio-signature") ?? "",
  });

  if (result.accepted) {
    return jsonResponse({ ok: true });
  }

  return rejectedResponse(result.code);
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
  if (code === "not_configured") {
    return jsonResponse(
      { ok: false, error: "Canal WhatsApp indisponible." },
      { status: 503, headers: { "Retry-After": "300" } },
    );
  }
  if (code === "channel_provider_endpoint_not_found") {
    return jsonResponse(
      { ok: false, error: "Webhook temporairement non attribué." },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
  if (code === "channel_provider_delivery_not_found") {
    return jsonResponse(
      { ok: false, error: "Statut temporairement non attribué." },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
  if (code === "channel_provider_delivery_event_conflict") {
    return jsonResponse(
      { ok: false, error: "Événement de statut en conflit." },
      { status: 409 },
    );
  }
  if (code === "payload_too_large") {
    return jsonResponse(
      { ok: false, error: "Webhook trop volumineux." },
      { status: 413 },
    );
  }
  if (code === "unsupported_content_type") {
    return jsonResponse(
      { ok: false, error: "Type de contenu refusé." },
      { status: 415 },
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

function isSupportedContentType(value: string) {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/x-www-form-urlencoded" ||
    mediaType === "application/json"
  );
}

function isAcceptedVerificationUrl(
  value: string | undefined,
): value is string {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function jsonResponse(body: Record<string, unknown>, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}
