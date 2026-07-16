import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  isPublicDemoEnabled,
  seedDemo,
} from "../src/modules/demo";

const opened: Array<{ close: () => Promise<void> }> = [];

const isolatedProductionE2eEnvironment = {
  NODE_ENV: "production",
  APP_URL: "http://127.0.0.1:3000",
  FEATURE_PUBLIC_DEMO: "true",
  E2E_ALLOW_PUBLIC_DEMO: "true",
  COOKIE_SECURE: "false",
  CI: "true",
} as const;

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("demo module", () => {
  it("requires an explicit local flag and only permits production in isolated loopback CI E2E", () => {
    expect(
      isPublicDemoEnabled({
        NODE_ENV: "development",
        FEATURE_PUBLIC_DEMO: "true",
      }),
    ).toBe(true);
    expect(
      isPublicDemoEnabled({
        NODE_ENV: "development",
        FEATURE_PUBLIC_DEMO: "false",
      }),
    ).toBe(false);
    expect(
      isPublicDemoEnabled({
        NODE_ENV: "production",
        FEATURE_PUBLIC_DEMO: "true",
      }),
    ).toBe(false);
    expect(isPublicDemoEnabled(isolatedProductionE2eEnvironment)).toBe(true);
    expect(
      isPublicDemoEnabled({
        ...isolatedProductionE2eEnvironment,
        APP_URL: "https://app.tradikom.example",
      }),
    ).toBe(false);
  });

  it("refuses production seed calls before writing data", async () => {
    const db = await createMemoryDb();
    opened.push(db);

    await expect(
      seedDemo(db, {}, {
        environment: {
          NODE_ENV: "production",
          FEATURE_PUBLIC_DEMO: "true",
        },
      }),
    ).rejects.toThrow("La demonstration locale est desactivee.");

    const users = await db.query<{ count: number | string }>(
      "select count(*)::int as count from users",
    );
    expect(Number(users.rows[0]!.count)).toBe(0);
  });

  it("seeds and grants the demo platform role only in isolated production E2E", async () => {
    const db = await createMemoryDb();
    opened.push(db);

    const demo = await seedDemo(db, {}, {
      environment: isolatedProductionE2eEnvironment,
    });
    const role = await db.query<{ platform_role: string }>(
      "select platform_role from users where id = $1",
      [demo.user.id],
    );

    expect(role.rows[0]?.platform_role).toBe("platform_admin");
    expect(await countRows(db, "tenants")).toBe(1);
  });

  it("seeds the vertical slice idempotently", async () => {
    const db = await createMemoryDb();
    opened.push(db);

    const first = await seedDemo(db);
    const second = await seedDemo(db);

    expect(second.user.id).toBe(first.user.id);
    expect(second.tenant.id).toBe(first.tenant.id);
    expect(await countRows(db, "users")).toBe(1);
    expect(await countRows(db, "tenants")).toBe(1);
    expect(await countRows(db, "contacts")).toBe(1);
    expect(await countRows(db, "leads")).toBe(1);
    expect(await countRows(db, "form_submissions")).toBe(1);
  });

  it("never republishes an existing draft when the demo is reopened", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const first = await seedDemo(db);
    const services = createServices(db);
    const before = await services.getPublishedSite(first.tenant.slug);
    const workspace = await services.getWebsiteWorkspace(
      first.user.id,
      first.tenant.id,
    );
    const hero = workspace.sections.find((section) => section.type === "hero");
    if (!before || !hero) {
      throw new Error("Demo website fixture is incomplete.");
    }
    const liveTitle = before.sections.find(
      (section) => section.type === "hero",
    )?.title;
    const publicationCount = await countRows(db, "website_publications");

    await services.updateWebsiteSection(first.user.id, first.tenant.id, hero.id, {
      title: "Brouillon prive de demonstration",
      body: hero.body,
      imageUrl: hero.imageUrl,
      buttonLabel: hero.buttonLabel,
      buttonHref: hero.buttonHref,
      enabled: hero.enabled,
    });
    await seedDemo(db);

    expect(await countRows(db, "website_publications")).toBe(publicationCount);
    const after = await services.getPublishedSite(first.tenant.slug);
    expect(after?.sections.find((section) => section.type === "hero")?.title).toBe(
      liveTitle,
    );
    const draft = await services.getWebsiteWorkspace(
      first.user.id,
      first.tenant.id,
    );
    expect(draft.website?.status).toBe("draft");
    expect(draft.sections.find((section) => section.type === "hero")?.title).toBe(
      "Brouillon prive de demonstration",
    );
  });
});

async function countRows(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  table: string,
) {
  const result = await db.query<{ count: number | string }>(
    `select count(*) as count from ${table}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}
