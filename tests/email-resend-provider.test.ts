import { describe, expect, it } from "vitest";
import { createResendEmailProvider } from "../src/modules/email/resend-provider";
import type { EmailMessage } from "../src/modules/email/types";

const message: EmailMessage = {
  kind: "team_invitation",
  to: "destinataire@example.com",
  subject: "Invitation",
  text: "Bonjour",
  html: "<p>Bonjour</p>",
  metadata: {
    expiresAt: "2026-08-01T10:00:00.000Z",
    tenantId: "tenant-1",
    invitationId: "invitation-1",
  },
};

type Capture = { url: string; init: RequestInit };

function providerWith(
  responder: (capture: Capture) => Response | Promise<Response>,
  captures: Capture[] = [],
  timeoutMs?: number,
) {
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    const capture = { url: String(url), init };
    captures.push(capture);
    return responder(capture);
  }) as unknown as typeof fetch;

  return {
    captures,
    provider: createResendEmailProvider({
      apiKey: "clé-secrète-de-test",
      from: "contact@tradikom.example",
      fetchImpl,
      timeoutMs,
    }),
  };
}

describe("provider email Resend préparé", () => {
  it("utilise une origine fixe et une clé d'idempotence opaque et stable", async () => {
    const { provider, captures } = providerWith(
      () => new Response(JSON.stringify({ id: "msg_123" }), { status: 200 }),
    );

    await expect(provider.send(message)).resolves.toMatchObject({
      status: "sent",
      provider: "resend",
      messageId: "msg_123",
    });
    await provider.send(message);

    const first = captures[0]!;
    const second = captures[1]!;
    expect(first.url).toBe("https://api.resend.com/emails");
    expect(first.init).toMatchObject({ method: "POST", redirect: "error" });

    const firstHeaders = first.init.headers as Record<string, string>;
    const secondHeaders = second.init.headers as Record<string, string>;
    expect(firstHeaders.authorization).toBe("Bearer clé-secrète-de-test");
    expect(firstHeaders["user-agent"]).toBe("tradikom-one/1.0");
    expect(firstHeaders["idempotency-key"]).toMatch(
      /^tradikom-one-email-v1\/[a-f0-9]{64}$/,
    );
    expect(firstHeaders["idempotency-key"]).toBe(
      secondHeaders["idempotency-key"],
    );
    expect(firstHeaders["idempotency-key"]).not.toContain(message.to);
    expect(firstHeaders["idempotency-key"].length).toBeLessThanOrEqual(256);

    const body = JSON.parse(String(first.init.body));
    expect(body.tags).toEqual([
      { name: "tradikom_kind", value: "team_invitation" },
      { name: "tradikom_tenant", value: "tenant-1" },
    ]);
  });

  it("change la clé si le payload change pour éviter un conflit 409", async () => {
    const { provider, captures } = providerWith(
      () => new Response(JSON.stringify({ id: "msg_123" }), { status: 200 }),
    );

    await provider.send(message);
    await provider.send({ ...message, subject: "Invitation mise à jour" });

    const keys = captures.map(
      (capture) =>
        (capture.init.headers as Record<string, string>)["idempotency-key"],
    );
    expect(new Set(keys).size).toBe(2);
  });

  it("classe les limites et indisponibilités comme réessayables", async () => {
    const quota = providerWith(
      () =>
        new Response(JSON.stringify({ name: "daily_quota_exceeded" }), {
          status: 429,
          headers: { "retry-after": "45" },
        }),
    );
    await expect(quota.provider.send(message)).resolves.toMatchObject({
      status: "retryable_failure",
      errorCode: "provider_quota_exceeded",
      retryAfterSeconds: 45,
    });

    const outage = providerWith(() => new Response("", { status: 503 }));
    await expect(outage.provider.send(message)).resolves.toMatchObject({
      status: "retryable_failure",
      errorCode: "provider_unavailable",
      retryAfterSeconds: 300,
    });
  });

  it("distingue les deux conflits d'idempotence", async () => {
    const concurrent = providerWith(
      () =>
        new Response(
          JSON.stringify({ name: "concurrent_idempotent_requests" }),
          { status: 409 },
        ),
    );
    await expect(concurrent.provider.send(message)).resolves.toMatchObject({
      status: "retryable_failure",
      errorCode: "concurrent_request",
    });

    const conflict = providerWith(
      () =>
        new Response(JSON.stringify({ name: "invalid_idempotent_request" }), {
          status: 409,
        }),
    );
    await expect(conflict.provider.send(message)).resolves.toMatchObject({
      status: "permanent_failure",
      errorCode: "idempotency_conflict",
    });
  });

  it("distingue une clé invalide d'un domaine expéditeur refusé", async () => {
    const invalidKey = providerWith(
      () =>
        new Response(JSON.stringify({ name: "invalid_api_key" }), {
          status: 403,
        }),
    );
    await expect(invalidKey.provider.send(message)).resolves.toMatchObject({
      status: "permanent_failure",
      errorCode: "provider_unauthorized",
    });

    const invalidDomain = providerWith(
      () =>
        new Response(JSON.stringify({ name: "validation_error" }), {
          status: 403,
        }),
    );
    await expect(invalidDomain.provider.send(message)).resolves.toMatchObject({
      status: "permanent_failure",
      errorCode: "message_rejected",
    });
  });

  it("ne propage jamais le corps fournisseur, le destinataire ou la clé", async () => {
    const { provider } = providerWith(
      () =>
        new Response(
          JSON.stringify({
            name: "validation_error",
            message: `Destinataire ${message.to}, clé clé-secrète-de-test`,
          }),
          { status: 422 },
        ),
    );

    const serialized = JSON.stringify(await provider.send(message));
    expect(serialized).not.toContain(message.to);
    expect(serialized).not.toContain("clé-secrète-de-test");
    expect(serialized).toContain("message_rejected");
  });

  it("borne le message avant le réseau et la réponse avant le parsing", async () => {
    const oversizedMessage = providerWith(() => {
      throw new Error("Le réseau ne doit pas être appelé.");
    });
    await expect(
      oversizedMessage.provider.send({
        ...message,
        html: "x".repeat(2 * 1024 * 1024 + 1),
      }),
    ).resolves.toMatchObject({
      status: "permanent_failure",
      errorCode: "message_invalid",
    });
    expect(oversizedMessage.captures).toHaveLength(0);

    await expect(
      oversizedMessage.provider.send({
        ...message,
        metadata: { ...message.metadata, tenantId: "tenant:non-tagable" },
      }),
    ).resolves.toMatchObject({
      status: "permanent_failure",
      errorCode: "message_invalid",
    });
    expect(oversizedMessage.captures).toHaveLength(0);

    const oversizedResponse = providerWith(
      () =>
        new Response(
          JSON.stringify({ id: "x".repeat(20_000), secret: message.to }),
          { status: 200 },
        ),
    );
    await expect(oversizedResponse.provider.send(message)).resolves.toEqual({
      status: "retryable_failure",
      provider: "resend",
      errorCode: "provider_response_invalid",
      retryAfterSeconds: 60,
    });
  });

  it("convertit timeout et échec réseau en résultat sûr réessayable", async () => {
    const timeout = providerWith(
      ({ init }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new Error(`timeout vers ${message.to}`));
          });
        }),
      [],
      10,
    );
    await expect(timeout.provider.send(message)).resolves.toMatchObject({
      status: "retryable_failure",
      errorCode: "network_error",
    });

    const network = providerWith(() => {
      throw new Error(`connexion refusée pour ${message.to}`);
    });
    const outcome = await network.provider.send(message);
    expect(outcome).toMatchObject({
      status: "retryable_failure",
      errorCode: "network_error",
    });
    expect(JSON.stringify(outcome)).not.toContain(message.to);
  });

  it("refuse une configuration invalide sans réafficher sa valeur", () => {
    const secret = "secret-à-ne-pas-afficher";
    expect(() =>
      createResendEmailProvider({ apiKey: secret, from: "", timeoutMs: 0 }),
    ).toThrow("Configuration du provider email invalide.");
    try {
      createResendEmailProvider({ apiKey: secret, from: "", timeoutMs: 0 });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
