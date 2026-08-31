import { describe, expect, it } from "vitest";
import { createResendEmailProvider } from "../src/modules/email/http-provider";
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
  responder: (capture: Capture) => Response,
  captures: Capture[] = [],
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
    }),
  };
}

describe("resend email provider", () => {
  it("posts to the fixed provider origin and reports the message id", async () => {
    const { provider, captures } = providerWith(
      () =>
        new Response(JSON.stringify({ id: "msg_123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const outcome = await provider.send(message);

    expect(outcome).toMatchObject({
      status: "sent",
      provider: "resend",
      messageId: "msg_123",
    });

    const capture = captures[0]!;
    // L'origine est une constante : aucune variable d'environnement ne peut la
    // détourner vers un autre hôte.
    expect(capture.url).toBe("https://api.resend.com/emails");
    expect(capture.init.method).toBe("POST");
    expect(capture.init.redirect).toBe("error");

    const headers = capture.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer clé-secrète-de-test");
    // Une reprise du worker ne doit pas renvoyer deux fois le même lien.
    expect(headers["idempotency-key"]).toBe(
      "team_invitation:invitation-1:2026-08-01T10:00:00.000Z",
    );

    const body = JSON.parse(String(capture.init.body));
    expect(body).toMatchObject({
      from: "contact@tradikom.example",
      to: ["destinataire@example.com"],
      subject: "Invitation",
    });
  });

  it("treats rate limiting and provider outages as retryable", async () => {
    const rateLimited = providerWith(
      () =>
        new Response("", {
          status: 429,
          headers: { "retry-after": "45" },
        }),
    );
    await expect(rateLimited.provider.send(message)).resolves.toMatchObject({
      status: "retryable_failure",
      errorCode: "rate_limited",
      retryAfterSeconds: 45,
    });

    const outage = providerWith(() => new Response("", { status: 503 }));
    await expect(outage.provider.send(message)).resolves.toMatchObject({
      status: "retryable_failure",
      errorCode: "provider_unavailable",
      retryAfterSeconds: 300,
    });
  });

  it("treats an invalid key or a rejected message as permanent", async () => {
    const unauthorized = providerWith(
      () => new Response("", { status: 401 }),
    );
    await expect(unauthorized.provider.send(message)).resolves.toMatchObject({
      status: "permanent_failure",
      errorCode: "provider_unauthorized",
    });
    // Une clé invalide ne se répare pas en réessayant : pas de délai proposé.
    const outcome = await unauthorized.provider.send(message);
    expect(outcome.retryAfterSeconds).toBeUndefined();

    const rejected = providerWith(() => new Response("", { status: 422 }));
    await expect(rejected.provider.send(message)).resolves.toMatchObject({
      status: "permanent_failure",
      errorCode: "message_rejected",
    });
  });

  it("never leaks the recipient or the provider body into the outcome", async () => {
    const leaky = providerWith(
      () =>
        new Response(
          JSON.stringify({
            error: "invalid recipient destinataire@example.com",
            key: "clé-secrète-de-test",
          }),
          { status: 400 },
        ),
    );

    const outcome = await leaky.provider.send(message);
    const serialised = JSON.stringify(outcome);

    expect(serialised).not.toContain("destinataire@example.com");
    expect(serialised).not.toContain("clé-secrète-de-test");
    expect(outcome.errorCode).toBe("message_rejected");
  });

  it("converts a network failure into a retryable outcome", async () => {
    const failing = providerWith(() => {
      throw new Error("connexion refusée vers destinataire@example.com");
    });

    const outcome = await failing.provider.send(message);
    expect(outcome).toMatchObject({
      status: "retryable_failure",
      errorCode: "network_error",
      retryAfterSeconds: 300,
    });
    expect(JSON.stringify(outcome)).not.toContain("destinataire@example.com");
  });

  it("still reports success when the provider answers without a usable id", async () => {
    const noId = providerWith(() => new Response("ok", { status: 202 }));
    await expect(noId.provider.send(message)).resolves.toMatchObject({
      status: "sent",
      provider: "resend",
    });
  });

  it("ignores an out-of-range retry-after header", async () => {
    const absurd = providerWith(
      () =>
        new Response("", {
          status: 429,
          headers: { "retry-after": "999999" },
        }),
    );
    await expect(absurd.provider.send(message)).resolves.toMatchObject({
      retryAfterSeconds: 60,
    });
  });
});
