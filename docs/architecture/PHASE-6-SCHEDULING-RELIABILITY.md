# JobiFy 2.0 — Phase 6: Scheduling + Ingestion Reliability

Makes the Phase 3–5 ingestion engine reliable enough to run unattended in
production: scheduling, DB-backed locking, bounded retries, source health,
and conservative stale-job detection. The pipeline itself
(`adapter -> raw -> normalize -> validate -> dedupe -> persist`) is
**unchanged** — Phase 6 only decides *when* and *how carefully* to call it.

```text
                Scheduler
                    │
                    ▼
             Source Registry
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
        Lever   Greenhouse   Ashby
          │         │         │
          └─────────┼─────────┘
                    ▼
             runIngestion()          (unchanged since Phase 3)
                    ▼
       normalize → validate → dedupe
                    ▼
                PostgreSQL
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
      Run History         Source Health
                              │
                              ▼
                       Stale Detection
```

## 1. Where Phase 6 lives

```text
services/job/src/ingestion/scheduler/
  config.ts                 env parsing + validation (INGESTION_*)
  cron.ts                   minimal 5-field cron parser/matcher (no new dependency)
  lock.ts                   DB-backed per-source lease lock
  health.ts                 ingestion_source_health read/write
  staleJobs.ts              conservative stale-job deactivation
  retry.ts                  error classification + backoff-with-jitter
  logger.ts                 structured JSON logs (same shape as runner.ts)
  executeSourceIngestion.ts lock -> retry(runIngestion()) -> health -> stale -> unlock
  scheduler.ts              the Scheduler class: due-check, concurrency, shutdown

services/job/src/ingestion/scripts/
  run-scheduler.ts          `npm run ingest:scheduler` [--once]
  ingestion-health-cli.ts   `npm run ingest:health`
```

None of `normalize.ts`, `validate.ts`, `dedupe.ts`, or `repository.ts`'s
persistence functions changed. `runner.ts` and `repository.ts` gained a
small, backward-compatible extension: `runIngestion()` now accepts optional
`triggerType`/`attempt`/`scheduledFor` (default `"manual"`/`1`/`null`, so
every pre-Phase-6 caller — `ingest-fixture.ts`, `ingest-lever.ts`,
`ingest-greenhouse.ts`, `ingest-ashby.ts` — behaves exactly as before) and
`JobSourceAdapter` gained one more **optional** method beyond Phase 4's
`getLastFetchErrors()` — none; Phase 6 didn't need a new adapter hook.

## 2. Scheduler

`Scheduler` (scheduler.ts) does exactly one thing: every tick (default
15s), for each configured schedule, check whether its cron expression
matches the current minute (in the configured timezone) and it hasn't
already fired this exact minute — if so, dispatch it. Dispatch calls
`executeSourceIngestion()`, which is the only place Phase 6 wraps
`runIngestion()`.

Due-checking is a pure function (`isScheduleDue()`), tested with fixed
`Date` objects — no real timers needed in tests.

### Commands

```bash
npm run ingest:scheduler          # long-running; requires INGESTION_SCHEDULER_ENABLED=true
npm run ingest:scheduler -- --once  # runs every configured source once, ignoring cron timing, then exits
```

`--once` exists specifically so the whole scheduler pipeline (lock, retry,
health, stale-detection) can be verified without waiting for a real
interval to elapse.

## 3. Schedule configuration

```env
INGESTION_SCHEDULER_ENABLED=true
INGESTION_SCHEDULES=lever:0 * * * *;greenhouse:15 * * * *;ashby:30 * * * *
INGESTION_TIMEZONE=UTC
```

- Semicolon-separated `source:cron` pairs; standard 5-field cron
  (minute hour day-of-month month day-of-week), including `*/n`, `a-b`,
  `a-b/n`, and comma lists.
- Every `source` must already be registered in `sources/index.ts`
  (`fixture`/`lever`/`greenhouse`/`ashby`) — an unregistered name fails
  config validation with a clear error at startup, before anything runs.
- `fixture` is explicitly rejected even if registered — it's a local
  deterministic test source and must never run on a production schedule.
