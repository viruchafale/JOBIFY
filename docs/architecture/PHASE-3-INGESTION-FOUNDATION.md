# JobiFy 2.0 — Phase 3: Job Ingestion Foundation

Production-quality, source-agnostic ingestion engine inside `services/job`.
No live external source is implemented in this phase; Phase 4 adds Lever.

## 1. Architecture

```text
External Sources
       │
       ▼
SourceAdapter          (fetch + shape only — no DB, no dedupe, no scheduling)
       │
       ▼
Raw Job Data           (RawExternalJob + untouched rawPayload)
       │
       ▼
Normalize              (deterministic: whitespace, HTML, enums, URLs, salary)
       │
       ▼
Validate               (structured accept/reject, never crashes the run)
       │
       ▼
Deduplicate            (L1 source+id → L2 canonical URL → L3 SHA-256 fingerprint)
       │
       ▼
Persist                (parameterized SQL, batched lookups, idempotent upserts)
       │
       ▼
External Jobs          (normalized read model, separate from recruiter `jobs`)
```

Module map (`services/job/src/ingestion/`):

| File | Concern |
| :--- | :--- |
| `adapter.ts` | `JobSourceAdapter` contract |
| `types.ts` | Raw / normalized models, run stats |
| `normalize.ts` | Deterministic normalization (no LLM/embeddings) |
| `fingerprint.ts` | SHA-256 content fingerprint |
| `validate.ts` | Structured validation |
| `dedupe.ts` | In-batch deterministic dedupe |
| `registry.ts` | Source registry (`sourceRegistry`) |
| `repository.ts` | All SQL (parameterized, no N+1 lookups) |
| `runner.ts` | Orchestration + error isolation + run bookkeeping |
| `sources/fixtureSource.ts` | Fixture adapter (offline demo) |
| `sources/index.ts` | Source wiring (add new sources here) |
| `fixtures/jobs.json` | 16 deterministic sample jobs |
| `scripts/ingest-fixture.ts` | `npm run ingest:fixture` entrypoint |

## 2. Source adapter contract

```ts
interface JobSourceAdapter {
  readonly source: string;
  fetchJobs(): Promise<RawExternalJob[]>;
}
```

Adapters must NOT write to PostgreSQL, deduplicate, schedule, or contain
persistence logic. Future sources implement the same contract:

```text
JobSourceAdapter
 ├── LeverAdapter        ← Phase 4 (NOT implemented here)
 ├── GreenhouseAdapter   ← Phase 5
 ├── AshbyAdapter        ← Phase 5
 └── FutureAdapter
```

## 3. Raw vs normalized jobs

- **Raw** (`RawExternalJob`): preserves source information verbatim —
  `source, sourceJobId, sourceUrl, applyUrl, companyName, title, description,
  location, jobType, workLocation, role, salaryMin/Max/Currency, postedAt` —
  plus the untouched `rawPayload` (JSONB in `raw_external_jobs`) so any
  normalization decision can be reproduced/debugged later.
- **Normalized** (`NormalizedExternalJob`): cleaned representation with
  `canonicalUrl` (normalized `sourceUrl`), plain-text `description`
  (HTML stripped), canonical `jobType`/`workLocation` enum text, uppercase
  currency, ISO `postedAt`, and `contentFingerprint`.

Normalization highlights: whitespace collapse + trim, empty→null, HTML/script
removal + entity decoding, job-type mapping (`FULL TIME`, `FullTime`, `ft` →
`Full-time`; same for part-time/contract/internship), work-location mapping
(`WFH` → `Remote`, `OnSite`/`office` → `On-site`, `Hybrid`), URL normalization
(lowercase scheme/host, drop fragment/trailing slash), salary coercion with
min/max swap, currency uppercasing.

## 4. Validation

`validateNormalizedJob()` requires `source`, `sourceJobId`, `canonicalUrl`,
`companyName`, `title`, `description` and returns e.g.
`{ valid: false, reasons: ["missing_title", "missing_source_job_id"] }`.
Rejected records are counted (`rejected_count`), sampled in the run summary,
and never terminate the run.

## 5. Deduplication

- **Level 1**: `source + sourceJobId` (strongest).
- **Level 2**: canonical URL (case-insensitive).
- **Level 3**: SHA-256 over normalized
  `company + title + description + location` (whitespace/case-insensitive).

No fuzzy matching, no AI/embeddings, no probabilistic matching (deferred —
only if later justified). In-batch duplicates are dropped (first wins) and
counted as `duplicate_count`; cross-batch matches resolve to UPDATEs.

## 6. Idempotency

Re-running an ingestion creates zero duplicate rows: existing rows are
matched (L1→L2→L3), refreshed, and counted as `updated_count`. `last_seen_at`
is set to `NOW()` on every observation; `first_seen_at` is never overwritten.

## 7. Lifecycle (intentionally minimal)

- Newly discovered job → `is_active = true`, `first_seen_at = last_seen_at = NOW()`.
- Re-observed job → stays active, `last_seen_at` refreshed.
- Disappearance/expiration handling is deferred to Phase 6 (scheduled
  ingestion), when "not seen for N runs → inactive" can be defined properly.

