import { isTrustedNativeDocumentRequest } from "@/modules/conversation-hub/native-document-http";
import { getDb } from "@/lib/db";
import { getTenantIdFromCookie } from "@/lib/security";
import { getServices } from "@/lib/services";
import { getCurrentSession } from "@/lib/session";
import { resolveAppUrl } from "@/modules/email";
import { readNativeConversationDocument } from "@/modules/conversation-hub/native-documents";
import { logServerError, resolveCorrelationId } from "@/modules/request-context";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
export async function POST(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  // Cookie-bound authenticated download. No GET, query token, cross-origin or request body.
  if (!await isTrustedNativeDocumentRequest(request, resolveAppUrl())) return Response.json({ error: "Requête refusée." }, { status: 403, headers });
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Connexion requise." }, { status: 401, headers });
  const tenant = await (await getServices()).getTenantContext(session.user.id, await getTenantIdFromCookie());
  if (!tenant) return Response.json({ error: "Organisation indisponible." }, { status: 403, headers });
  try {
    const file = await readNativeConversationDocument(await getDb(), session.user.id, tenant.tenant.id, (await context.params).attachmentId);
    return new Response(new Uint8Array(file.bytes), { headers: { ...headers, "content-type": file.mediaType,
      "content-length": String(file.bytes.length), "content-disposition": `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}` } });
  } catch (error) {
    const mapped = logServerError({ operation: "conversation.document.download", correlationId: resolveCorrelationId(request.headers.get("x-correlation-id")), error });
    return Response.json({ error: mapped.message }, { status: mapped.status, headers });
  }
}
