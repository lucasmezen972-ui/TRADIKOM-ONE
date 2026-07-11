# Outbox And Workers

Phase 2 introduces `domain_events` as a transactional outbox foundation.

Fields include tenant, actor, event type, payload, status, attempts, idempotency key, correlation ID, causation ID, next run time, error, and timestamps.

The worker entry point is:

```bash
pnpm worker
```

Current worker behavior reports pending events. The lead workflow currently enqueues domain events and executes synchronously to preserve the Phase 1 vertical slice.

Remaining work:

- long-running polling loop;
- backoff scheduler;
- dead-letter UI;
- delayed action resumption;
- approval waiting/resume flow.
