# Outbox And Workers

Phase 2 introduces `domain_events` as a transactional outbox foundation.

Fields include tenant, actor, event type, payload, status, attempts, idempotency key, correlation ID, causation ID, next run time, error, and timestamps.

The worker entry point is:

```bash
pnpm worker
```

Current worker behavior processes one due batch from `domain_events`.

- pending events whose `next_run_at` is due are atomically claimed as `processing`;
- registered handlers receive the parsed event payload and attempt number;
- successful handlers mark events `succeeded`;
- failed handlers retry with exponential backoff until `maxAttempts`, then mark `failed`;
- stale `processing` events are requeued after the worker lease timeout;
- unsupported event types fail fast with a visible `last_error`.

The lead workflow still executes synchronously to preserve the Phase 1 vertical slice. The outbox worker is now ready for future async handlers without changing public request paths.

Remaining work:

- long-running polling loop;
- dead-letter UI;
- delayed action resumption;
- approval waiting/resume flow.
