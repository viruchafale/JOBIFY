# JobiFy 2.0 — Phase 4: Live Lever Ingestion

Connects the Phase 3 source-agnostic ingestion engine (`services/job/src/ingestion/`)
to Lever's official public Postings API. The pipeline itself
(`adapter -> raw -> normalize -> validate -> dedupe -> persist`) is
**unchanged** — only a new source adapter was added.

## 1. Lever adapter

`services/job/src/ingestion/sources/leverAdapter.ts` implements the existing
`JobSourceAdapter` contract:

```ts
export class LeverAdapter implements JobSourceAdapter {
  readonly source = "lever";
  async fetchJobs(): Promise<RawExternalJob[]> { ... }
  getLastFetchErrors(): string[] { ... } // see "Multi-company error isolation" below
}
```

Responsibility is strictly `HTTP request -> Lever response -> RawExternalJob[]`.
It does **not** touch PostgreSQL, normalize, deduplicate, or create ingestion
runs — all of that remains in `runner.ts` / `repository.ts` / `normalize.ts` /
`dedupe.ts`, unmodified.

### Endpoint

Lever's official public Postings API (no authentication required, no
scraping, no anti-bot bypass):

```text
GET https://api.lever.co/v0/postings/<company-slug>?mode=json
```

Documented at https://github.com/lever/postings-api. This is the only
network call the adapter makes.

### Company configuration

```env
# services/job/.env — comma-separated Lever company slugs.
# Optional display name per slug ("slug:Display Name") because Lever's
# public API does not return a company display name in the posting payload.
LEVER_COMPANIES=palantir,some-other-company:Some Other Company
```

Parsed by `parseLeverCompanies()` in `leverAdapter.ts`. No API keys are
required or invented — the public postings endpoint needs none.

### Response mapping

| Lever field | RawExternalJob field | Notes |
| :--- | :--- | :--- |
| `id` | `sourceJobId` | Never generated; empty ⇒ rejected by validation, not fabricated |
| `text` | `title` | |
| `description` (HTML) | `description` | Left as HTML — Phase 3 `normalize.ts` strips it |
| `hostedUrl` | `sourceUrl` | |
| `applyUrl` (falls back to `hostedUrl`) | `applyUrl` | |
| `categories.location` | `location` | |
| `categories.commitment` | `jobType` | e.g. `"Full-time"` — matches Phase 3's `JOB_TYPE_MAP` |
| `workplaceType` | `workLocation` | e.g. `"remote"`/`"hybrid"`/`"on-site"` — matches `WORK_LOCATION_MAP` |
| `categories.department` \|\| `categories.team` | `role` | |
| `salaryRange.{min,max,currency}` | `salaryMin`/`salaryMax`/`salaryCurrency` | Only when the company has opted in to comp transparency; otherwise `null` — never invented |
| `createdAt` (epoch ms) | `postedAt` | Converted to ISO-8601 |
| whole posting object | `rawPayload` | Preserved verbatim, unmodified |
| (configured slug) | `companyName` | Lever does not return a display name; comes from `LEVER_COMPANIES` config, defaulting to the slug |

Any field Lever doesn't provide is mapped to `null` — never fabricated.

### Multi-company error isolation

`LeverAdapter.fetchJobs()` fetches each configured company independently. A
single company's HTTP/network/parsing failure does not discard the other
companies' successfully-fetched jobs — it's recorded and returned via the
adapter's `getLastFetchErrors()`.

