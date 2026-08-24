export type AllowedImageType = "image/png" | "image/jpeg" | "image/webp";

export const maxAssetBytes = 5 * 1024 * 1024;

export type AssetValidationResult =
  | { ok: true; contentType: AllowedImageType }
  | { ok: false; code: AssetRejectionCode };

export type AssetRejectionCode =
  | "asset_empty"
  | "asset_too_large"
  | "asset_type_not_allowed";

/**
 * Le type est déterminé par la signature binaire du fichier, jamais par son
 * extension ni par le `Content-Type` annoncé : les deux sont fournis par le
 * client et se falsifient trivialement. Un exécutable renommé `photo.png`
 * doit être refusé.
 */
export function detectImageType(bytes: Uint8Array): AllowedImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp";
  }
  return null;
}

export function validateAssetBytes(bytes: Uint8Array): AssetValidationResult {
  if (bytes.length === 0) {
    return { ok: false, code: "asset_empty" };
  }
  if (bytes.length > maxAssetBytes) {
    return { ok: false, code: "asset_too_large" };
  }
  const contentType = detectImageType(bytes);
  if (!contentType) {
    return { ok: false, code: "asset_type_not_allowed" };
  }
  return { ok: true, contentType };
}

/**
 * Le nom d'origine est conservé pour l'affichage uniquement. Il ne sert jamais
 * à construire un chemin de stockage : séparateurs, segments `..` et octets de
 * contrôle sont retirés, et la longueur est bornée.
 */
export function safeOriginalName(value: string) {
  const cleaned = value
    .replaceAll("\\", "/")
    .split("/")
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replaceAll("..", "")
    .trim();
  return cleaned.slice(0, 120) || "image";
}

export function extensionFor(contentType: AllowedImageType) {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
  }
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  if (bytes.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[index] === byte);
}
