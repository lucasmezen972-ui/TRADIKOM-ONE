import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { services: createServices(db) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("sessions", () => {
  it("stores hashed session tokens and revokes them on logout", async () => {
    const { services } = await setup();
    const user = await services.registerUser({
      name: "Malia",
      email: "malia.session@example.com",
      password: "Password!1",
    });

    const session = await services.createSession(user.id);
    expect(await services.getSessionUser(session.sessionToken)).not.toBeNull();

    await services.revokeSession(session.sessionToken);
    expect(await services.getSessionUser(session.sessionToken)).toBeNull();
    expect(await services.getSessionUser(session.sessionId)).toBeNull();
  });
});
