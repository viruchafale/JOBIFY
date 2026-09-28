# JobiFy 2.0 — Phase 5: Multi-Source Ingestion (Greenhouse + Ashby)

Adds two more legitimate public job sources — Greenhouse and Ashby — onto
the unchanged Phase 3/4 pipeline. No pipeline redesign: two new adapters,
two registry entries, one migration, two commands.

```text
                    JobSourceAdapter
                          │
          ┌───────────────┼───────────────┬───────────────┐
          ▼               ▼               ▼               ▼
       Fixture         Lever         Greenhouse          Ashby
          │               │               │               │
          └───────────────┴───────────────┴───────────────┘
                          ▼
                    runIngestion()  (unchanged since Phase 3)
                          │
              normalize → validate → dedupe → persist
```

## 1. Greenhouse adapter

`services/job/src/ingestion/sources/greenhouseAdapter.ts` implements
`JobSourceAdapter`, mirroring Lever's structure exactly (per-company fetch,
`getLastFetchErrors()` for isolation — see Phase 4 doc).

### API

Greenhouse's official public **Job Board API**
(https://developers.greenhouse.io/job-board.html, no auth):

```text
GET https://boards-api.greenhouse.io/v1/boards/<board-token>/jobs?content=true
```

`content=true` returns full job HTML content for every job in the board in
**one** request — no per-job detail request is needed (avoids N+1 HTTP
calls). Response shape: `{ jobs: [...], meta: {...} }`.

### Configuration

```env
# services/job/.env
GREENHOUSE_COMPANIES=gitlab,some-other-company:Some Other Company
```

Parsed by `parseGreenhouseCompanies()`. The optional `slug:Display Name`
suffix is a fallback only — see "Company name" below.

### Response mapping

| Greenhouse field | RawExternalJob field | Notes |
| :--- | :--- | :--- |
| `id` | `sourceJobId` | Stringified; never generated |
| `title` | `title` | |
| `content` (HTML, entity-escaped) | `description` | See "Content field" below |
| `absolute_url` | `sourceUrl` **and** `applyUrl` | Greenhouse's job page already contains the apply form — no separate apply URL exists in the public API |
| `location.name` (fallback: `offices[].name` joined) | `location` | See "Location" below |
| `departments[0].name` | `role` | |
| `company_name` | `companyName` | Falls back to configured display name, then the slug — see "Company name" |
| `first_published` (fallback `updated_at`) | `postedAt` | |
| whole job object | `rawPayload` | Preserved verbatim |
| — | `jobType` | Always `null` — no dedicated field in the public API |
| — | `workLocation` | Always `null` — no reliable structured indicator; not inferred from free text (deterministic ingestion, no guessing) |
| — | `salaryMin`/`salaryMax`/`salaryCurrency` | Always `null` — no compensation field in the public Job Board API |

#### Content field (entity-escaping quirk)

Greenhouse's `content` field is HTML that has been **entity-escaped once**
for JSON transport — the string literally contains `&lt;div&gt;` instead of
`<div>`. `unescapeGreenhouseContent()` in the adapter reverses only that one
transport-level escaping so the result is ordinary HTML, e.g.
`<div class="content-intro">...`. This is **not** generic HTML cleanup —
Phase 3's `normalize.ts` (`stripHtml`) still does the actual
HTML-to-plain-text pass. Without this un-escape step, `stripHtml`'s
tag-stripping regex would never match (there are no literal `<` characters),
and its entity-decode pass would print literal `<div>` text into the stored
plain-text description. Verified against a live GitLab posting.

#### Location

Greenhouse's `location.name` is already the board's own canonical,
deterministic single-string representation of a posting's location,
including multi-location postings (e.g. `"Remote, Canada; Remote, United
Kingdom; Remote, United States"`, observed live on a real GitLab posting).
When absent, the adapter falls back to joining `offices[].name` with `", "`
in Greenhouse's own returned order — no reordering, no inference.

#### Company name

1. Greenhouse's `company_name` field (present on essentially all real boards
   observed, e.g. `"GitLab"`) — authoritative, source-provided.
2. Otherwise the configured `slug:Display Name`.
3. Otherwise the bare slug.

### Error handling

Same shape as Lever: HTTP 4xx/5xx (with status code in the message), 404 →
"unknown board", 429 → "rate limited", timeout, DNS/network failure,
malformed response (`jobs` not an array), empty `jobs` array handled
normally, invalid (empty-slug) company config. See `greenhouseAdapter.test.ts`.

