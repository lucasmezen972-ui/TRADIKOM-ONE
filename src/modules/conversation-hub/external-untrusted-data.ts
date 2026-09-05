import { createHash, timingSafeEqual } from "node:crypto";
import type { ConversationAttachmentRow } from "@/modules/conversation-hub/repository";

const maximumDataOnlyCharacters = 8_000;

export type VerifiedExternalUntrustedDataExtraction = {
  trustBoundary: "external_untrusted_data";
  mode: "mock";
  extractorKey: string;
  integrity: "verified";
  text: string;
  extractedAt: string;
};

export type FailedExternalUntrustedDataExtraction = {
  trustBoundary: "external_untrusted_data";
  integrity: "failed";
};

export type ExternalUntrustedDataExtraction =
  | VerifiedExternalUntrustedDataExtraction
  | FailedExternalUntrustedDataExtraction;

type PersistedExtraction = Pick<
  ConversationAttachmentRow,
  | "trust_boundary"
  | "extractor_mode"
  | "extractor_key"
  | "extracted_text"
  | "extracted_text_sha256"
  | "extracted_at"
>;

export function readExternalUntrustedDataExtraction(
  extraction: PersistedExtraction,
): ExternalUntrustedDataExtraction | undefined {
  const persistedValues = [
    extraction.trust_boundary,
    extraction.extractor_mode,
    extraction.extractor_key,
    extraction.extracted_text,
    extraction.extracted_text_sha256,
    extraction.extracted_at,
  ];
  if (persistedValues.every((value) => value === null)) {
    return undefined;
  }

  if (
    extraction.trust_boundary !== "external_untrusted_data" ||
    extraction.extractor_mode !== "mock" ||
    !extraction.extractor_key ||
    !extraction.extracted_text ||
    !extraction.extracted_text_sha256 ||
    !extraction.extracted_at ||
    extraction.extracted_text.length > 16_000
  ) {
    return failedExtraction();
  }

  const expectedHash = extraction.extracted_text_sha256.toLowerCase();
  const actualHash = createHash("sha256")
    .update(extraction.extracted_text, "utf8")
    .digest("hex");
  if (!equalSha256(actualHash, expectedHash)) {
    return failedExtraction();
  }

  return {
    trustBoundary: "external_untrusted_data",
    mode: "mock",
    extractorKey: extraction.extractor_key,
    integrity: "verified",
    text: extraction.extracted_text,
    extractedAt: extraction.extracted_at,
  };
}

export type ExternalUntrustedDataView = {
  trustBoundary: "external_untrusted_data";
  sourceIntegrity: "verified";
  content: string;
  truncated: boolean;
  instructionsAllowed: false;
  toolAccess: "forbidden";
  policyMutation: "forbidden";
};

export function prepareExternalUntrustedDataView(
  extraction: ExternalUntrustedDataExtraction,
): ExternalUntrustedDataView {
  if (extraction.integrity !== "verified") {
    throw new Error("external_untrusted_data_integrity_failed");
  }

  const filtered = filterExternalData(extraction.text);
  const truncated = filtered.length > maximumDataOnlyCharacters;
  return {
    trustBoundary: "external_untrusted_data",
    sourceIntegrity: "verified",
    content:
      filtered.slice(0, maximumDataOnlyCharacters).trim() || "[contenu masqué]",
    truncated,
    instructionsAllowed: false,
    toolAccess: "forbidden",
    policyMutation: "forbidden",
  };
}

function failedExtraction(): FailedExternalUntrustedDataExtraction {
  return {
    trustBoundary: "external_untrusted_data",
    integrity: "failed",
  };
}

function equalSha256(actualHash: string, expectedHash: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(actualHash, "hex"),
    Buffer.from(expectedHash, "hex"),
  );
}

function filterExternalData(text: string) {
  return text
    .replace(
      /-----BEGIN [^-\n]{1,80}-----[\s\S]*?-----END [^-\n]{1,80}-----/g,
      "[secret masqué]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, "[secret masqué]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|mot[_-]?de[_-]?passe)\b\s*[:=]\s*(?:"[^"\n]{4,}"|'[^'\n]{4,}'|[^\s,;]{4,})/gi,
      "$1=[secret masqué]",
    )
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, "[lien masqué]")
    .replace(
      /\b(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d{1,5})?(?:\/[^\s<>"']*)?/gi,
      "[adresse interne masquée]",
    );
}
