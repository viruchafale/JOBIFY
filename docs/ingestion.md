# JobiFy Ingestion System

A single reference for the whole ingestion system (Phases 3–6). For the
full history/rationale of each phase, see `docs/architecture/`:

- `PHASE-3-INGESTION-FOUNDATION.md` — the pipeline itself
- `PHASE-4-LEVER-INGESTION.md` — the first live source
- `PHASE-5-MULTI-SOURCE-INGESTION.md` — Greenhouse + Ashby
- `PHASE-6-SCHEDULING-RELIABILITY.md` — scheduling, locking, retries, health, stale detection

## Architecture

```text
                Scheduler (Phase 6, optional)
                    │
                    ▼
             Source Registry
                    │
          ┌─────────┼─────────┬─────────┐
          ▼         ▼         ▼         ▼
       Fixture   Lever   Greenhouse   Ashby
          │         │         │         │
          └─────────┴─────────┴─────────┘
                    ▼
             runIngestion()
                    │
     fetch → normalize → validate → dedupe → persist
                    ▼
                PostgreSQL
     (external_jobs, raw_external_jobs, ingestion_runs,
      ingestion_locks, ingestion_source_health)
```

Every source adapter (`services/job/src/ingestion/sources/*Adapter.ts`)
implements the same contract:

```ts
interface JobSourceAdapter {
  readonly source: string;
  fetchJobs(): Promise<RawExternalJob[]>;
  getLastFetchErrors?(): string[]; // optional: multi-target sources (Lever/Greenhouse/Ashby)
}
```

An adapter's only job is HTTP request → shape into `RawExternalJob[]`. It
never touches PostgreSQL, never normalizes, never deduplicates, never
schedules. Everything after that is common code, shared by every source.

## Sources

| Source | Config | Official API |
| :--- | :--- | :--- |
| `fixture` | none (local JSON, no network) | n/a — deterministic test data |
| `lever` | `LEVER_COMPANIES` | `api.lever.co/v0/postings/<slug>` |
| `greenhouse` | `GREENHOUSE_COMPANIES` | `boards-api.greenhouse.io/v1/boards/<slug>/jobs` |
| `ashby` | `ASHBY_COMPANIES` | `api.ashbyhq.com/posting-api/job-board/<slug>` |

All three real sources use `slug` or `slug:Display Name` in their
comma-separated env var. `fixture` cannot be scheduled (Phase 6 rejects it
at config-validation time).

## Running ingestion manually

```bash
cd services/job
npm run ingest:fixture      # no network, no config needed
npm run ingest:lever        # requires LEVER_COMPANIES
npm run ingest:greenhouse   # requires GREENHOUSE_COMPANIES
npm run ingest:ashby        # requires ASHBY_COMPANIES
```

Each is a thin script that resolves an adapter from the source registry and
calls the same `runIngestion()` — there is exactly one ingestion pipeline,
never one per source.

## Running ingestion on a schedule (Phase 6)

```bash
npm run ingest:scheduler              # long-running; needs INGESTION_SCHEDULER_ENABLED=true
npm run ingest:scheduler -- --once    # run every configured source once, right now, then exit
```

See `docs/operations.md` for configuration, locking, retries, health, and
troubleshooting.

## Idempotency

Every source is idempotent: re-running it updates `last_seen_at` on
existing rows (matched via `source+sourceJobId` → canonical URL → SHA-256
content fingerprint, in that order) and never creates duplicates.
`first_seen_at` is set once and never overwritten.

## Adding a new source

1. Implement `JobSourceAdapter` in `sources/<name>Adapter.ts` — fetch +
   shape only. Follow the Lever/Greenhouse/Ashby pattern: per-company/board
   fetch, `getLastFetchErrors()` if it fans out across multiple targets.
2. Register it in `sources/index.ts`.
3. Seed its `external_job_sources` row via a new migration.
4. Add `npm run ingest:<name>` calling the same `runIngestion()`.
5. (Optional) Add it to `INGESTION_SCHEDULES` once verified manually.

`normalize.ts`, `validate.ts`, `dedupe.ts`, `repository.ts`, `runner.ts`,
and everything under `scheduler/` require no changes for a new source
unless it needs a genuinely new *common* normalization rule.

## Source policy

Only official public APIs are used — no scraping around them, no
authentication bypass, no CAPTCHA/anti-bot/rate-limit evasion, no private
endpoints, no stolen credentials. Where a field isn't available from the
official API, the ingested record stores `null` rather than inventing or
inferring it.
