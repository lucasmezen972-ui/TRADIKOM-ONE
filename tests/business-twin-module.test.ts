import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import {
  getBusinessTwin,
  saveBusinessTwin,
} from "../src/modules/business-twin";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("business twin module", () => {
  it("persists onboarding and enforces tenant isolation", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Business Twin Owner",
      email: "business-twin-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Business Twin Outsider",
      email: "business-twin-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Business Twin Garage",
      category: "Garage automobile",
    });

    const saved = await saveBusinessTwin(
      db,
      owner.id,
      tenant.id,
      defaultGarageOnboarding(),
    );
    const loaded = await getBusinessTwin(db, owner.id, tenant.id);

    expect(loaded).toEqual(saved);
    await expect(
      getBusinessTwin(db, outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
  });
});
