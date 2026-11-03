import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { validateAssetBytes } from "../src/modules/assets/validation";
import { parseImportFile } from "../src/modules/imports/parsers";

const threeMiB = 3 * 1024 * 1024;
const fourMiB = 4 * 1024 * 1024;

function pngBytes(size: number) {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

describe("upload limits within the preview transport envelope", () => {
  it("accepts an image at 3 MiB and rejects one extra byte", () => {
    expect(validateAssetBytes(pngBytes(threeMiB))).toEqual({
      ok: true,
      contentType: "image/png",
    });
    expect(validateAssetBytes(pngBytes(threeMiB + 1))).toEqual({
      ok: false,
      code: "asset_too_large",
    });
  });

  it("accepts a valid JSON import at exactly 3 MiB", async () => {
    const json = '[{"nom":"Contact fictif"}]';
    const buffer = Buffer.alloc(threeMiB, " ");
    buffer.write(json);
    await expect(parseImportFile({
      buffer,
      format: "json",
      contentType: "application/json",
    })).resolves.toEqual({
      headers: ["nom"],
      rows: [{ nom: "Contact fictif" }],
      selectedSheet: null,
    });
  });

  it.each([
    ["csv", "text/csv"],
    ["json", "application/json"],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ] as const)("rejects a %s import one byte above 3 MiB before parsing", async (format, contentType) => {
    await expect(parseImportFile({
      buffer: Buffer.alloc(threeMiB + 1, "a"),
      format,
      contentType,
    })).rejects.toMatchObject({
      code: "file_too_large",
      message: "Le fichier dépasse la limite autorisée de 3 Mo.",
    });
  });

  it("leaves multipart room above the file limit and below the hosting request cap", async () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe("4mb");
    const form = new FormData();
    form.set("sectionId", "section_fixture");
    form.set("fichier", new Blob([pngBytes(threeMiB)], { type: "image/png" }), "fixture.png");
    const request = new Request("https://app.example.test/mon-site", {
      method: "POST",
      body: form,
    });
    const multipartBytes = (await request.arrayBuffer()).byteLength;
    expect(multipartBytes).toBeGreaterThan(threeMiB);
    expect(multipartBytes).toBeLessThan(fourMiB);
    expect(fourMiB).toBeLessThan(4_500_000);
  });
});

it("never chooses an ephemeral Vercel filesystem for legacy storage", async () => {
  const previousVercel = process.env.VERCEL;
  const previousDirectory = process.env.ASSET_STORAGE_DIR;
  try {
    process.env.VERCEL = "1";
    process.env.ASSET_STORAGE_DIR = "/tmp/forbidden-image-storage";
    const { createRuntimeAssetStorage } = await import("../src/modules/assets/storage");
    expect(createRuntimeAssetStorage().name).toBe("unavailable");
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = previousVercel;
    if (previousDirectory === undefined) delete process.env.ASSET_STORAGE_DIR; else process.env.ASSET_STORAGE_DIR = previousDirectory;
  }
});