## 2. Ashby adapter

`services/job/src/ingestion/sources/ashbyAdapter.ts` implements
`JobSourceAdapter`, same shape as Lever/Greenhouse.

### API

Ashby's official public **Job Postings API**
(https://developers.ashbyhq.com/reference/jobpostingapi, no auth):

```text
GET https://api.ashbyhq.com/posting-api/job-board/<board-name>?includeCompensation=true
```

`includeCompensation=true` is a documented public query parameter that adds
a `compensation.summaryComponents[]` array to each posting when the
organization has opted into Ashby's comp-transparency feature. Response
shape: `{ jobs: [...], apiVersion: "..." }`.

### Configuration

```env
# services/job/.env
ASHBY_COMPANIES=zapier,some-other-company:Some Other Company
```

Parsed by `parseAshbyCompanies()`.

### Response mapping

| Ashby field | RawExternalJob field | Notes |
| :--- | :--- | :--- |
| `id` | `sourceJobId` | Never generated |
| `title` | `title` | |
| `descriptionHtml` | `description` | Real HTML, not entity-escaped (unlike Greenhouse) — passed through as-is for `normalize.ts` to strip |
| `jobUrl` | `sourceUrl` | |
| `applyUrl` (fallback `jobUrl`) | `applyUrl` | Ashby provides a genuinely distinct apply URL |
| `location` | `location` | Free-text string Ashby already provides (e.g. `"NAMER"`, `"San Francisco, CA"`) |
| `employmentType` | `jobType` | e.g. `"FullTime"` → normalize.ts's `JOB_TYPE_MAP` matches it case-insensitively to `"Full-time"` |
| `workplaceType` | `workLocation` | e.g. `"Remote"`/`"Hybrid"`/`"OnSite"` → matches `WORK_LOCATION_MAP` |
| `department` (fallback `team`) | `role` | |
| `compensation.summaryComponents[]` (`compensationType: "Salary"`) | `salaryMin`/`salaryMax`/`salaryCurrency` | Only present when the org opted in; `null` otherwise — see "Compensation" |
| `publishedAt` | `postedAt` | |
| whole posting object | `rawPayload` | Preserved verbatim |
| — | `companyName` | Ashby's public API never returns an organization display name anywhere — always from configuration (slug or `slug:Display Name`), like Lever |

#### Compensation

`resolveSalaryComponent()` scans `compensation.summaryComponents[]` for the
entry with `compensationType === "Salary"` and a numeric `minValue`/
`maxValue`; other component types (`Bonus`, `EquityPercentage`, ...) are
ignored for salary purposes. Verified live: Zapier's public board exposes
real salary ranges in both USD and INR across different postings; boards
without comp transparency (verified live: Notion, Linear, Watershed) return
an empty `summaryComponents` array, and the adapter correctly stores `null`.

### Error handling

Same shape as Lever/Greenhouse: HTTP 4xx/5xx, 404 → "unknown job board", 429
→ "rate limited", timeout, DNS/network failure, malformed response, empty
`jobs` array, invalid (empty-slug) config. Ashby's 404 body is plain text
(`"Not Found"`, not JSON) — the adapter checks `response.status` before ever
touching the response body shape, so this doesn't cause a parse error.

## 3. Source registry

`services/job/src/ingestion/sources/index.ts` now registers four sources:

```text
fixture     (local, no network)
lever       (Phase 4)
greenhouse  (Phase 5)
ashby       (Phase 5)
```

Same `SourceDefinition` shape for all four — `source`, `displayName`,
`enabled`, `sourceType`, `baseUrl`, `policyUrl`, `createAdapter`.

## 4. Database

`database/migrations/004_phase5_greenhouse_ashby_sources.sql` seeds
`greenhouse` and `ashby` into the existing `external_job_sources` table
(`ON CONFLICT (source) DO NOTHING`). No schema changes. Greenhouse/Ashby
jobs live in the same `external_jobs` / `raw_external_jobs` /
`ingestion_runs` tables as Lever and fixture.

## 5. Commands

```bash
npm run ingest:greenhouse
npm run ingest:ashby
```

Both call `runIngestion()` — the exact function used by `ingest:fixture` and
`ingest:lever`. No second pipeline exists.

## 6. Idempotency (verified live)

Both sources were run twice against real public boards with a local
PostgreSQL instance:

| Source | Run 1 | Run 2 |
| :--- | :--- | :--- |
| Greenhouse (`gitlab`) | Fetched 205, Inserted 205 | Fetched 205, Inserted 0, Updated 205 |
| Ashby (`zapier`) | Fetched 9, Inserted 9 | Fetched 9, Inserted 0, Updated 9 |

`first_seen_at` was unchanged across both runs for sampled rows;
`last_seen_at` advanced. `external_jobs` row counts did not change between
runs (205 / 9 respectively) — no duplicates.

## 7. Cross-source duplicates (explicit limitation)

If the same company publishes the same job on two different ATS platforms
(e.g. a Lever posting and a Greenhouse posting with an identical title,
description and location), Phase 5 does **not** merge them. The Phase 3
dedupe hierarchy (`source+sourceJobId` → canonical URL → SHA-256 content
fingerprint) only matches within what it's given — Level 1 always differs
across sources (different `source` value), Level 2 differs (each ATS hosts
its own URL), and Level 3 (fingerprint) *could* coincidentally match if the
company copy-pasted identical title/description/location text into both
platforms, in which case the second one ingested would be treated as an
**update to the first row**, silently attributing it to whichever `source`
ingested first. This is the existing Phase 3 fingerprint semantics working
exactly as designed for *exact* duplicates — it is not fuzzy or
AI-based, and it is not cross-source-aware. No new logic was added to
detect or prevent this in Phase 5, per the explicit Phase 5 scope
boundary. In practice, exact-text collisions across independently-run ATS
boards are rare (different companies word the same posting slightly
differently on each platform), but it is not architecturally impossible.
Deliberately deferred; a future phase could add an explicit
`(source, canonical company id)`-aware identity layer if this proves to
matter in practice — no such layer exists today.

## 8. Testing

- `greenhouseAdapter.test.ts` — 17 tests: mapping (incl. the content
  unescape quirk and location fallback), multiple postings, empty response,
  malformed response, HTTP 400/404/429/500, timeout, DNS failure,
  multi-company isolation, total failure, invalid config,
  `parseGreenhouseCompanies()`.
- `ashbyAdapter.test.ts` — 19 tests: mapping (incl. compensation present/
  absent, applyUrl/role fallbacks), multiple postings, empty response,
  malformed response, HTTP 400/404/429/500, timeout, DNS failure,
  multi-company isolation, total failure, invalid config,
  `parseAshbyCompanies()`.
- `fixture.test.ts` (registry tests) extended to assert all four sources
  (`fixture`, `lever`, `greenhouse`, `ashby`) are registered and that a
  genuinely unknown source (`unknown-source`) is still rejected.

All unit tests mock `axios` — no live network access required for
`npm test`. Live verification (real API + local Postgres) is described in
the Phase 5 implementation report.

## 9. Source policy

Both adapters use only the official public API for their platform — no
scraping, no credential harvesting, no CAPTCHA/rate-limit/anti-bot bypass.
Where a field isn't available (Greenhouse job type/work location/salary;
Ashby company display name), the adapter stores `null` rather than
inventing or inferring a value from unstructured text.

