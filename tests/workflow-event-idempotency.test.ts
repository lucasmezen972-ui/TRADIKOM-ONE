import { afterEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "../src/lib/db";
import { enqueueDomainEvent } from "../src/modules/workflows/engine";
import type { WorkflowEvent } from "../src/modules/workflows/types";

describe("workflow domain event idempotency", () => {
  const opened: Array<Awaited<ReturnType<typeof createMemoryDb>>> = [];

  afterEach(async () => {
    await Promise.all(opened.splice(0).map((db) => db.close()));
  });

  it("accorde l'ownership à un seul enqueue concurrent", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const event: WorkflowEvent = {
      id: "event_concurrent_a",
      tenantId: "tenant_concurrent_event",
      actorId: "actor_concurrent_event",
      type: "workflow.concurrent.test",
      payload: {},
      correlationId: "correlation_concurrent_event",
      idempotencyKey: "workflow.concurrent.test:same-key",
    };

    const ownership = await Promise.all([
      enqueueDomainEvent(db, event),
      enqueueDomainEvent(db, { ...event, id: "event_concurrent_b" }),
    ]);
    const persisted = await db.query<{ count: number }>(
      `select count(*)::int as count
       from domain_events
       where tenant_id = $1 and idempotency_key = $2`,
      [event.tenantId, event.idempotencyKey],
    );

    expect(ownership.filter(Boolean)).toHaveLength(1);
    expect(ownership.filter((owned) => !owned)).toHaveLength(1);
    expect(persisted.rows[0]?.count).toBe(1);
  });
});
