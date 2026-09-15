import type { ChannelAdapterState } from "@/modules/channels/contracts";

const maxWebhookBytes = 512 * 1024;

type SafeReceiveResult =
  | { accepted: true }
  | { accepted: false; code: string };

export async function handlePreparedResendWebhookRequest(
  request: Request,
  dependencies: {
    state: ChannelAdapterState;
    receive: (input: {
      rawBody: string;
      headers: {
        id: string;
        timestamp: string;
        signature: string;
      };
    }) => Promise<SafeReceiveResult>;
  },
) {
  if (dependencies.state !== "ready") {
    return jsonResponse(
      { ok: false, error: "Canal email indisponible." },
      { status: 503, headers: { "Retry-After": "300" } },
    );
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
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
    headers: {
      id: request.headers.get("svix-id") ?? "",
      timestamp: request.headers.get("svix-timestamp") ?? "",
      signature: request.headers.get("svix-signature") ?? "",
    },
  });

  if (result.accepted) {
    return jsonResponse({ ok: true });
  }

  return rejectedResponse(result.code);
}

async function readBoundedUtf8Body(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    !/^\d+$/.test(contentLength)
  ) {
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

  const body = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      ok: true as const,
      value: new TextDecoder("utf-8", { fatal: true }).decode(body),
    };
  } catch {
    return { ok: false as const, code: "payload_invalid" as const };
  }
}

function rejectedResponse(code: string) {
  if (code === "unsupported_event") {
    return jsonResponse({ ok: true, ignored: true });
  }
  if (code === "payload_too_large") {
    return jsonResponse(
      { ok: false, error: "Webhook trop volumineux." },
      { status: 413 },
    );
  }
  if (code === "not_configured") {
    return jsonResponse(
      { ok: false, error: "Canal email indisponible." },
      { status: 503, headers: { "Retry-After": "300" } },
    );
  }
  if (code === "email_provider_delivery_not_found") {
    return jsonResponse(
      { ok: false, error: "Webhook temporairement non attribué." },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }
  if (code === "email_provider_event_conflict") {
    return jsonResponse(
      { ok: false, error: "Webhook en conflit." },
      { status: 409 },
    );
  }
  if (code === "invalid_signature" || code === "invalid_headers") {
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

function isJsonContentType(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function jsonResponse(
  body: Record<string, unknown>,
  init: ResponseInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}
