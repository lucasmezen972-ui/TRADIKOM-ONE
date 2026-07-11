# Outbox And Workers

Phase 2 introduces `domain_events` as a transactional outbox foundation.

Fields include tenant, actor, event type, payload, status, attempts, idempotency key, correlation ID, causation ID, next run time, error, and timestamps.

The worker entry point is:

```bash
pnpm worker
```

By default, the worker runs in one-shot mode and processes one due batch from
`domain_events`. This remains the mode used by CI and scheduled jobs.

```bash
WORKER_MODE=once pnpm worker
```

Long-running polling mode is available for hosted worker processes:

```bash
WORKER_MODE=poll WORKER_POLL_INTERVAL_MS=5000 WORKER_BATCH_SIZE=25 pnpm worker
```

- pending events whose `next_run_at` is due are atomically claimed as `processing`;
- registered handlers receive the parsed event payload and attempt number;
- successful handlers mark events `succeeded`;
- failed handlers retry with exponential backoff until `maxAttempts`, then mark `failed`;
- stale `processing` events are requeued after the worker lease timeout;
- unsupported event types fail fast with a visible `last_error`.
- polling mode emits structured JSON logs for startup, heartbeat, batch completion,
  signal handling, shutdown, and errors;
- `SIGTERM` and `SIGINT` request graceful shutdown and database resources are closed
  before the process exits.
- failed terminal events are visible from Automatisations as tenant-scoped
  incidents with redacted error messages, attempts, correlation IDs, and update
  timestamps.
- manager/owner operators can requeue failed terminal events from
  Automatisations; the retry resets worker attempts, clears the safe error, and
  records an audit event.
- workflow step rows persist action attempt counts, scheduled/start/completion
  timestamps, and safe error summaries.
- domain events persist worker attempt metadata: last attempted time, retry delay,
  failure classification, and configured max attempts.

The lead workflow is backed by persisted workflow definitions and durable
`workflow.resume` events. Wait actions, approval decisions, and manual retry now
resume through the outbox worker rather than a hidden in-memory path.

Remaining work:

- domain-specific async handlers beyond the lead workflow;
- deeper delivery/run recovery views beyond the current requeue control.