- An invalid cron expression, a duplicate schedule for the same source, or
  an invalid `INGESTION_TIMEZONE` (validated against `Intl.DateTimeFormat`)
  all fail at startup with a specific error, not silently.
- No source is scheduled unless explicitly listed — no hidden defaults.

## 4. Locking (overlap prevention)

`ingestion_locks` — one row per source, atomically acquired in a single
statement:

```sql
INSERT INTO ingestion_locks (source, owner_id, locked_until, ...)
VALUES (...)
ON CONFLICT (source) DO UPDATE
  SET owner_id = EXCLUDED.owner_id, locked_until = EXCLUDED.locked_until, ...
  WHERE ingestion_locks.locked_until < NOW()
RETURNING owner_id;
```

**Why not `pg_advisory_lock`**: the job service talks to Postgres through
`@neondatabase/serverless`'s `neon()` HTTP driver (`utils/db.ts`) — every
`query()` call is its own HTTP request with no guaranteed persistent
connection, which a session-level advisory lock requires. A row with a TTL
survives across requests, processes, and crashes, using the exact same
`query()` surface every other ingestion query already uses — no new DB
client, no new infrastructure.

- One active lock per source (`source` is the primary key).
- Acquisition is atomic — never check-then-write.
- An expired lock (`locked_until < NOW()`) is transparently recovered by
  the next acquisition attempt, from any process.
- TTL is configurable (`INGESTION_LOCK_TTL_SECONDS`, default 1800s).
- Released in a `finally` block after every attempt (success or failure).
- A lock-skip is logged (`ingestion_lock_skipped`) and does **not** count
  as an ingestion failure — no health update, no run recorded.
- A scheduler crash mid-run never permanently blocks a source: the lock
  simply expires and the next tick (from any process) recovers it.

## 5. Global concurrency

`INGESTION_MAX_CONCURRENCY` (default 1) bounds how many sources **this
scheduler process** runs at once, via an in-process counting semaphore.
This is independent of the per-source lock: the lock prevents the *same*
source from double-running (across processes); the semaphore bounds *total*
simultaneous ingestion work from one process (to keep DB/network load
predictable). Verified: with `maxConcurrency=1`, two simultaneously-due
sources never overlap; with `maxConcurrency=2`, they do.

## 6. Retries

