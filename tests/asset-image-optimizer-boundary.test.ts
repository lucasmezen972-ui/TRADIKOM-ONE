import type { IncomingMessage } from "node:http";
import { ImageOptimizerCache } from "next/dist/server/image-optimizer";
import { defaultConfig } from "next/dist/server/config-shared";
import { imageConfigDefault } from "next/dist/shared/lib/image-config";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

const optimizerConfig = {
  ...defaultConfig,
  ...nextConfig,
  images: { ...imageConfigDefault, ...nextConfig.images },
} as unknown as Parameters<typeof ImageOptimizerCache.validateParams>[2];

function validateOptimizerUrl(url: string) {
  const request = { headers: { accept: "image/webp,*/*" } } as IncomingMessage;
  return ImageOptimizerCache.validateParams(
    request,
    { url, w: "640", q: "75" },
    optimizerConfig,
    false,
  );
}

describe("image optimizer access boundary", () => {
  it.each([
    "/fichiers/asset_fixture",
    "/fichiers/asset_fixture?version=published",
    "/logo.png",
    "/_next/static/media/image.fixture.png",
    "/_next/static/immutable/media/image.fixture.png",
  ])("refuses local optimization for %s", url => {
    expect(validateOptimizerUrl(url)).toEqual({
      errorMessage: '"url" parameter is not allowed',
    });
  });

  it("keeps the permitted Unsplash image optimizer path", () => {
    expect(validateOptimizerUrl("https://images.unsplash.com/photo-fixture")).toMatchObject({
      href: "https://images.unsplash.com/photo-fixture",
      isAbsolute: true,
      isStatic: false,
      width: 640,
      quality: 75,
    });
  });

  it.each([
    "http://images.unsplash.com/photo-fixture",
    "https://images.unsplash.com.attacker.example/photo-fixture",
  ])("does not broaden remote image permissions to %s", url => {
    expect(validateOptimizerUrl(url)).toEqual({
      errorMessage: '"url" parameter is not allowed',
    });
  });
});
