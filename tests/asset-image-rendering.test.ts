import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteRenderer } from "../src/components/site-renderer";
import type { Website, WebsiteSection } from "../src/lib/types";

const website: Website = {
  id: "website_fixture", tenantId: "tenant_fixture", name: "Site fictif",
  templateKey: "artisan", status: "published",
  theme: { primary: "#000000", accent: "#111111", background: "#ffffff", text: "#000000", radius: "8px" },
  createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z",
};

function render(imageUrl: string, preview = false) {
  const section: WebsiteSection = {
    id: "section_fixture", tenantId: website.tenantId, websiteId: website.id,
    type: "hero", position: 0, enabled: true, title: "Image fictive", body: "Texte fictif", imageUrl, data: {},
  };
  return renderToStaticMarkup(createElement(SiteRenderer, { website, sections: [section], preview }));
}

describe("tenant asset image rendering", () => {
  it.each([false, true])("uses the protected asset URL directly (preview=%s)", preview => {
    const html = render("/fichiers/asset_fixture", preview);
    expect(html).toContain('src="/fichiers/asset_fixture"');
    expect(html).not.toContain("/_next/image");
  });

  it("retains image optimisation for an ordinary external image", () => {
    expect(render("https://images.unsplash.com/photo-fixture")).toContain("/_next/image");
  });
});
