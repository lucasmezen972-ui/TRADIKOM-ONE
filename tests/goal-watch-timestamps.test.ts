import { describe, expect, it, vi } from "vitest";
import {
  evaluateGoalWatchInputSchema,
  goalWatchEvaluationAuditSchema,
} from "../src/modules/goal-watch/schemas";
import { evaluateGoalWatch } from "../src/modules/goal-watch/service";

const acceptedTimestamps = [
  "2026-08-20T13:00:00Z",
  "2026-08-20T13:00:00.1Z",
  "2026-08-20T13:00:00.12Z",
  "2026-08-20T13:00:00.123Z",
  "2026-08-20T15:00:00+02:00",
  "2026-08-20T15:00:00.123+02:00",
  "2026-08-20T09:30:00.123-03:30",
  "2026-08-20T13:00:00+15:59",
  "2026-08-20T13:00:00-15:59",
  "2026-08-20T13:00:00.123+15:59",
  "2026-08-20T13:00:00.123-15:59",
];

const rejectedTimestamps = [
  "2026-08-20T13:00:00.1234Z",
  "2026-08-20T13:00:00.123456Z",
  "2026-08-20T13:00:00.123456789Z",
  "2026-08-20T13:00:00.0000Z",
  "2026-08-20T15:00:00.1234+02:00",
  "2026-08-20T09:30:00.123456-03:30",
  "2026-08-20T13:00:00+16:00",
  "2026-08-20T13:00:00-16:00",
  "2026-08-20T13:00:00+23:59",
  "2026-08-20T13:00:00-23:59",
  "2026-08-20T13:00:00.123+16:00",
  "2026-08-20T13:00:00.123-16:00",
];

describe("précision des horodatages Goal Watch", () => {
  it.each(acceptedTimestamps)(
    "conserve les observations et preuves à précision milliseconde : %s",
    (observedAt) => {
      expect(evaluateGoalWatchInputSchema.parse(input(observedAt)).observedAt)
        .toBe(observedAt);
      expect(goalWatchEvaluationAuditSchema.parse(audit(observedAt)).observedAt)
        .toBe(observedAt);
    },
  );

  it.each(rejectedTimestamps)(
    "refuse les horodatages hors contrat dans les observations et preuves : %s",
    (observedAt) => {
      expect(evaluateGoalWatchInputSchema.safeParse(input(observedAt)).success)
        .toBe(false);
      expect(goalWatchEvaluationAuditSchema.safeParse(audit(observedAt)).success)
        .toBe(false);
    },
  );

  it.each(rejectedTimestamps)(
    "refuse les horodatages hors contrat avant toute transaction ou requête SQL : %s",
    async (observedAt) => {
      const query = vi.fn(async () => ({ rows: [] }));
      const withTransaction = vi.fn();
      const db = {
        __runtime: "postgres" as const,
        __withTransaction: withTransaction,
        query,
      };

      await expect(evaluateGoalWatch(db, "system_goal_watch", input(observedAt)))
        .rejects.toMatchObject({ name: "ZodError" });
      expect(withTransaction).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    },
  );
});

function input(observedAt: string) {
  return {
    tenantId: "tenant_goal_precision",
    goalId: "goal_watch_precision",
    evaluationKey: "goal-watch:precision:observation",
    observedAt,
  };
}

function audit(observedAt: string) {
  return {
    schemaVersion: 1,
    signal: "contacts",
    state: "pending",
    evaluationKey: "goal-watch:precision:observation",
    observedAt,
    reported: false,
    reportMessageId: null,
  };
}