To let the runner still *report* that failure (without redesigning the
runner's per-record error model), `JobSourceAdapter` gained one **optional**
method:

```ts
interface JobSourceAdapter {
  readonly source: string;
  fetchJobs(): Promise<RawExternalJob[]>;
  getLastFetchErrors?(): string[]; // NEW, optional, source-agnostic
}
```

`runner.ts` calls it once, right after `fetchJobs()` resolves, and folds any
messages into the run's `errorCount`/`errorMessage` exactly like a per-record
failure would. `FixtureJobSource` doesn't implement it and is unaffected.
Verified against the real API (`LEVER_COMPANIES=palantir,does-not-exist`):

```text
Fetched: 312, Updated: 312, Errors: 1, Status: partial
errorMessage: lever_company_fetch_failed[company=does-not-exist]: unknown Lever company "does-not-exist" (HTTP 404)
```

Palantir's 312 postings were **not** discarded by the other company's 404.

If *every* configured company fails, `fetchJobs()` throws (same as any other
adapter's total fetch failure) and the run is marked `failed`.

### Error handling

| Case | Behavior |
| :--- | :--- |
| HTTP 4xx (400/404/429) | Specific error message incl. status code; company skipped |
| HTTP 5xx | Specific error message incl. status code; company skipped |
| Timeout (10s default) | `"request timed out after 10000ms"` |
| DNS/network failure | Underlying error message propagated |
| Malformed response (non-array) | `"malformed response: expected a JSON array of postings"` |
| Empty response (`[]`) | Handled normally — zero jobs for that company, not an error |
| Empty/invalid company slug | `"invalid company configuration (empty slug)"` |
| No companies configured | `fetchJobs()` throws immediately, before any HTTP request |

No infinite retries, no uncontrolled concurrency (one sequential request per
configured company), no secrets in logs (the public API needs none).

## 2. Source registry

Registered in `services/job/src/ingestion/sources/index.ts` alongside
`fixture`:

```ts
sourceRegistry.register({
  source: "lever",
  displayName: "Lever",
  enabled: true,
  sourceType: "api",
  baseUrl: "https://api.lever.co/v0/postings",
  policyUrl: "https://www.lever.co/privacy/",
  createAdapter: () =>
    new LeverAdapter({ companies: parseLeverCompanies(process.env.LEVER_COMPANIES) }),
});
```

## 3. Database

No schema redesign. `database/migrations/003_phase4_lever_source.sql` seeds
one row into the Phase 3 `external_job_sources` table:

```sql
INSERT INTO external_job_sources (source, display_name, source_type, base_url, enabled, policy_url)
VALUES ('lever', 'Lever', 'api', 'https://api.lever.co/v0/postings', true, 'https://www.lever.co/privacy/')
ON CONFLICT (source) DO NOTHING;
```

Lever jobs live in the existing `external_jobs` / `raw_external_jobs` /
`ingestion_runs` tables — no new tables, no DDL at startup.

## 4. Running it

```bash
cd services/job
# .env: LEVER_COMPANIES=palantir   (or any real Lever company slug)
npm run ingest:lever
```

Reuses `runIngestion()` unchanged — identical architecture to
`npm run ingest:fixture`:

```text
npm run ingest:fixture     npm run ingest:lever
        │                          │
        └──────────► runIngestion() ◄──────────┘
```

### Example output (live run against Palantir's public Lever board, 2026-09-23)

First run:

```text
JobiFy Ingestion
Source: lever

Fetched:   312
Accepted:  312
Rejected:  0
Inserted:  312
Updated:   0
Duplicates: 0
Errors:    0

Status: completed
```

Second run (idempotency): `Inserted: 0, Updated: 312, Duplicates: 0`.
`first_seen_at` on every row was unchanged; `last_seen_at` advanced.

## 5. Testing strategy

`services/job/src/ingestion/sources/leverAdapter.test.ts` — no network access;
`axios` is mocked. Covers: successful mapping (all fields incl. `rawPayload`),
missing optional fields (applyUrl/company-name fallback, null salary),
multiple postings, empty postings array, malformed (non-array) response,
HTTP 400/404/429/500, timeout, DNS/network failure, multi-company isolation
(one failing company doesn't drop another's jobs, error is still reported),
total failure (every company fails ⇒ throw), and invalid (empty-slug) company
config. `parseLeverCompanies()` is unit tested directly.

`services/job/src/ingestion/fixture.test.ts` was updated: the "rejects
unknown sources" test used `"lever"` as its unknown-source example, which
stopped being true once Lever became a real registered source — it now uses
`"greenhouse"` (still genuinely unregistered) and a new test asserts the
registry knows `"lever"`.

Real-network verification performed manually (not part of `npm test`):
`curl https://api.lever.co/v0/postings/palantir?mode=json` and a full
`runIngestion()` run against a local Postgres, described in the Phase 4
implementation report.

## 6. Source policy

Only Lever's official public Postings API is used — no scraping, no
credential harvesting, no CAPTCHA/rate-limit/anti-bot bypass. If the API
can't provide a field (e.g. `salaryRange` when a company hasn't opted in),
the adapter stores `null` rather than inventing a value.

## 7. Troubleshooting

| Symptom | Likely cause |
| :--- | :--- |
| `LeverAdapter: no companies configured` | `LEVER_COMPANIES` unset/empty in `.env` |
| `unknown Lever company "X" (HTTP 404)` | Typo'd slug, or the company doesn't have a public Lever postings page |
| `rate limited by Lever's public API (HTTP 429)` | Too many companies/requests in a short window — Lever's public API has generous but non-zero limits; back off, don't add retries/proxies |
| Run marked `partial` | One or more configured companies failed while others succeeded — check `errorMessage` on the `ingestion_runs` row for which company and why |
| `malformed response: expected a JSON array of postings` | Lever changed their response shape, or the company slug resolves to a non-postings page |

## 8. Adding another source (e.g. Greenhouse, later)

1. Implement `JobSourceAdapter` in `sources/greenhouseAdapter.ts` — fetch +
   shape only, exactly like `leverAdapter.ts`.
2. Register it in `sources/index.ts`.
3. Seed its `external_job_sources` row via a new migration.
4. Add `npm run ingest:greenhouse` calling the same `runIngestion()`.

No change to `normalize.ts`, `validate.ts`, `dedupe.ts`, `repository.ts`, or
`runner.ts` is ever required to add a source.

## 9. Phase boundary

> Greenhouse and Ashby are now implemented — see
> `docs/architecture/PHASE-5-MULTI-SOURCE-INGESTION.md`.


Implemented: Lever adapter, `LEVER_COMPANIES` config, source registry entry,
`npm run ingest:lever`, unit tests, migration seed, live verification.

NOT implemented (later phases, out of scope for Phase 4): Greenhouse, Ashby,
LinkedIn/Indeed/Naukri scraping, scheduling/cron, retry queues, source health
dashboard, advanced search, ranking/recommendations, resume matching,
embeddings, AI scoring, notifications, auto-apply, personal job agent.
