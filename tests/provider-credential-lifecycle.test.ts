import { describe, expect, it } from "vitest";
import {
  createProviderCredentialRecord,
  revokeProviderCredential,
  rotateProviderCredential,
  sameProviderCredentialSecret,
  toProviderCredentialView,
} from "../src/modules/provider-readiness";

const encryptionKey = "0123456789abcdef0123456789abcdef";
const firstSecret = "provider-test-secret-value-0000000001";
const secondSecret = "provider-test-secret-value-0000000002";
const tenantId = "tenant_provider_readiness";

describe("provider credential lifecycle", () => {
  it("encrypts and fingerprints a test-only credential without redisplay", () => {
    const record = createProviderCredentialRecord(
      {
        tenantId,
        providerKey: "cloudflare",
        label: "Compte DNS de test",
        environment: "test",
        capabilities: [
          "read_dns_records",
          "verify_current_token",
          "read_zone_inventory",
          "read_dns_records",
        ],
        secret: firstSecret,
      },
      {
        encryptionKey,
        keyVersion: "test-v1",
        now: "2026-07-16T17:00:00Z",
        credentialId: "provider_credential_0000000000000001",
      },
    );

    expect(record).toMatchObject({
      id: "provider_credential_0000000000000001",
      tenantId,
      providerKey: "cloudflare",
      environment: "test",
      version: 1,
      status: "active",
      keyVersion: "test-v1",
      capabilities: [
        "read_dns_records",
        "read_zone_inventory",
        "verify_current_token",
      ],
      createdAt: "2026-07-16T17:00:00.000Z",
    });
    expect(record.encryptedSecret).not.toContain(firstSecret);
    expect(record.secretFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(sameProviderCredentialSecret(record, firstSecret, encryptionKey)).toBe(
      true,
    );
    expect(
      sameProviderCredentialSecret(record, secondSecret, encryptionKey),
    ).toBe(false);

    const view = toProviderCredentialView(record);
    expect(view).toMatchObject({
      credentialPresent: true,
      credentialRedisplayAllowed: false,
      status: "active",
    });
    expect("encryptedSecret" in view).toBe(false);
    expect("secretFingerprint" in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain(firstSecret);
  });

  it("rotates atomically into a new version and supersedes the prior envelope", () => {
    const first = createProviderCredentialRecord(
      {
        tenantId,
        providerKey: "cloudflare",
        label: "Compte DNS de test",
        environment: "test",
        capabilities: ["verify_current_token", "read_zone_inventory"],
        secret: firstSecret,
      },
      {
        encryptionKey,
        keyVersion: "test-v1",
        now: "2026-07-16T17:00:00Z",
        credentialId: "provider_credential_0000000000000001",
      },
    );

    const rotated = rotateProviderCredential(
      first,
      {
        secret: secondSecret,
        capabilities: [
          "verify_current_token",
          "read_zone_inventory",
          "read_dns_records",
        ],
      },
      {
        encryptionKey,
        keyVersion: "test-v2",
        now: "2026-07-16T18:00:00Z",
        credentialId: "provider_credential_0000000000000002",
      },
    );

    expect(rotated.previous).toMatchObject({
      id: first.id,
      version: 1,
      status: "superseded",
      rotatedAt: "2026-07-16T18:00:00.000Z",
    });
    expect(rotated.current).toMatchObject({
      id: "provider_credential_0000000000000002",
      version: 2,
      status: "active",
      supersedesId: first.id,
      keyVersion: "test-v2",
      createdAt: "2026-07-16T18:00:00.000Z",
    });
    expect(rotated.current.secretFingerprint).not.toBe(first.secretFingerprint);
    expect(rotated.current.encryptedSecret).not.toBe(first.encryptedSecret);
    expect(() =>
      rotateProviderCredential(
        rotated.previous,
        { secret: secondSecret },
        { encryptionKey, keyVersion: "test-v3" },
      ),
    ).toThrow("Only an active provider credential can be rotated.");
  });

  it("revokes idempotently and rejects unsupported privileges", () => {
    const active = createProviderCredentialRecord(
      {
        tenantId,
        providerKey: "cloudflare",
        label: "Compte DNS de test",
        environment: "test",
        capabilities: ["verify_current_token"],
        secret: firstSecret,
      },
      {
        encryptionKey,
        keyVersion: "test-v1",
        now: "2026-07-16T17:00:00Z",
        credentialId: "provider_credential_0000000000000001",
      },
    );
    const revoked = revokeProviderCredential(active, "2026-07-16T19:00:00Z");
    expect(revoked).toMatchObject({
      status: "revoked",
      revokedAt: "2026-07-16T19:00:00.000Z",
    });
    expect(revokeProviderCredential(revoked)).toEqual(revoked);

    expect(() =>
      createProviderCredentialRecord(
        {
          tenantId,
          providerKey: "cloudflare",
          label: "Privilèges interdits",
          environment: "test",
          capabilities: ["write_dns_records"],
          secret: firstSecret,
        },
        { encryptionKey, keyVersion: "test-v1" },
      ),
    ).toThrow("Provider credential capabilities are invalid.");
  });
});
