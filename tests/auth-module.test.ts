import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { registerUser, type AuthError } from "../src/modules/auth";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("auth module", () => {
  it("returns a typed error for duplicate registrations", async () => {
    const { db } = await setup();

    await registerUser(db, {
      name: "Malia Auth",
      email: "malia.auth@example.com",
      password: "Password!1",
    });

    await expect(
      registerUser(db, {
        name: "Malia Auth",
        email: "MALIA.AUTH@example.com",
        password: "Password!1",
      }),
    ).rejects.toMatchObject({
      name: "AuthError",
      code: "account_exists",
      message: "Un compte existe deja avec cet email.",
    } satisfies Partial<AuthError>);
  });
});
