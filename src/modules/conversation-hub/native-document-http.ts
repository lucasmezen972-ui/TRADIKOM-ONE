// Next's Node adapter may expose an empty POST body as a non-null stream.
// Authenticate only after checking the exact origin and consuming at most one bounded chunk.
export async function isTrustedNativeDocumentRequest(request: Request, expectedOrigin: string) {
  if (request.method !== "POST" || request.headers.get("origin") !== new URL(expectedOrigin).origin
    || request.headers.get("sec-fetch-site") === "cross-site") return false;
  const length = request.headers.get("content-length");
  if (length !== null && length !== "0") return false;
  if (!request.body) return true;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: false }>(resolve => { timer = setTimeout(() => resolve({ done: false }), 1000); }),
    ]);
    return result.done === true;
  } catch { return false; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}
