import { describe, expect, it } from "vitest";
import {
  ChannelProviderMediaReferenceEncryptionError,
  createChannelProviderMediaReferenceCipher,
  type ChannelProviderMediaReference,
} from "../src/modules/channels";

const reference: ChannelProviderMediaReference = {
  provider: "whatsapp_meta",
  mediaId: "2754859441498128",
  mediaKind: "document",
  declaredMediaType: "application/pdf",
  declaredChecksumSha256: "a".repeat(64),
  originalFileName: "preuve-confidentielle.pdf",
};
const context = {
  tenantId: "tenant_media_crypto",
  endpointId: "endpoint_media_crypto",
  messageId: "message_media_crypto",
  provider: "whatsapp_meta" as const,
};

describe("chiffrement des références média fournisseur", () => {
  it("chiffre et relit seulement dans le contexte tenant-message exact", () => {
    const cipher = createChannelProviderMediaReferenceCipher({
      keyMaterial: "media-reference-test-key-material-32-bytes-minimum",
      keyVersion: "media-test-v1",
    });
    const encrypted = cipher.encrypt(reference, context);

    expect(encrypted).not.toContain(reference.mediaId);
    expect(encrypted).not.toContain(reference.declaredChecksumSha256);
    expect(encrypted).not.toContain(reference.declaredMediaType);
    expect(encrypted).not.toContain(reference.originalFileName ?? "");
    expect(cipher.decrypt(encrypted, context)).toEqual(reference);
    expect(() =>
      cipher.decrypt(encrypted, {
        ...context,
        tenantId: "tenant_media_crypto_other",
      }),
    ).toThrow(ChannelProviderMediaReferenceEncryptionError);
    expect(() =>
      cipher.decrypt(encrypted, {
        ...context,
        messageId: "message_media_crypto_other",
      }),
    ).toThrow(ChannelProviderMediaReferenceEncryptionError);
  });

  it("refuse une clé ou une version de clé non bornée", () => {
    expect(() =>
      createChannelProviderMediaReferenceCipher({
        keyMaterial: "trop-court",
        keyVersion: "media-test-v1",
      }),
    ).toThrow(ChannelProviderMediaReferenceEncryptionError);
    expect(() =>
      createChannelProviderMediaReferenceCipher({
        keyMaterial: "media-reference-test-key-material-32-bytes-minimum",
        keyVersion: "version avec espaces",
      }),
    ).toThrow(ChannelProviderMediaReferenceEncryptionError);
  });
});
