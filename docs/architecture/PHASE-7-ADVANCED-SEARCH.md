# JobiFy 2.0 — Phase 7: Advanced Search

PostgreSQL-native full-text + structured search over `external_jobs`. No
Elasticsearch/OpenSearch/vector DB/embeddings/AI ranking — deterministic,
explainable relevance via `websearch_to_tsquery()` + `ts_rank()`.

For the full API/query-parameter/semantics reference, see
**`docs/search.md`**. This document covers what changed and why, at the
phase level.

## What changed

- **New**: `services/job/src/ingestion/search.ts` — `parseExternalJobSearchParams()`
  (validation) + `searchExternalJobs()` (query construction: WHERE/ORDER BY/
  pagination/count). Pure, unit-tested, no coupling to Express.
- **New**: `GET /api/job/external/search` (`searchExternalJobsHandler` in
  `controller/externalJobs.ts`), registered in `routes/job.ts` **above**
  `/external/:id` (Express route ordering — `/external/search` would
  otherwise be swallowed by the `:id` param route).
- **New**: `searchLimit` rate limiter (`middleware/rateLimit.ts`) — same
  `express-rate-limit`/Redis pattern as every other limiter, 120 req/min/IP.
- **New**: `database/migrations/006_phase7_advanced_search.sql` — a
  generated/stored `search_vector` tsvector column + GIN index, plus a
  handful of B-tree/composite/partial indexes for structured filters.
- **New**: `frontend/src/app/external-jobs/page.tsx` rewritten into a full
  search UI (was a Phase 3 dev-verification stub).
- **Unchanged**: `GET /api/job/external`, `GET /api/job/external/:id`,
  `repository.ts`'s `listExternalJobs()`/`parseExternalJobFilters()`, the
  entire Phase 3–6 ingestion pipeline, the Gateway (no routing change
  needed — `/api/job/*` was already proxied wholesale).

## Why a separate endpoint, not extending `/external`

`/external`'s existing filters (`title`, `location`, `source`, `limit`,
`offset`) are a strict subset of what Phase 7 needed, but the *pagination
shape* (`limit`/`offset`, bare array response) and *semantics* (no active
default, no FTS) are different enough that extending it in place would have
either broken existing clients or produced an inconsistent, half-migrated
API. A new endpoint keeps `/external` byte-for-byte compatible (verified:
its existing tests are untouched and still pass) while giving search its
own, cleaner contract (`{data:{items,pagination}}`).

## Database

Single migration, additive only: `search_vector` (generated column, so
existing rows became searchable the instant the migration ran — no separate
backfill script) + 6 new indexes on `external_jobs`. No other Phase 3–6
table touched.

## Verification summary

All against a real local Postgres populated with 699 jobs from real fixture/
Lever/Greenhouse/Ashby ingestion (not synthetic fixtures) unless noted:

- Migration applies cleanly on top of 000–005; generated column backfilled
  all 699 pre-existing rows automatically; a subsequent idempotent ingestion
  re-run confirmed new/updated rows also get a vector automatically.
- `EXPLAIN ANALYZE` on 8 representative query shapes — all under 10ms;
  index validity confirmed by forcing their use.
- Keyword search, every structured filter (location/company/source/jobType/
  workLocation/role/salary/postedAfter/postedBefore/active), combined
  AND-semantics, every sort mode, and paginated no-overlap consistency all
  verified against real data.
- Salary interval-overlap semantics verified against synthetic salary bands
  with known expected matches.
- SQL-injection-style, XSS-style, raw-tsquery-operator, and unicode payloads
  verified safe (zero DB errors, table intact) against real Postgres.
- Frontend: production build (`next build`) succeeds; TypeScript passes;
  server-rendered HTML confirmed to reflect URL query params in both text
  inputs and `<select>` elements (URL-state round-trip), via a local server
  that reuses the actual `search.ts`/`repository.ts` code against real
  Postgres (full interactive browser click-through wasn't possible — no
  browser-automation tool in this sandbox; see `docs/search.md`'s Known
  Limitations).

## Phase boundary

Implemented: PostgreSQL FTS, structured filters, sorting, pagination, rate
limiting, security hardening, indexes, migration, tests, frontend search UI
with URL state.

NOT implemented (later phases): AI matching, embeddings, semantic/vector
search, resume matching, candidate scoring, recommendations, career
intelligence, notifications, auto-apply, personal agent, fuzzy cross-source
deduplication, cross-source job merging, Elasticsearch/OpenSearch/any
external search infrastructure.
