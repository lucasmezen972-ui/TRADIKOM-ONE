import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import {
  createDatabaseRateLimiter,
  createMemoryRateLimiter,
  RateLimitError,
} from "../src/modules/rate-limit";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("rate limiting", () => {
  it("enforces thresholds, retry-after, and window expiry", async () => {
    let now = new Date("2026-07-12T14:00:00.000Z");
    const limiter = createMemoryRateLimiter({ now: () => now });
    const input = {
      operationKey: "auth.login",
      subjectKey: "malia@example.com",
      limit: 2,
      windowSeconds: 60,
    };

    expect(await limiter.consume(input)).toMatchObject({
      allowed: true,
      count: 1,
      remaining: 1,
    });
    expect(await limiter.consume(input)).toMatchObject({
      allowed: true,
      count: 2,
      remaining: 0,
    });
    expect(await limiter.consume(input)).toMatchObject({
      allowed: false,
      count: 3,
      retryAfterSeconds: 60,
    });

    now = new Date("2026-07-12T14:01:00.000Z");
    expect(await limiter.consume(input)).toMatchObject({
      allowed: true,
      count: 1,
      retryAfterSeconds: 0,
    });
  });

  it("separates operations, subjects, and tenant scopes", async () => {
    const limiter = createMemoryRateLimiter({
      now: () => new Date("2026-07-12T14:00:00.000Z"),
    });
    const base = { limit: 1, windowSeconds: 60 };

    await expectAllowed(limiter.consume({
      ...base,
      operationKey: "auth.login",
      subjectKey: "one@example.com",
      scopeKey: "tenant-a",
    }));
    await expectAllowed(limiter.consume({
      ...base,
      operationKey: "auth.registration",
      subjectKey: "one@example.com",
      scopeKey: "tenant-a",
    }));
    await expectAllowed(limiter.consume({
      ...base,
      operationKey: "auth.login",
      subjectKey: "two@example.com",
      scopeKey: "tenant-a",
    }));
    await expectAllowed(limiter.consume({
      ...base,
      operationKey: "auth.login",
      subjectKey: "one@example.com",
      scopeKey: "tenant-b",
    }));
    expect(await limiter.consume({
      ...base,
      operationKey: "auth.login",
      subjectKey: "one@example.com",
      scopeKey: "tenant-a",
    })).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
  });

  it("consumes database buckets atomically under concurrency", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const limiter = createDatabaseRateLimiter(db);
    const now = new Date("2026-07-12T14:00:00.000Z");
    const decisions = await Promise.all(
      Array.from({ length: 20 }, () =>
        limiter.consume({
          operationKey: "public_form.submit",
          subjectKey: "concurrent@example.com",
          scopeKey: "tenant-concurrent",
          limit: 5,
          windowSeconds: 60,
          now,
        }),
      ),
    );

    expect(decisions.filter((item) => item.allowed)).toHaveLength(5);
    expect(Math.max(...decisions.map((item) => item.count))).toBe(20);
    expect(decisions.filter((item) => !item.allowed)).toHaveLength(15);
    const stored = await db.query<{
      key: string;
      subject_hash: string;
      scope_hash: string;
    }>("select key, subject_hash, scope_hash from rate_limits limit 1");
    expect(JSON.stringify(stored.rows[0])).not.toContain(
      "concurrent@example.com",
    );
    expect(JSON.stringify(stored.rows[0])).not.toContain("tenant-concurrent");
  });

  it("cleans expired buckets in bounded batches", async () => {
    let now = new Date("2026-07-12T14:00:00.000Z");
    const limiter = createMemoryRateLimiter({ now: () => now });
    await limiter.consume({
      operationKey: "cleanup.test",
      subjectKey: "one",
      limit: 1,
      windowSeconds: 10,
    });
    await limiter.consume({
      operationKey: "cleanup.test",
      subjectKey: "two",
      limit: 1,
      windowSeconds: 10,
    });

    now = new Date("2026-07-12T14:00:11.000Z");
    expect(await limiter.cleanup?.({ limit: 1 })).toBe(1);
    expect(await limiter.cleanup?.({ limit: 10 })).toBe(1);
  });

  it("rate-limits auth without changing the unknown-account reset response", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    await services.registerUser({
      name: "Malia Rate Auth",
      email: "rate-auth@example.com",
      password: "Password!1",
    });

    for (let index = 0; index < 4; index += 1) {
      await expect(
        services.registerUser({
          name: "Malia Rate Auth",
          email: "rate-auth@example.com",
          password: "Password!1",
        }),
      ).rejects.toThrow("Un compte existe deja avec cet email.");
    }
    await expect(
      services.registerUser({
        name: "Malia Rate Auth",
        email: "rate-auth@example.com",
        password: "Password!1",
      }),
    ).rejects.toBeInstanceOf(RateLimitError);

    for (let index = 0; index < 10; index += 1) {
      await expect(
        services.loginUser({
          email: "rate-auth@example.com",
          password: "WrongPassword!1",
        }),
      ).rejects.toThrow("Email ou mot de passe incorrect.");
    }
    await expect(
      services.loginUser({
        email: "rate-auth@example.com",
        password: "WrongPassword!1",
      }),
    ).rejects.toBeInstanceOf(RateLimitError);

    for (let index = 0; index < 6; index += 1) {
      const response = await services.requestPasswordReset({
        email: "unknown-rate-auth@example.com",
      });
      expect(response).toEqual({ accepted: true });
    }
  });

  it("rate-limits invitation creation and public forms per tenant", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Malia Rate Tenant",
      email: "rate-tenant-owner@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Garage Rate Limit",
      category: "Garage automobile",
    });

    for (let index = 0; index < 10; index += 1) {
      await services.createInvitation(owner.id, tenant.id, {
        email: "rate-invitee@example.com",
        role: "collaborator",
      });
    }
    await expect(
      services.createInvitation(owner.id, tenant.id, {
        email: "rate-invitee@example.com",
        role: "collaborator",
      }),
    ).rejects.toBeInstanceOf(RateLimitError);

    for (let index = 0; index < 10; index += 1) {
      await expect(
        services.acceptInvitation({
          token: "invalid-rate-invitation-token",
          name: "Invitation Rate",
          password: "Password!2",
        }),
      ).rejects.toThrow("Invitation invalide ou expirée.");
    }
    await expect(
      services.acceptInvitation({
        token: "invalid-rate-invitation-token",
        name: "Invitation Rate",
        password: "Password!2",
      }),
    ).rejects.toBeInstanceOf(RateLimitError);

    await services.saveOnboarding(
      owner.id,
      tenant.id,
      defaultGarageOnboarding(),
    );
    await services.publishWebsite(owner.id, tenant.id);
    for (let index = 0; index < 10; index += 1) {
      await services.submitPublicLead(tenant.slug, {
        name: "Lead Rate Limit",
        email: "rate-lead@example.com",
        phone: "+596 696 00 00 00",
        message: "Demande de test rate limit",
        idempotencyKey: `rate-lead-${index}`,
      });
    }
    await expect(
      services.submitPublicLead(tenant.slug, {
        name: "Lead Rate Limit",
        email: "rate-lead@example.com",
        phone: "+596 696 00 00 00",
        message: "Demande de test rate limit",
        idempotencyKey: "rate-lead-blocked",
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});

async function expectAllowed(result: Promise<{ allowed: boolean }>) {
  expect(await result).toMatchObject({ allowed: true });
}
