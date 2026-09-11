import { describe, expect, it, vi } from "vitest";
import {
  ConversationAttachmentAccessError,
  handleConversationAttachmentAccessRequest,
  type AttachmentAccessHttpDependencies,
} from "../src/modules/conversation-hub";

const appOrigin = "https://app.example.test";
const requestUrl = `${appOrigin}/api/conversation/attachments/attachment_http_1`;
const attachmentId = "attachment_http_1";
const ticket = "t".repeat(120);
const correlationId = "corr_attachment_http_test";

describe("frontière HTTP des pièces jointes de conversation", () => {
  it("refuse les méthodes non autorisées avant session et métier", async () => {
    const dependencies = createDependencies();
    const response = await handleConversationAttachmentAccessRequest(
      request("GET"),
      { attachmentId },
      dependencies,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, PUT");
    expect(await response.json()).toEqual({
      ok: false,
      error: "Méthode non autorisée.",
    });
    expect(dependencies.resolveContext).not.toHaveBeenCalled();
    expect(dependencies.prepare).not.toHaveBeenCalled();
    expect(dependencies.read).not.toHaveBeenCalled();
  });

  it("refuse une origine absente, différente ou un hôte de requête ambigu", async () => {
    for (const candidate of [
      new Request(requestUrl, { method: "POST" }),
      new Request(requestUrl, {
        method: "POST",
        headers: { origin: "https://evil.example.test" },
      }),
      new Request(
        "https://evil.example.test/api/conversation/attachments/attachment_http_1",
        { method: "POST", headers: { origin: appOrigin } },
      ),
    ]) {
      const dependencies = createDependencies();
      const response = await handleConversationAttachmentAccessRequest(
        candidate,
        { attachmentId },
        dependencies,
      );

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(ticket);
      expect(dependencies.resolveContext).not.toHaveBeenCalled();
      expect(dependencies.prepare).not.toHaveBeenCalled();
    }
  });

  it("exige une session puis une organisation avant le métier", async () => {
    for (const [context, status, message] of [
      [
        { status: "unauthenticated" as const },
        401,
        "Authentification requise.",
      ],
      [
        { status: "tenant_not_found" as const },
        403,
        "Organisation introuvable.",
      ],
    ] as const) {
      const dependencies = createDependencies({ context });
      const response = await handleConversationAttachmentAccessRequest(
        request("POST"),
        { attachmentId },
        dependencies,
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, error: message });
      expect(dependencies.prepare).not.toHaveBeenCalled();
      expect(dependencies.read).not.toHaveBeenCalled();
    }
  });

  it("prépare un ticket court sans cache ni référence technique", async () => {
    const dependencies = createDependencies();
    const response = await handleConversationAttachmentAccessRequest(
      request("POST"),
      { attachmentId },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    expect(await response.json()).toEqual({
      ok: true,
      status: "ready",
      ticket,
      expiresAt: "2026-09-04T18:31:00.000Z",
    });
    expect(dependencies.prepare).toHaveBeenCalledWith({
      userId: "user_http_1",
      tenantId: "tenant_http_1",
      attachmentId,
    });
    expect(requestUrl).not.toContain(ticket);
  });

  it("refuse un identifiant ou un corps de préparation inattendu", async () => {
    for (const [candidate, id] of [
      [request("POST", "{}"), attachmentId],
      [request("POST"), "../piece-secrete"],
    ] as const) {
      const dependencies = createDependencies();
      const response = await handleConversationAttachmentAccessRequest(
        candidate,
        { attachmentId: id },
        dependencies,
      );

      expect(response.status).toBe(400);
      expect(dependencies.prepare).not.toHaveBeenCalled();
    }
  });

  it.each([
    [
      { status: "not_configured" as const },
      503,
      "Téléchargement non configuré.",
      "300",
    ],
    [
      { status: "disabled" as const },
      503,
      "Téléchargement désactivé.",
      null,
    ],
    [
      { status: "denied" as const, safeErrorCode: "private_policy_code" },
      403,
      "Accès à cette pièce jointe refusé.",
      null,
    ],
  ])(
    "normalise la préparation %j sans code interne",
    async (result, status, message, retryAfter) => {
      const dependencies = createDependencies({ prepareResult: result });
      const response = await handleConversationAttachmentAccessRequest(
        request("POST"),
        { attachmentId },
        dependencies,
      );
      const body = await response.text();

      expect(response.status).toBe(status);
      expect(response.headers.get("retry-after")).toBe(retryAfter);
      expect(body).toContain(message);
      expect(body).not.toContain("private_policy_code");
    },
  );

  it("borne et valide strictement le JSON de consommation avant lecture", async () => {
    const cases = [
      request("PUT", JSON.stringify({ ticket }), "text/plain"),
      request("PUT", "{}"),
      request("PUT", JSON.stringify({ ticket, extra: "refusé" })),
      request("PUT", JSON.stringify({ ticket: "court" })),
      new Request(requestUrl, {
        method: "PUT",
        headers: {
          origin: appOrigin,
          "content-type": "application/json",
          "content-length": String(4 * 1024 + 1),
        },
        body: "{}",
      }),
      new Request(requestUrl, {
        method: "PUT",
        headers: { origin: appOrigin, "content-type": "application/json" },
        body: new Uint8Array([0xc3, 0x28]),
      }),
    ];
    for (const candidate of cases) {
      const dependencies = createDependencies();
      const response = await handleConversationAttachmentAccessRequest(
        candidate,
        { attachmentId },
        dependencies,
      );

      expect([400, 413, 415]).toContain(response.status);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(dependencies.read).not.toHaveBeenCalled();
    }
  });

  it("consomme le ticket depuis le JSON et restitue un fichier protégé", async () => {
    const content = Buffer.from("contenu-binaire-vérifié", "utf8");
    const dependencies = createDependencies({
      readResult: {
        status: "succeeded",
        storageMode: "mock",
        content,
        contentType: "application/pdf",
        fileName: "preuve émise.pdf",
      },
    });
    const response = await handleConversationAttachmentAccessRequest(
      request("PUT", JSON.stringify({ ticket })),
      { attachmentId },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-length")).toBe(
      String(content.byteLength),
    );
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=\"preuve_emise.pdf\"; filename*=UTF-8''preuve%20%C3%A9mise.pdf",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(content);
    expect(dependencies.read).toHaveBeenCalledWith({
      userId: "user_http_1",
      tenantId: "tenant_http_1",
      attachmentId,
      ticket,
    });
    expect(dependencies.prepare).not.toHaveBeenCalled();
    expect(requestUrl).not.toContain(ticket);
  });

  it.each([
    [
      {
        status: "failed" as const,
        classification: "temporary" as const,
        safeErrorCode: "private_temporary_code",
        retryable: true,
      },
      503,
      "Téléchargement temporairement indisponible.",
      "30",
    ],
    [
      {
        status: "failed" as const,
        classification: "permanent" as const,
        safeErrorCode: "private_permanent_code",
        retryable: false,
      },
      422,
      "Cette pièce jointe n’est pas disponible.",
      null,
    ],
    [
      { status: "not_configured" as const },
      503,
      "Téléchargement non configuré.",
      "300",
    ],
    [
      { status: "disabled" as const },
      503,
      "Téléchargement désactivé.",
      null,
    ],
    [
      { status: "denied" as const, safeErrorCode: "private_denied_code" },
      403,
      "Accès à cette pièce jointe refusé.",
      null,
    ],
  ])(
    "normalise la lecture %j sans code interne",
    async (result, status, message, retryAfter) => {
      const dependencies = createDependencies({ readResult: result });
      const response = await handleConversationAttachmentAccessRequest(
        request("PUT", JSON.stringify({ ticket })),
        { attachmentId },
        dependencies,
      );
      const body = await response.text();

      expect(response.status).toBe(status);
      expect(response.headers.get("retry-after")).toBe(retryAfter);
      expect(body).toContain(message);
      expect(body).not.toContain("private_");
      expect(body).not.toContain(ticket);
    },
  );

  it("normalise expiration, ticket invalide et révocation tenant sans fuite", async () => {
    for (const [error, status, message] of [
      [
        new ConversationAttachmentAccessError(
          "attachment_access_ticket_expired",
        ),
        410,
        "Le lien temporaire a expiré.",
      ],
      [
        new ConversationAttachmentAccessError(
          "attachment_access_ticket_invalid",
        ),
        404,
        "Cette pièce jointe n’est pas disponible.",
      ],
      [
        Object.assign(new Error("détail privé"), {
          code: "tenant_access_denied",
        }),
        403,
        "Accès à cette pièce jointe refusé.",
      ],
    ] as const) {
      const dependencies = createDependencies({ readError: error });
      const response = await handleConversationAttachmentAccessRequest(
        request("PUT", JSON.stringify({ ticket })),
        { attachmentId },
        dependencies,
      );
      const body = await response.text();

      expect(response.status).toBe(status);
      expect(body).toContain(message);
      expect(body).not.toContain("attachment_access_");
      expect(body).not.toContain("détail privé");
      expect(body).not.toContain(ticket);
    }
  });

  it("laisse les erreurs inconnues à la journalisation sûre de la route", async () => {
    const dependencies = createDependencies({
      readError: new Error("panne interne privée"),
    });

    await expect(
      handleConversationAttachmentAccessRequest(
        request("PUT", JSON.stringify({ ticket })),
        { attachmentId },
        dependencies,
      ),
    ).rejects.toThrow("panne interne privée");
  });
});

function createDependencies(
  overrides: {
    context?: Awaited<ReturnType<AttachmentAccessHttpDependencies["resolveContext"]>>;
    prepareResult?: Awaited<
      ReturnType<AttachmentAccessHttpDependencies["prepare"]>
    >;
    readResult?: Awaited<ReturnType<AttachmentAccessHttpDependencies["read"]>>;
    readError?: Error;
  } = {},
) {
  return {
    expectedOrigin: appOrigin,
    correlationId,
    resolveContext: vi.fn(async () =>
      Promise.resolve(
        overrides.context ?? {
          status: "authenticated" as const,
          userId: "user_http_1",
          tenantId: "tenant_http_1",
        },
      ),
    ),
    prepare: vi.fn(async () =>
      Promise.resolve(
        overrides.prepareResult ?? {
          status: "ready" as const,
          storageMode: "mock" as const,
          ticket,
          expiresAt: "2026-09-04T18:31:00.000Z",
        },
      ),
    ),
    read: vi.fn(async () => {
      if (overrides.readError) throw overrides.readError;
      return Promise.resolve(
        overrides.readResult ?? {
          status: "not_configured" as const,
        },
      );
    }),
  } satisfies AttachmentAccessHttpDependencies;
}

function request(method: string, body?: BodyInit, contentType = "application/json") {
  return new Request(requestUrl, {
    method,
    headers: {
      origin: appOrigin,
      ...(body === undefined ? {} : { "content-type": contentType }),
    },
    body,
  });
}
