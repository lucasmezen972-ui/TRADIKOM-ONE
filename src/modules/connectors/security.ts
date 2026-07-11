import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function verifyWebhookHmac({
  body,
  secret,
  timestamp,
  signature,
  toleranceSeconds = 300,
}: {
  body: string;
  secret: string;
  timestamp: string;
  signature: string;
  toleranceSeconds?: number;
}) {
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) {
    return false;
  }

  if (Math.abs(Date.now() - timestampMs) > toleranceSeconds * 1000) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const normalizedSignature = signature.replace(/^sha256=/, "");

  if (!/^[a-f0-9]{64}$/i.test(normalizedSignature)) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(normalizedSignature, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function encryptConnectorSecret(
  plaintext: string,
  key = process.env.CONNECTOR_ENCRYPTION_KEY ?? "",
) {
  const normalizedKey = normalizeKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", normalizedKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  });
}

export function decryptConnectorSecret(
  payload: string,
  key = process.env.CONNECTOR_ENCRYPTION_KEY ?? "",
) {
  const parsed = JSON.parse(payload) as {
    iv: string;
    tag: string;
    ciphertext: string;
  };
  const decipher = createDecipheriv(
    "aes-256-gcm",
    normalizeKey(key),
    Buffer.from(parsed.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizeKey(key: string) {
  if (key.length < 32) {
    return Buffer.from(key.padEnd(32, "0").slice(0, 32));
  }

  return Buffer.from(key.slice(0, 32));
}
