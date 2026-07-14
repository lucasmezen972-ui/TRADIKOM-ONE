import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  decryptConnectorSecret,
  encryptConnectorSecret,
} from "@/modules/connectors/security";
import { OAuthError } from "@/modules/oauth/errors";

const ephemeralDevelopmentKey = randomBytes(32).toString("base64url");

export function encryptOAuthSecret(value: string) {
  return encryptConnectorSecret(value, getOAuthEncryptionKey());
}

export function decryptOAuthSecret(value: string) {
  return decryptConnectorSecret(value, getOAuthEncryptionKey());
}

export function getOAuthKeyVersion() {
  return (
    process.env.CONNECTOR_ENCRYPTION_KEY_VERSION?.trim() ||
    (process.env.CONNECTOR_ENCRYPTION_KEY ? "configured-v1" : "ephemeral-local")
  );
}

export function createPkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createMockAuthorizationCode(input: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}) {
  return createHash("sha256")
    .update(`${input.state}.${input.codeChallenge}.${input.redirectUri}`)
    .digest("hex");
}

export function verifyMockAuthorizationCode(
  code: string,
  input: { state: string; codeChallenge: string; redirectUri: string },
) {
  const expected = Buffer.from(createMockAuthorizationCode(input), "hex");
  const actual = /^[a-f0-9]{64}$/.test(code)
    ? Buffer.from(code, "hex")
    : Buffer.alloc(0);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getOAuthEncryptionKey() {
  const configured = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new OAuthError(
      "oauth_configuration_invalid",
      "Le chiffrement OAuth n'est pas configuré.",
    );
  }
  return ephemeralDevelopmentKey;
}
