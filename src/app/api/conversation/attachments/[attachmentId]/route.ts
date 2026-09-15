import { getTenantIdFromCookie } from "@/lib/security";
import { getServices } from "@/lib/services";
import { getCurrentSession } from "@/lib/session";
import { getConversationChannelServices } from "@/modules/channels";
import {
  handleConversationAttachmentAccessRequest,
  type AttachmentAccessHttpDependencies,
} from "@/modules/conversation-hub";
import { resolveAppUrl } from "@/modules/email";
import {
  logServerError,
  resolveCorrelationId,
} from "@/modules/request-context";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  return handleRequest(request, context);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  return handleRequest(request, context);
}

async function handleRequest(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  const correlationId = resolveCorrelationId(
    request.headers.get("x-correlation-id"),
  );
  try {
    const dependencies = attachmentAccessHttpDependencies(correlationId);
    return await handleConversationAttachmentAccessRequest(
      request,
      await context.params,
      dependencies,
    );
  } catch (error) {
    const mapped = logServerError({
      operation: "conversation.attachment_access_http",
      correlationId,
      error,
    });
    return Response.json(
      { ok: false, error: mapped.message, correlationId },
      {
        status: mapped.status,
        headers: {
          "cache-control": "private, no-store, max-age=0",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "x-correlation-id": correlationId,
        },
      },
    );
  }
}

function attachmentAccessHttpDependencies(
  correlationId: string,
): AttachmentAccessHttpDependencies {
  return {
    expectedOrigin: resolveAppUrl(),
    correlationId,
    async resolveContext() {
      const session = await getCurrentSession();
      if (!session) return { status: "unauthenticated" };
      const services = await getServices();
      const context = await services.getTenantContext(
        session.user.id,
        await getTenantIdFromCookie(),
      );
      if (!context) return { status: "tenant_not_found" };
      return {
        status: "authenticated",
        userId: session.user.id,
        tenantId: context.tenant.id,
      };
    },
    async prepare(input) {
      const services = await getConversationChannelServices();
      return services.prepareAttachmentAccess(
        input.userId,
        input.tenantId,
        input.attachmentId,
      );
    },
    async read(input) {
      const services = await getConversationChannelServices();
      return services.readAttachment(
        input.userId,
        input.tenantId,
        input.attachmentId,
        input.ticket,
      );
    },
  };
}
