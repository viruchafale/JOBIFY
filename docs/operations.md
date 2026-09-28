# JobiFy Operations Guide (Ingestion Scheduler)

Operational runbook for the Phase 6 ingestion scheduler. For the
architecture and design rationale, see
`docs/architecture/PHASE-6-SCHEDULING-RELIABILITY.md`.

## Processes

| Process | Command | Starts a scheduler? |
| :--- | :--- | :--- |
| `job-service` (API) | `node dist/index.js` | Never |
| `job-scheduler` | `node dist/ingestion/scripts/run-scheduler.js` | Yes, if `INGESTION_SCHEDULER_ENABLED=true` |

They share the exact same codebase/image (`services/job`) — `job-scheduler`
is the same container image with a different `command:` in
`docker-compose.yml`. There is no second ingestion microservice.

## Configuration

All variables are read and validated by
`services/job/src/ingestion/scheduler/config.ts`, at `job-scheduler`
startup — an invalid value fails immediately with a specific message,
before any ingestion runs. See `services/job/.env.example` for the full,
commented list:

```env
INGESTION_SCHEDULER_ENABLED=true
INGESTION_SCHEDULES=lever:0 * * * *;greenhouse:15 * * * *;ashby:30 * * * *
INGESTION_TIMEZONE=UTC
INGESTION_MAX_CONCURRENCY=1
INGESTION_LOCK_TTL_SECONDS=1800
INGESTION_RETRY_MAX_ATTEMPTS=3
INGESTION_RETRY_BASE_DELAY_MS=1000
INGESTION_RETRY_MAX_DELAY_MS=30000
INGESTION_STALE_AFTER_RUNS=3
INGESTION_SHUTDOWN_TIMEOUT_MS=30000
```

Plus the per-source `LEVER_COMPANIES` / `GREENHOUSE_COMPANIES` /
`ASHBY_COMPANIES` from Phases 4–5 for whichever sources are scheduled.

## Day-to-day operator commands

```bash
cd services/job

# Check source health right now:
npm run ingest:health

# Run every configured source once, immediately (doesn't wait for cron):
npm run ingest:scheduler -- --once

# Start the long-running scheduler (normally done by the job-scheduler container):
npm run ingest:scheduler
```

`ingest:health` reads `ingestion_source_health` and exits non-zero if any
source is `unhealthy` (>=3 consecutive failed runs) — safe to use as a
liveness check in an external monitor if desired.

## Docker

```bash
docker compose up -d postgres redis migration job-service job-scheduler
```

- `job-scheduler` depends on `migration` completing and `postgres` being
  healthy — same as `job-service`.
- Configure scheduling by setting the `INGESTION_*` / `*_COMPANIES` env vars
  before `docker compose up` (or in a `.env` file at the repo root, which
  Compose reads automatically) — the compose file passes them through with
  safe defaults (`INGESTION_SCHEDULER_ENABLED` defaults to `false`, i.e. the
  container starts and exits with a clear error rather than silently
  scheduling nothing — see Troubleshooting).
- `stop_grace_period: 35s` gives the graceful-shutdown handler (default
  30s timeout) 5s of headroom before Docker sends `SIGKILL`.
- Scaling `job-scheduler` to more than one replica is safe: per-source
  overlap is prevented by the DB lock (`ingestion_locks`), not by there
  being exactly one container.

## Locking model

One row per source in `ingestion_locks`, atomically acquired with a TTL
(`INGESTION_LOCK_TTL_SECONDS`). If a scheduler process crashes mid-run, the
lock is simply recovered by the next attempt once it expires — nothing
manual is required. To check current locks:

```sql
SELECT * FROM ingestion_locks;
```

An empty result is normal — locks only exist while a run is actually
in-flight; they're deleted on completion, not left around.

## Source health

```sql
SELECT * FROM ingestion_source_health ORDER BY source;
```

or `npm run ingest:health` for the human-readable table. Semantics:

```text
completed -> consecutive_failures resets to 0
partial   -> consecutive_failures left untouched (not a success, not a failure)
failed    -> consecutive_failures increments
```

`unhealthy` (per `deriveHealthLabel()`) means `consecutive_failures >= 3`
with the most recent run `failed` — investigate the source's API status and
`last_error` before re-enabling its schedule.

## Stale jobs

A job is only deactivated (`is_active = false`, never deleted) after
`INGESTION_STALE_AFTER_RUNS` (default 3) separate **successful, full**
ingestion runs in a row that didn't see it again. Failed or partial runs
never count toward this — so a temporary source outage, even a long one,
cannot mass-deactivate jobs on its own. If a source needs to run more
tolerantly (e.g. a flaky upstream board), raise
`INGESTION_STALE_AFTER_RUNS` rather than disabling stale detection.

## Troubleshooting

| Symptom | Likely cause / fix |
| :--- | :--- |
| `job-scheduler` container exits immediately with "INGESTION_SCHEDULER_ENABLED is not..." | Expected — set `INGESTION_SCHEDULER_ENABLED=true` to run it long-running, or use `--once` for a one-time run regardless |
| `job-scheduler` exits with "Invalid scheduler configuration: ..." | Fix the specific `INGESTION_*` variable named in the error — schedules referencing an unknown/`fixture` source, an invalid cron expression, or an invalid timezone all fail this way, by design |
| A source never seems to run | Check `INGESTION_SCHEDULES` includes it with a correct cron expression, and check `npm run ingest:health` for a stuck lock (`last_run_at` far in the past with the row still healthy suggests the schedule itself isn't due — check the cron expression and `INGESTION_TIMEZONE`) |
| `ingestion_lock_skipped` in logs | Another process (or an overlapping tick) already holds that source's lock — not an error; it will run on its next due tick |
| A source is stuck `unhealthy` | Check `last_error` in `ingestion_source_health` / `ingestion_runs.error_message`; fix the underlying API/config issue, then either wait for the next scheduled run or run `npm run ingest:<source>` manually to confirm the fix before re-enabling the schedule |
| Jobs disappearing unexpectedly | Should not happen from a single bad run by design (see "Stale jobs" above) — if it does, check `ingestion_runs` for a source that's been reporting `completed` with implausibly low `fetched_count` for several consecutive runs (a genuine upstream data problem, not a JobiFy bug) |

## What's intentionally NOT here

No public HTTP health endpoint was added — the existing job service has no
admin/internal-role authorization model to safely gate one behind, and
building one was judged out of scope for this phase (the CLI + direct SQL
above cover the same needs with less new surface area). No frontend
dashboard, no automated alerting/paging, no cron-of-crons — those remain
open for a later phase if actually needed.
