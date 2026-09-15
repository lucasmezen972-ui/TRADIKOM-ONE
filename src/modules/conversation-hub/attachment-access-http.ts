import { z } from "zod";
import {
  ConversationAttachmentAccessError,
  type AttachmentAccessFailed,
  type AttachmentAccessUnavailable,
  prepareConversationAttachmentAccess,
  readConversationAttachment,
} from "@/modules/conversation-hub/attachment-access";

const maximumJsonBytes = 4 * 1024;
const attachmentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const readBodySchema = z
  .object({
    ticket: z.string().min(80).max(3_000).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

type PrepareResult = Awaited<
  ReturnType<typeof prepareConversationAttachmentAccess>
>;
type ReadResult = Awaited<ReturnType<typeof readConversationAttachment>>;

export type AttachmentAccessHttpContext =
  | { status: "authenticated"; userId: string; tenantId: string }
  | { status: "unauthenticated" }
  | { status: "tenant_not_found" };

export type AttachmentAccessHttpDependencies = {
  expectedOrigin: string;
  correlationId: string;
  resolveContext: () =>
    | AttachmentAccessHttpContext
    | Promise<AttachmentAccessHttpContext>;
  prepare: (input: {
    userId: string;
    tenantId: string;
    attachmentId: string;
  }) => PrepareResult | Promise<PrepareResult>;
  read: (input: {
    userId: string;
    tenantId: string;
    attachmentId: string;
    ticket: string;
  }) => ReadResult | Promise<ReadResult>;
};

export async function handleConversationAttachmentAccessRequest(
  request: Request,
  input: { attachmentId: string },
  dependencies: AttachmentAccessHttpDependencies,
) {
  if (request.method !== "POST" && request.method !== "PUT") {
    return jsonResponse(
      { ok: false, error: "Méthode non autorisée." },
      405,
      dependencies.correlationId,
      { allow: "POST, PUT" },
    );
  }
  if (!isTrustedOrigin(request, dependencies.expectedOrigin)) {
    return jsonResponse(
      { ok: false, error: "Origine de la requête refusée." },
      403,
      dependencies.correlationId,
    );
  }

  const context = await dependencies.resolveContext();
  if (context.status === "unauthenticated") {
    return jsonResponse(
      { ok: false, error: "Authentification requise." },
      401,
      dependencies.correlationId,
    );
  }
  if (context.status === "tenant_not_found") {
    return jsonResponse(
      { ok: false, error: "Organisation introuvable." },
      403,
      dependencies.correlationId,
    );
  }

  const parsedAttachmentId = attachmentIdSchema.safeParse(input.attachmentId);
  if (!parsedAttachmentId.success) {
    return invalidRequestResponse(dependencies.correlationId);
  }

  try {
    if (request.method === "POST") {
      if (request.body) {
        return invalidRequestResponse(dependencies.correlationId);
      }
      const result = await dependencies.prepare({
        userId: context.userId,
        tenantId: context.tenantId,
        attachmentId: parsedAttachmentId.data,
      });
      return prepareResponse(result, dependencies.correlationId);
    }

    if (!isJsonContentType(request.headers.get("content-type") ?? "")) {
      return jsonResponse(
        { ok: false, error: "Type de contenu refusé." },
        415,
        dependencies.correlationId,
      );
    }
    const body = await readBoundedJson(request);
    if (!body.ok) {
      return jsonResponse(
        {
          ok: false,
          error:
            body.code === "payload_too_large"
              ? "Requête trop volumineuse."
              : "Requête invalide.",
        },
        body.code === "payload_too_large" ? 413 : 400,
        dependencies.correlationId,
      );
    }
    const parsedBody = readBodySchema.safeParse(body.value);
    if (!parsedBody.success) {
      return invalidRequestResponse(dependencies.correlationId);
    }
    const result = await dependencies.read({
      userId: context.userId,
      tenantId: context.tenantId,
      attachmentId: parsedAttachmentId.data,
      ticket: parsedBody.data.ticket,
    });
    return readResponse(result, dependencies.correlationId);
  } catch (error) {
    return knownAccessErrorResponse(error, dependencies.correlationId);
  }
}

function prepareResponse(result: PrepareResult, correlationId: string) {
  if (result.status === "ready") {
    return jsonResponse(
      {
        ok: true,
        status: "ready",
        ticket: result.ticket,
        expiresAt: result.expiresAt,
      },
      200,
      correlationId,
    );
  }
  if (result.status === "denied") {
    return deniedResponse(correlationId);
  }
  return unavailableResponse(result, correlationId);
}

function readResponse(result: ReadResult, correlationId: string) {
  if (result.status === "succeeded") {
    return new Response(new Uint8Array(result.content), {
      status: 200,
      headers: secureHeaders(correlationId, {
        "content-disposition": contentDisposition(result.fileName),
        "content-length": String(result.content.byteLength),
        "content-type": result.contentType,
      }),
    });
  }
  if (result.status === "denied") {
    return deniedResponse(correlationId);
  }
  if (result.status === "failed") {
    return failedResponse(result, correlationId);
  }
  return unavailableResponse(result, correlationId);
}

function unavailableResponse(
  result: AttachmentAccessUnavailable,
  correlationId: string,
) {
  const disabled = result.status === "disabled";
  return jsonResponse(
    {
      ok: false,
      status: result.status,
      error: disabled
        ? "Téléchargement désactivé."
        : "Téléchargement non configuré.",
    },
    503,
    correlationId,
    disabled ? undefined : { "retry-after": "300" },
  );
}

function deniedResponse(correlationId: string) {
  return jsonResponse(
    { ok: false, error: "Accès à cette pièce jointe refusé." },
    403,
    correlationId,
  );
}

function failedResponse(
  result: AttachmentAccessFailed,
  correlationId: string,
) {
  const temporary = result.classification === "temporary";
  return jsonResponse(
    {
      ok: false,
      error: temporary
        ? "Téléchargement temporairement indisponible."
        : "Cette pièce jointe n’est pas disponible.",
    },
    temporary ? 503 : 422,
    correlationId,
    temporary ? { "retry-after": "30" } : undefined,
  );
}

function knownAccessErrorResponse(error: unknown, correlationId: string) {
  if (error instanceof ConversationAttachmentAccessError) {
    if (error.code === "attachment_access_ticket_expired") {
      return jsonResponse(
        { ok: false, error: "Le lien temporaire a expiré." },
        410,
        correlationId,
      );
    }
    return jsonResponse(
      { ok: false, error: "Cette pièce jointe n’est pas disponible." },
      404,
      correlationId,
    );
  }
  if (safeErrorCode(error) === "tenant_access_denied") {
    return deniedResponse(correlationId);
  }
  throw error;
}

function invalidRequestResponse(correlationId: string) {
  return jsonResponse(
    { ok: false, error: "Requête invalide." },
    400,
    correlationId,
  );
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  correlationId: string,
  extraHeaders?: HeadersInit,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: secureHeaders(correlationId, {
      "content-type": "application/json; charset=utf-8",
      ...Object.fromEntries(new Headers(extraHeaders).entries()),
    }),
  });
}

function secureHeaders(correlationId: string, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-correlation-id", correlationId);
  return headers;
}

function isTrustedOrigin(request: Request, expectedOrigin: string) {
  try {
    return (
      request.headers.get("origin") === new URL(expectedOrigin).origin &&
      new URL(request.url).origin === new URL(expectedOrigin).origin
    );
  } catch {
    return false;
  }
}

function isJsonContentType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function readBoundedJson(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && !/^\d+$/.test(contentLength)) {
    return { ok: false as const, code: "payload_invalid" as const };
  }
  if (contentLength && Number(contentLength) > maximumJsonBytes) {
    return { ok: false as const, code: "payload_too_large" as const };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false as const, code: "payload_invalid" as const };
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maximumJsonBytes) {
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
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true as const, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false as const, code: "payload_invalid" as const };
  }
}

function contentDisposition(fileName: string) {
  const ascii =
    fileName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(0, 180) || "piece-jointe";
  const encoded = encodeURIComponent(fileName).replace(/[!'()*]/g, (value) =>
    `%${value.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function safeErrorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}
