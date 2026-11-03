import { expect, it } from "vitest";
import { isTrustedNativeDocumentRequest } from "../src/modules/conversation-hub/native-document-http";
const origin = "https://tradikom.example.test";
function request(init: RequestInit = {}) { return new Request(`${origin}/api/conversation/files/file_id`, { method: "POST", headers: { origin }, ...init }); }
it("autorise une requête sans corps et le flux vide fourni par l’adaptateur Node", async () => {
  expect(await isTrustedNativeDocumentRequest(request(), origin)).toBe(true);
  const stream = new ReadableStream({ start(controller) { controller.close(); } });
  const streamed = request({ body: stream, duplex: "half" } as RequestInit);
  expect(streamed.body).not.toBeNull();
  expect(await isTrustedNativeDocumentRequest(streamed, origin)).toBe(true);
});
it("refuse GET, origine absente ou différente, cross-site et toute donnée", async () => {
  for (const input of [request({ method: "GET" }), request({ headers: {} }), request({ headers: { origin: "https://evil.test" } }),
    request({ headers: { origin, "sec-fetch-site": "cross-site" } }), request({ body: "payload" }),
    request({ headers: { origin, "content-length": "1" } })]) {
    expect(await isTrustedNativeDocumentRequest(input, origin)).toBe(false);
  }
});
it("ferme un flux qui ne termine pas dans le délai borné", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  expect(await isTrustedNativeDocumentRequest(request({ body: stream, duplex: "half" } as RequestInit), origin)).toBe(false);
  expect(cancelled).toBe(true);
});
