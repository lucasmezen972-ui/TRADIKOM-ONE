import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { seedDemo } from "../src/modules/demo";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("demo module", () => {
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