Retries wrap the *entire* `runIngestion()` call for a source, only when its
overall status is `"failed"` (i.e. the whole fetch failed, not "some
companies failed") — see §7. Exponential backoff with "equal jitter"
(delay uniformly random in `[cap/2, cap]`, `cap = min(base*2^(attempt-1),
maxDelay)`), configurable:

```env
INGESTION_RETRY_MAX_ATTEMPTS=3
INGESTION_RETRY_BASE_DELAY_MS=1000
INGESTION_RETRY_MAX_DELAY_MS=30000
```

### Error classification (retry.ts)

`runIngestion()` never throws (see runner.ts) — a fetch failure surfaces as
`summary.status === "failed"` with `summary.errorMessage` (the first
recorded error string). That string is the only signal available without
redesigning the adapter/runner error model, so classification is
pattern-based:

```ts
type IngestionErrorClass = "retryable" | "permanent" | "configuration" | "unknown";
```

| Class | Examples | Retried? |
| :--- | :--- | :--- |
| `retryable` | HTTP 429/5xx, timeouts, `ECONNRESET`/`ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`, "network request failed" | Yes |
| `permanent` | HTTP 4xx (other than 429), malformed response, unknown board/company | No |
| `configuration` | "no companies configured", "invalid company configuration" | No |
| `unknown` | anything unrecognized | No (conservative default) |

**Known limitation**: when *every* configured company/board for a source
fails (see the Lever/Greenhouse/Ashby adapters' "all N failed" aggregate
message), the sub-errors are joined into one string. If they're of
different classes, classification is best-effort and biased toward
`retryable` when any sub-message matches — a wasted retry attempt is bounded
and cheap, so this favors giving a real transient failure a chance over
strict precision.

## 7. Partial source failures (unchanged Phase 4/5 behavior, now health-aware)

If `company-a` succeeds, `company-b` times out, and `company-c` succeeds,
the run's `status` is `"partial"` — exactly as in Phase 4/5. Phase 6 adds:

- `partial` is **never** retried at the source level — that would re-fetch
  the companies that already succeeded, and the adapter contract has no
  per-company retry hook.
- `ingestion_source_health.last_status` is set to `"partial"` and
  `consecutive_failures` is left **untouched** (not reset, not
  incremented) — a partial run is neither a success nor a failure.
- `deactivateStaleJobs()` only ever runs after a `"completed"` status, never
  after `"partial"` — see §9.

## 8. Run history (`ingestion_runs`, extended)

Additive columns only (migration 005):

| Column | Meaning |
| :--- | :--- |
| `trigger_type` | `manual` \| `scheduled` \| `retry` — attempt 1 of a scheduled run is `scheduled`; every retry attempt after it is `retry` |
| `attempt` | 1, 2, 3, ... — each retry gets its own row, so every attempt is independently auditable |
| `scheduled_for` | the wall-clock tick that triggered this run (`null` for manual runs) |
| `duration_ms` | now persisted directly (previously only computed in the JS summary, never stored) |

## 9. Source health (`ingestion_source_health`, new table)

Updated after **every** attempt (every retry included) via a single atomic
upsert:

```text
completed -> success:   consecutive_failures resets to 0, last_success_at = NOW()
partial   -> degraded:  consecutive_failures UNCHANGED, counted in total_runs only
failed    -> failure:   consecutive_failures += 1, last_failure_at = NOW()
```

`total_runs` counts every attempt; `total_successes` counts only
`completed`; `total_failures` counts only `failed` (a `partial` run
increments neither, by design — it's not a success and not a failure).

Derived display label (`deriveHealthLabel()`, not stored):

```text
healthy    last_status = completed
degraded   last_status = partial, OR failed with consecutive_failures < 3
unhealthy  last_status = failed  AND consecutive_failures >= 3
unknown    no history yet
```

## 10. Stale-job detection

Deliberately deferred in Phase 3; conservative by design in Phase 6.

**Rule**: a job may only be deactivated (`is_active = false`, never
deleted) once the number of **`completed`** `ingestion_runs` for its source
that started after the job's `last_seen_at` reaches
`INGESTION_STALE_AFTER_RUNS` (default 3). Failed and partial runs never
count toward this — they neither advance nor reset it.

No schema change was needed for this — it's derived entirely from existing
`ingestion_runs` history and `external_jobs.last_seen_at`:

```sql
UPDATE external_jobs
SET is_active = false, updated_at = NOW()
WHERE source = $1 AND is_active = true
  AND (
    SELECT COUNT(*) FROM ingestion_runs ir
    WHERE ir.source = $1 AND ir.status = 'completed' AND ir.started_at > external_jobs.last_seen_at
  ) >= $2
```

Called only immediately after a run finishes with `status = 'completed'`
(never after `partial`/`failed`). A job that reappears later is
automatically reactivated by the existing Phase 3
`updateExternalJobSeen()` (which always sets `is_active = true` on any
re-observed job) — no new "reactivation" logic was needed.

**Worked example** (the edge case from the spec): Lever has 1,000 active
jobs; one `completed` run's fetch has a transient issue and only returns
300. Because the threshold counts *runs*, not job counts, none of the
missing 700 are deactivated after that single run — it takes
`INGESTION_STALE_AFTER_RUNS` (3, by default) separate `completed` runs all
missing the same job before it's flipped inactive.

## 11. Structured logging

Same JSON shape as the existing `runner.ts` logs
(`timestamp`/`level`/`service`/`component`/`event`), so scheduler logs
interleave cleanly: `ingestion_started`, `ingestion_completed`,
`ingestion_retry`, `ingestion_lock_skipped`, `stale_jobs_deactivated`,
`scheduler_started`/`scheduler_stopping`/`scheduler_stopped`/
`scheduler_shutdown_timeout`, `scheduler_task_error`. Never logs
credentials, cookies, tokens, or full job payloads — only counters, ids,
sources, and short error messages.

## 12. Graceful shutdown

`SIGTERM`/`SIGINT` → stop scheduling new work immediately (the tick timer
is cleared and the dispatch loop checks a `stopped` flag) → wait for
in-flight ingestion up to `INGESTION_SHUTDOWN_TIMEOUT_MS` (default 30s) →
return. If the timeout elapses first, in-flight tasks keep running in the
background (Node can't safely abort an in-flight HTTP request) and their
own `finally` block still releases their lock when they finish; if the
process is killed before that, the lock's **TTL**, not the shutdown path,
is what guarantees it's never held permanently. Docker's
`stop_grace_period` for `job-scheduler` is set to 35s (5s more than the
default shutdown timeout) so Docker's own SIGKILL doesn't cut off the
graceful path.

## 13. Docker

`job-scheduler` in `docker-compose.yml` builds from the **same**
`services/job` image/context as `job-service`, with a different
`command:` (`node dist/ingestion/scripts/run-scheduler.js`) — no second
codebase, no second Dockerfile. `job-service` (the API, `index.ts`) never
imports or starts anything from `ingestion/scheduler/`, so scaling
`job-service` replicas can never accidentally spawn a duplicate scheduler.
`job-scheduler` itself is also safe to scale to more than one replica if
ever needed — per-source overlap is prevented by the DB lock, not by there
being exactly one container.

## 14. Operational CLI

```bash
npm run ingest:health
```

```text
SOURCE       HEALTH    LAST STATUS   LAST RUN          CONSEC. FAILURES   TOTAL RUNS
ashby        healthy   completed     2026-09-24 09:30  0                  12
greenhouse   healthy   completed     2026-09-24 09:15  0                  12
lever        degraded  partial       2026-09-24 09:00  0                  12
```

No frontend dashboard was built (explicitly deferred — see §16).

## 15. Testing

All new modules are unit tested with fake in-memory DBs/adapters — no real
network, no real timers:

- `cron.test.ts` — parsing, validation errors, timezone-aware matching, the
  day-of-month/day-of-week OR quirk.
- `config.test.ts` — valid/invalid schedules, unknown source, fixture
  rejection, duplicate schedule, timezone validation, every numeric setting.
- `lock.test.ts` — acquire, second-acquisition rejection, expired-lock
  recovery, release-after-success, wrong-owner release no-op, per-source
  isolation, crash/TTL-expiry recovery.
- `health.test.ts` — completed/partial/failed semantics exactly as in §9,
  `deriveHealthLabel()` thresholds.
- `staleJobs.test.ts` — before/at/after threshold, failed/partial runs never
  counting, per-job protection via `last_seen_at` refresh, per-source
  isolation, row preservation (never deleted).
- `retry.test.ts` — every documented error class, backoff growth, jitter
  bounds, max-attempts cap.
- `executeSourceIngestion.test.ts` — full orchestration: lock-skip, retry
  loop (fail→fail→succeed), permanent-failure no-retry, retry-exhaustion,
  partial no-retry, lock always released.
- `scheduler.test.ts` — due-selection, concurrency limiting (1 vs N),
  same-source re-dispatch guard, failure isolation (a source whose adapter
  construction throws doesn't stop another source or the scheduler),
  graceful shutdown (stops new work, waits for in-flight work, respects the
  timeout, lock still releases after a timeout race).

Live integration verification (real local Postgres, no real Lever/
Greenhouse/Ashby network calls needed for this phase) is described in the
Phase 6 implementation report.

## 16. Phase boundary

Implemented: scheduler, config-driven schedules, DB-backed locking, global
concurrency, bounded retry with backoff+jitter, error classification,
partial-failure health-awareness, run-history enrichment, persistent source
health, conservative stale-job detection, graceful shutdown, structured
logging, operational CLI, Docker scheduler service, migration, tests.

NOT implemented (later phases): advanced search, semantic search,
embeddings, AI matching, resume matching, candidate intelligence,
recommendations, notifications, auto-apply, personal job agent, new ATS
providers, fuzzy deduplication, cross-source job merging, a frontend health
dashboard, a public health HTTP endpoint (the CLI was judged sufficient and
lower-risk — see the implementation report for why).