## 10. Adding a future source

1. Implement `JobSourceAdapter` in `sources/<name>Adapter.ts` — fetch + shape
   only, following the Lever/Greenhouse/Ashby pattern (per-company fetch,
   `getLastFetchErrors()` for isolation if multi-tenant).
2. Register it in `sources/index.ts`.
3. Seed its `external_job_sources` row via a new migration.
4. Add `npm run ingest:<name>` calling the same `runIngestion()`.

`normalize.ts`, `validate.ts`, `dedupe.ts`, `repository.ts` and `runner.ts`
required no changes for Greenhouse or Ashby, and shouldn't for a future
source either unless a genuinely common rule is missing.

## 11. Phase boundary

Implemented: Greenhouse adapter, Ashby adapter, `GREENHOUSE_COMPANIES` /
`ASHBY_COMPANIES` config, registry entries, `npm run ingest:greenhouse` /
`npm run ingest:ashby`, unit tests, migration seed, live verification against
real public boards, idempotency verification.

NOT implemented (later phases): scheduling, cron, automated periodic
ingestion, retry queues, source health dashboard, advanced search, ranking,
recommendations, resume matching, candidate intelligence, embeddings, AI
scoring, notifications, auto-apply, application agent, personal job agent.
Cross-source duplicate merging was also explicitly deferred (see §7).

See also: `docs/architecture/PHASE-3-INGESTION-FOUNDATION.md` (pipeline) and
`docs/architecture/PHASE-4-LEVER-INGESTION.md` (Lever, the first live
source, and the `getLastFetchErrors()` mechanism this phase reuses).