## 8. Ingestion runs

Every execution writes one `ingestion_runs` row: `source`, `status`
(`running` → `completed` | `partial` | `failed`), `started_at/finished_at`,
and `fetched/accepted/rejected/inserted/updated/duplicate/error` counters plus
`error_message` (first error). Status rule: `failed` = fetch failed or no
progress with errors; `partial` = errors with progress; else `completed`.
(Rows rejected by validation alone do not make a run partial/failed.)

## 9. Database

Migration `database/migrations/002_phase3_ingestion_foundation.sql`:

- `external_job_sources` — `UNIQUE(source)`; seeds the `fixture` source.
- `ingestion_runs` — `ingestion_run_status` enum + `(source, started_at)` index.
- `raw_external_jobs` — `UNIQUE(source, source_job_id, ingestion_run_id)` +
  indexes on `(source, source_job_id)` and `ingestion_run_id`.
- `external_jobs` — `UNIQUE(source, source_job_id)`,
  `UNIQUE(canonical_url)`, indexes on `source`, `content_fingerprint`,
  `is_active`, `last_seen_at`. External jobs are deliberately separate from
  the recruiter `jobs` table (different domains).

Migrations only — no DDL at application startup.

## 10. How to run fixture ingestion

```bash
cd services/job
node ../../database/scripts/migrate.mjs up   # from repo root: node database/scripts/migrate.mjs up
npm run ingest:fixture
```

Expected first run (deterministic fixture: 16 fetched, 3 malformed, 3 in-batch
duplicates → 10 unique):

```text
JobiFy Ingestion
Source: fixture

Fetched:   16
Accepted:  13
Rejected:   3
Inserted:  10
Updated:    0
Duplicates: 3
Errors:     0

Status: completed
```

Second run: `Inserted: 0, Updated: 10` (idempotent). Logs are structured JSON
(`source`, `ingestionRunId`, counters, `durationMs`, `status`); no secrets or
PII beyond job-posting content are logged.

## 11. How to add a new source (example: Lever, Phase 4)

> Lever is now implemented — see
> `docs/architecture/PHASE-4-LEVER-INGESTION.md`. The sketch below is kept
> for historical reference as the "how to add a source" example.

```ts
// services/job/src/ingestion/sources/leverAdapter.ts
import type { JobSourceAdapter } from "../adapter.js";
import type { RawExternalJob } from "../types.js";

export class LeverAdapter implements JobSourceAdapter {
  readonly source = "lever";
  constructor(private readonly company: string) {}
  async fetchJobs(): Promise<RawExternalJob[]> {
    // Call Lever's official public postings API for `this.company`,
    // map each posting to RawExternalJob (keep the posting as rawPayload).
    // Respect Lever's terms: official API only, no scraping workarounds.
    throw new Error("Phase 4: not implemented yet.");
  }
}

// services/job/src/ingestion/sources/index.ts
sourceRegistry.register({
  source: "lever",
  displayName: "Lever",
  enabled: true,
  sourceType: "api",
  baseUrl: "https://api.lever.co",
  policyUrl: "https://www.lever.co/privacy/",
  createAdapter: () => new LeverAdapter(process.env.LEVER_COMPANY ?? ""),
});
```

Then: seed an `external_job_sources` row via a migration, add
`npm run ingest:lever`, and reuse `runIngestion()` unchanged.

## 12. Source policy (mandatory)

Only sources with legitimate access are supported: official public APIs,
public ATS APIs, public feeds, permitted public job pages. Adapters must
follow the source's terms/policies. Explicitly forbidden: CAPTCHA/login/
anti-bot/paywall bypass, robots/policy evasion, stealth browser automation,
proxy rotation for evasion, credential harvesting.

## 13. Read API + frontend

- `GET /api/job/external?title=&location=&source=&limit=&offset=` →
  normalized external jobs (served by the job service, routed through the
  existing Gateway `/api/job/*` proxy — no gateway change needed).
- `GET /api/job/external/:id` → single job or 404. Invalid input → 400 via
  the existing error envelope; observability middleware unchanged.
- Frontend: `api.jobs.getExternal()` in the centralized client
  (`frontend/src/lib/api.ts`) + a minimal dev page at
  `/external-jobs` (`frontend/src/app/external-jobs/page.tsx`). The full
  discovery UI is out of scope for Phase 3.

## 14. Performance notes

Indexes on all hot paths; 3 batched existence SELECTs instead of N+1;
parameterized SQL everywhere; fixture-scale batches held in memory (a
COPY/bulk path can be added if batch sizes grow). No Elasticsearch —
PostgreSQL remains the source of truth.

## 15. Phase boundary

Implemented: everything above. NOT implemented (later phases): live Lever /
Greenhouse / Ashby ingestion, scheduling/cron, retry queues, source health
monitoring, advanced search, ranking/recommendations, resume matching,
embeddings, AI scoring, application agent, auto-apply, notifications.

> Lever landed in Phase 4 (`PHASE-4-LEVER-INGESTION.md`); Greenhouse and
> Ashby landed in Phase 5 (`PHASE-5-MULTI-SOURCE-INGESTION.md`).
