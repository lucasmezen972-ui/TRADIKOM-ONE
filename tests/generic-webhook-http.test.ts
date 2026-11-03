import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorError } from "../src/modules/connectors/errors";
import { RateLimitError } from "../src/modules/rate-limit/errors";
import { POST } from "../src/app/api/webhooks/[token]/route";

const mocks = vi.hoisted(() => ({ getServices: vi.fn(), receiveWebhook: vi.fn() }));
vi.mock("@/lib/services", () => ({ getServices: mocks.getServices }));

const correlationId = "generic-webhook-test";
const token = "invalid-test-token";
const canary = "PRIVATE_TEST_PAYLOAD";

beforeEach(() => {
  mocks.getServices.mockReset().mockResolvedValue({ receiveWebhook: mocks.receiveWebhook });
  mocks.receiveWebhook.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("point d’entrée HTTP du webhook générique", () => {
  it.each([
    ["JSON malformé", `{"note":"${canary}"`],
    ["tableau", JSON.stringify([canary])],
    ["null", "null"],
    ["booléen", "true"],
    ["nombre", "42"],
    ["chaîne", JSON.stringify(canary)],
    ["corps vide", ""],
  ])("rejette %s avec400 sans remettre le payload au service", async (_label, body) => {
    const response = await POST(request(body), { params: Promise.resolve({ token }) });
    expect(response.status).toBe(400);
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    expect(await response.json()).toEqual({ ok: false, error: "Webhook rejeté.", correlationId });
    expect(mocks.receiveWebhook).not.toHaveBeenCalled();
    const log = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(log).toContain('"code":"webhook_payload_invalid"');
    expect(log).not.toContain(canary);
    expect(log).not.toContain(token);
  });

  it("conserve le refus du token et transmet le corps brut et les preuves de signature inchangés", async () => {
    const body = '{ "name": "Contact fictif", "email": "fixture@example.test" }';
    mocks.receiveWebhook.mockRejectedValue(new ConnectorError("webhook_invalid", canary));
    const response = await POST(request(body), { params: Promise.resolve({ token }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Webhook rejeté.", correlationId });
    expect(mocks.receiveWebhook).toHaveBeenCalledExactlyOnceWith(token, {
      name: "Contact fictif", email: "fixture@example.test",
    }, {
      body, timestamp: "fixture-timestamp", signature: "fixture-signature", idempotencyKey: "fixture-idempotency",
    });
  });

  it("conserve le statut429 et Retry-After du service", async () => {
    mocks.receiveWebhook.mockRejectedValue(new RateLimitError(42));
    const response = await POST(request("{}"), { params: Promise.resolve({ token }) });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
  });

  it("ne transforme pas une panne interne en erreur de payload et ne l’expose pas", async () => {
    mocks.getServices.mockRejectedValue(new Error(canary));
    const response = await POST(request("{}"), { params: Promise.resolve({ token }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "Une erreur est survenue. Réessayez plus tard.", correlationId });
    expect(mocks.receiveWebhook).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain(canary);
  });
});

function request(body: string) {
  return new Request("https://app.example.test/api/webhooks/invalid-test-token", {
    method: "POST", body,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": correlationId,
      "x-tradikom-timestamp": "fixture-timestamp",
      "x-tradikom-signature": "fixture-signature",
      "x-tradikom-idempotency-key": "fixture-idempotency",
    },
  });
}
