import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { getDatabaseUrl } from "@/db/client";
import { withSystemTransaction } from "@/db/tenant-context";
import { getDb, type DbClient } from "@/lib/db";
import {
  getPendingDomainEventCount,
  processPendingDomainEvents,
  type DomainEventWorkerSummary,
} from "@/modules/workflows/worker";

export type WorkerMode = "once" | "poll";

export type WorkerConfig = {
  mode: WorkerMode;
  batchSize: number;
  pollIntervalMs: number;
};

export type WorkerLogEntry = {
  level: "info" | "error";
  event: string;
  message: string;
  timestamp?: string;
  correlationId: string;
  [key: string]: unknown;
};

export type WorkerLogger = (entry: WorkerLogEntry) => void;

export type WorkerBatchResult = {
  correlationId: string;
  batchSize: number;
  pendingBefore: number;
  pendingAfter: number;
  summary: DomainEventWorkerSummary;
  startedAt: string;
  completedAt: string;
};

export type WorkerPollResult = {
  mode: "poll";
  correlationId: string;
  iterations: number;
  stoppedBy: "signal" | "max_iterations";
  lastBatch: WorkerBatchResult | null;
};

type WorkerEnvironment = Record<string, string | undefined>;

type WorkerRuntimeOptions = {
  signal?: AbortSignal;
  logger?: WorkerLogger;
  db?: DbClient;
  maxIterations?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

type WorkerBatchOptions = {
  batchSize?: number;
  correlationId?: string;
  db?: DbClient;
  now?: Date;
};

const defaultBatchSize = 25;
const defaultPollIntervalMs = 5_000;
const minimumPollIntervalMs = 100;

export async function runWorkerFromEnvironment(
  env: WorkerEnvironment = process.env,
  options: WorkerRuntimeOptions = {},
) {
  const config = parseWorkerConfig(env);

  if (config.mode === "poll") {
    return runWorkerPoll({
      ...options,
      batchSize: config.batchSize,
      pollIntervalMs: config.pollIntervalMs,
    });
  }

  const batch = await runWorkerBatch({
    db: options.db,
    batchSize: config.batchSize,
  });
  logWorkerBatch(options.logger ?? writeStructuredWorkerLog, "worker.once", batch);
  return batch;
}

export async function runWorkerPoll(
  options: WorkerRuntimeOptions & {
    batchSize?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<WorkerPollResult> {
  const logger = options.logger ?? writeStructuredWorkerLog;
  const correlationId = randomUUID();
  const batchSize = positiveInteger(options.batchSize, defaultBatchSize);
  const pollIntervalMs = boundedPollInterval(options.pollIntervalMs);
  const maxIterations = optionalNonNegativeInteger(options.maxIterations);
  const sleep = options.sleep ?? sleepWithAbort;
  let iterations = 0;
  let lastBatch: WorkerBatchResult | null = null;

  logger({
    level: "info",
    event: "worker.start",
    message: "Worker polling started.",
    timestamp: new Date().toISOString(),
    correlationId,
    mode: "poll",
    batchSize,
    pollIntervalMs,
  });

  while (
    !options.signal?.aborted &&
    (maxIterations === null || iterations < maxIterations)
  ) {
    const iteration = iterations + 1;
    const batchCorrelationId = `${correlationId}:${iteration}`;

    logger({
      level: "info",
      event: "worker.heartbeat",
      message: "Worker polling heartbeat.",
      timestamp: new Date().toISOString(),
      correlationId: batchCorrelationId,
      mode: "poll",
      iteration,
    });

    lastBatch = await runWorkerBatch({
      db: options.db,
      batchSize,
      correlationId: batchCorrelationId,
    });
    iterations += 1;
    logWorkerBatch(logger, "worker.poll", lastBatch);

    if (
      options.signal?.aborted ||
      (maxIterations !== null && iterations >= maxIterations)
    ) {
      break;
    }

    try {
      await sleep(pollIntervalMs, options.signal);
    } catch (error) {
      if (options.signal?.aborted && isAbortError(error)) {
        break;
      }

      throw error;
    }
  }

  const stoppedBy = options.signal?.aborted ? "signal" : "max_iterations";

  logger({
    level: "info",
    event: "worker.shutdown",
    message: "Worker polling stopped.",
    timestamp: new Date().toISOString(),
    correlationId,
    mode: "poll",
    iterations,
    stoppedBy,
  });

  return { mode: "poll", correlationId, iterations, stoppedBy, lastBatch };
}

export async function runWorkerBatch(
  options: WorkerBatchOptions = {},
): Promise<WorkerBatchResult> {
  const batchSize = positiveInteger(options.batchSize, defaultBatchSize);
  const correlationId = options.correlationId ?? randomUUID();
  const startedAt = new Date().toISOString();
  const now = options.now ?? new Date();

  const result = options.db
    ? await runWithClient(options.db, batchSize, now)
    : await runWithRuntimeDatabase(batchSize, now);

  return {
    correlationId,
    batchSize,
    ...result,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

export function parseWorkerConfig(env: WorkerEnvironment): WorkerConfig {
  return {
    mode: env.WORKER_MODE === "poll" ? "poll" : "once",
    batchSize: positiveIntegerString(env.WORKER_BATCH_SIZE, defaultBatchSize),
    pollIntervalMs: boundedPollIntervalString(
      env.WORKER_POLL_INTERVAL_MS ?? env.WORKER_INTERVAL_MS,
    ),
  };
}

export function writeStructuredWorkerLog(entry: WorkerLogEntry) {
  const payload = {
    timestamp: entry.timestamp ?? new Date().toISOString(),
    ...entry,
  };
  const serialized = JSON.stringify(payload);

  if (entry.level === "error") {
    console.error(serialized);
    return;
  }

  console.log(serialized);
}

async function runWithRuntimeDatabase(batchSize: number, now: Date) {
  if (getDatabaseUrl()) {
    await getDb();
    return withSystemTransaction((db) => runWithClient(db, batchSize, now));
  }

  const db = await getDb();
  return runWithClient(db, batchSize, now);
}

async function runWithClient(db: DbClient, limit: number, now: Date) {
  const pendingBefore = await getPendingDomainEventCount(db, now);
  const summary = await processPendingDomainEvents(db, { limit, now });
  const pendingAfter = await getPendingDomainEventCount(db, now);

  return { pendingBefore, summary, pendingAfter };
}

function logWorkerBatch(
  logger: WorkerLogger,
  eventPrefix: "worker.once" | "worker.poll",
  batch: WorkerBatchResult,
) {
  logger({
    level: "info",
    event: `${eventPrefix}.completed`,
    message: "Worker batch completed.",
    timestamp: batch.completedAt,
    correlationId: batch.correlationId,
    batchSize: batch.batchSize,
    pendingBefore: batch.pendingBefore,
    pendingAfter: batch.pendingAfter,
    summary: batch.summary,
  });
}

async function sleepWithAbort(ms: number, signal?: AbortSignal) {
  await delay(ms, undefined, { signal });
}

function positiveInteger(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function positiveIntegerString(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.floor(parsed));
}

function boundedPollInterval(value: number | undefined) {
  return Math.max(
    minimumPollIntervalMs,
    positiveInteger(value, defaultPollIntervalMs),
  );
}

function boundedPollIntervalString(value: string | undefined) {
  return Math.max(
    minimumPollIntervalMs,
    positiveIntegerString(value, defaultPollIntervalMs),
  );
}

function optionalNonNegativeInteger(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.floor(value));
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.includes("aborted"))
  );
}
