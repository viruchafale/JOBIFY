# JobiFy External Job Search (Phase 7)

Deterministic, explainable search over `external_jobs` using PostgreSQL
full-text search — no Elasticsearch, no vector DB, no embeddings, no AI
ranking. See `docs/architecture/PHASE-7-ADVANCED-SEARCH.md` for the full
implementation report; this document is the day-to-day API/usage reference.

## Architecture

```text
                    User
                     │
                     ▼
       Search UI (frontend/src/app/external-jobs/page.tsx)
                     │
                     ▼
              API Gateway (:5000, unchanged — /api/job/* already proxied)
                     │
                     ▼
     GET /api/job/external/search  (services/job/src/controller/externalJobs.ts)
                     │
                     ▼
   parseExternalJobSearchParams()  +  searchExternalJobs()
        (services/job/src/ingestion/search.ts)
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
 PostgreSQL Full-Text       Structured SQL
 (search_vector @@          (source, job_type, work_location,
  websearch_to_tsquery)      location/company/role ILIKE,
                              salary range, posted_at range,
                              is_active)
          └──────────┬──────────┘
                     ▼
                external_jobs
                     │
                     ▼
     ts_rank() / posted_at / salary  →  Ranked, paginated results
```

This is a **new, additive** endpoint. `GET /api/job/external` (Phase 3) and
`GET /api/job/external/:id` are completely unchanged — existing clients keep
working exactly as before.

## API endpoint

```http
GET /api/job/external/search
```

### Examples

```http
GET /api/job/external/search?q=backend+engineer
GET /api/job/external/search?q=machine+learning&location=India
GET /api/job/external/search?workLocation=remote&source=lever
GET /api/job/external/search?q=golang&sort=relevance&page=2&limit=20
```

### Response

```json
{
  "data": {
    "items": [
      {
        "id": 521,
        "source": "greenhouse",
        "canonical_url": "https://job-boards.greenhouse.io/gitlab/jobs/8781299002",
        "apply_url": "https://job-boards.greenhouse.io/gitlab/jobs/8781299002",
        "company_name": "GitLab",
        "title": "Staff Software Engineer - NLP",
        "description": "...",
        "location": "Bangalore, India",
        "job_type": null,
        "work_location": null,
        "role": "Architecture Engineering",
        "salary_min": null,
        "salary_max": null,
        "salary_currency": null,
        "posted_at": "2026-09-24T06:04:48.000Z",
        "last_seen_at": "2026-09-24T09:22:49.690Z",
        "is_active": true
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 27, "totalPages": 2 }
  }
}
```

Deliberately **not** exposed (unlike the older bare `/external` endpoint):
`source_job_id`, `first_seen_at`, `content_fingerprint` — internal ingestion
bookkeeping, not job-facing data. No `rank`/relevance score is returned
either — PostgreSQL's `ts_rank()` is used internally to order results, not
surfaced as an API field the frontend has no use for.

## Query parameters

| Param | Type | Notes |
| :--- | :--- | :--- |
| `q` | string, ≤200 chars | Full-text query via `websearch_to_tsquery('english', ...)`. Whitespace-only is treated as no query. |
| `location` | string, ≤200 chars | Case-insensitive substring match (`ILIKE '%...%'`) |
| `company` | string, ≤200 chars | Case-insensitive substring match on `company_name` |
| `role` | string, ≤200 chars | Case-insensitive substring match |
| `source` | comma-separated list | Must be registered sources (`lever`, `greenhouse`, `ashby`, ...); `fixture` is valid here (unlike scheduling) but returns only local test data |
| `jobType` | string | Normalized via the same `normalizeJobType()` used at ingestion time (e.g. `full-time` → `Full-time`); an unrecognized value is a 400 |
| `workLocation` | string | Normalized via `normalizeWorkLocation()` the same way (e.g. `remote` → `Remote`) |
| `minSalary` / `maxSalary` | non-negative number | See "Salary semantics" below |
| `postedAfter` / `postedBefore` | ISO-8601 date | Compared against `posted_at` (not `created_at`/`first_seen_at`) |
| `active` | `"true"` \| `"false"` | Default `true` |
| `page` | integer ≥ 1 | Default 1 |
| `limit` | integer 1–100 | Default 20 |
| `sort` | `relevance` \| `newest` \| `oldest` \| `salary_high` \| `salary_low` | Default: `relevance` if `q` given, else `newest` |

All parameters are validated; an invalid value returns `400` with a
specific message (project's existing `{ message }` error shape via
`ErrorHandler`/`TryCatch` — the same convention `/external` already uses).

## Filter semantics

**AND, always.** Every supplied filter narrows the result set — there is no
OR across unrelated filters. `q=backend engineer&location=India&source=lever`
means *search AND location AND source*, all three required.

**NULL principle** (applied consistently to every nullable-column filter):
a filter that needs a specific known value on a nullable column **excludes**
rows where that column is unknown. No filter means no exclusion. This
applies to `minSalary`/`maxSalary` (vs. `salary_min`/`salary_max`) and
`postedAfter`/`postedBefore` (vs. `posted_at`) identically — a job with no
salary data or no posted date is simply not considered when that specific
filter is active, but still appears in unfiltered/other-filtered results.

**Salary semantics (interval overlap, not both-bounds-within):**
`minSalary` is compared against the job's **`salary_max`** (the job's upper
bound must reach at least what you asked for); `maxSalary` is compared
against the job's **`salary_min`** (the job's lower bound must not exceed
what you're willing to pay). This is standard range-overlap filtering: a job
paying $90k–$120k *does* match `minSalary=100000` (its upper bound reaches
the requested minimum), even though its own minimum is below 100k. Verified
live against synthetic salary bands — see the implementation report.

**Active jobs default to visible, inactive jobs are opt-in.** `active`
unset or `true` → only `is_active = true`. `active=false` → only
**inactive** (historical, deactivated by Phase 6 stale-job detection) jobs —
a literal boolean-to-column mapping, not a third "show everything" mode.
Inactive jobs are never deleted; they're just excluded from the default
view.

**`fixture` is a valid `source` filter value** here (unlike Phase 6
scheduling, which explicitly forbids scheduling it) — it just returns the
local, deterministic test dataset if you ask for it.

## Sorting

| `sort` | ORDER BY |
| :--- | :--- |
| `relevance` | `ts_rank(search_vector, websearch_to_tsquery(...)) DESC, id DESC` |
| `newest` | `posted_at DESC NULLS LAST, id DESC` |
| `oldest` | `posted_at ASC NULLS LAST, id ASC` |
| `salary_high` | `salary_max DESC NULLS LAST, id DESC` |
| `salary_low` | `salary_min ASC NULLS LAST, id ASC` |

Every sort has a deterministic secondary key (`id`) so pagination never
produces duplicate or skipped rows when many jobs share a timestamp/salary —
verified live (page 1 + page 2 have zero overlapping ids).

`sort=relevance` with no `q` has no ranking basis, so it's resolved to
`newest` (documented fallback, not a validation error) at parse time.

## Full-text search (PostgreSQL FTS)

`search_vector` is a **`GENERATED ALWAYS ... STORED`** `tsvector` column on
`external_jobs` (migration `006_phase7_advanced_search.sql`), weighted:

```text
title              → A  (ranks highest)
role + company     → B
description + location → C
```

So a job titled *"Go Distributed Systems Engineer"* outranks one where
"distributed systems" only appears in the description — verified live: for
`q=engineer`, every one of the top 10 relevance-ranked results has
"engineer" literally in the title.

Being a **generated** column (not a plain column + a backfill script), it:
- computed itself for all 699 pre-existing rows automatically the moment
  the migration ran (verified — no row was left without a vector);
- computes itself for every row the unchanged Phase 3–6 ingestion pipeline
  inserts or updates, automatically, with zero adapter/normalization code
  changes.

Queries use `websearch_to_tsquery('english', $1)` — a parameterized
PostgreSQL function call, never string concatenation — which is also
deliberately permissive: unbalanced quotes, bare operators, or garbage input
never raise a syntax error, they just resolve to a (possibly empty, i.e.
zero-result) tsquery. Verified live with SQL-injection-style payloads
(`'; DROP TABLE external_jobs; --`, `<script>...`, unicode, raw tsquery
operator syntax) — all handled safely with zero DB errors, and the table
was, of course, never touched.

## Indexes (migration 006)

| Index | Why |
| :--- | :--- |
| `external_jobs_search_vector_idx` (GIN) | Standard index type for `tsvector` full-text search |
| `external_jobs_job_type_idx`, `external_jobs_work_location_idx` (B-tree) | These are small fixed vocabularies matched by exact equality *after* normalizing input the same way ingestion does — a plain B-tree is directly useful (unlike free-text ILIKE filters, see below) |
| `external_jobs_active_posted_at_idx` (composite, `is_active, posted_at DESC`) | Serves the single most common shape: "active jobs, newest first" (the default browse and the tail of most filtered browses) in one index scan |
| `external_jobs_salary_min_idx`, `external_jobs_salary_max_idx` (partial, `WHERE ... IS NOT NULL`) | Most jobs have no salary data (Greenhouse never exposes it; Lever/Ashby only when the poster opts in) — a partial index skips indexing rows that can never satisfy a salary filter/sort |

`external_jobs_source_idx` and `external_jobs_is_active_idx` already existed
from Phase 3 and are reused as-is.

**Free-text filters (`location`, `company`, `role`) use `ILIKE '%...%'` and
are NOT index-accelerated** — a plain B-tree can't serve an arbitrary
substring match. This is a known, accepted limitation at current scale (see
Performance below); PostgreSQL's `pg_trgm` trigram indexes are the natural
next step if this becomes a bottleneck, but weren't added in Phase 7 to
avoid introducing a new extension dependency before real usage justifies it.

## Performance (measured, not assumed)

`EXPLAIN ANALYZE` was run against a local Postgres populated with 699 real
ingested jobs (fixture + live Lever/Greenhouse/Ashby) for every
representative query shape (keyword search, location filter, source filter,
active-only browse, keyword+filters combined, paginated newest-sort,
`COUNT(*)`, exact job-type filter). All executed in under 10ms.

At this row count, PostgreSQL's planner correctly chose **sequential
scans** over the indexes for most queries — this is *correct*, not a
missing-index bug: with ~700 rows, a seq scan is genuinely cheaper than an
index scan (index overhead isn't worth it below the planner's cost
crossover point). Forcing index usage (`SET enable_seqscan = off`) confirmed
both the GIN `search_vector` index and the existing `source` B-tree index
are structurally valid and return identical result sets — they will be
automatically selected by the planner once the table is large enough for
that to be the cheaper plan.

**Count performance**: `total`/`totalPages` use a separate `COUNT(*)`
query sharing the exact same `WHERE` clause (not derived from fetching all
matching rows). This is standard practice and cheap at current scale; exact
`COUNT(*)` over arbitrary filters is inherently O(rows-matching-filter) and
will get slower as the dataset grows into the millions — a known, documented
limitation. If that ever becomes a real bottleneck, options include an
approximate count (`EXPLAIN`-based estimate), capping/omitting `total` for
very broad unfiltered queries, or a periodically-refreshed count cache — none
implemented here since there's no evidence yet that it's needed.

## Security

- Every filter is bound as a parameterized SQL value — **no string
  concatenation into SQL text**, anywhere.
- `q` uses `websearch_to_tsquery`, never `to_tsquery`/string-built tsquery
  syntax, specifically because it can't be coerced into a syntax error or
  unexpected query semantics by adversarial input.
- `q` and every free-text filter is capped at 200 characters — rejected with
  a 400 above that, before it ever reaches the database.
- `page`/`limit` are strictly bounded (`limit` 1–100) — a request can never
  force an unbounded table scan via pagination.
- `source`, `jobType`, `workLocation`, `sort` are all validated against
  fixed/known vocabularies — never passed through as arbitrary raw text.
- Verified live against a real Postgres instance with SQL-injection-style
  payloads, XSS-style payloads, raw tsquery operator syntax, and unicode —
  see the implementation report.

## Rate limiting

`searchLimit` in `services/job/src/middleware/rateLimit.ts` reuses the exact
same `express-rate-limit` + `rate-limit-redis` pattern as every other
limiter in the service (Phase 1's `applicationSubmissionLimit`/
`uploadLimit`) — no second rate-limiting system. Since search is public
(no `isAuth`) and expected to be far higher-volume than authenticated
write endpoints, it's keyed by IP rather than user id: **120 requests per
minute per IP**, generous for real interactive use (even without
debouncing) while still bounding scripted/abusive traffic.

## Frontend

`frontend/src/app/external-jobs/page.tsx` was rewritten into a full search
UI: search box, location/company/role text filters, source/job-type/
work-location/sort dropdowns, min/max salary, posted-after date, pagination,
result count, loading/empty/error states, and external apply/source links.

- **URL state**: every filter round-trips through the URL
  (`?q=backend&location=India&workLocation=remote&page=2`) via
  `next/navigation`'s `useSearchParams`/`useRouter` — no new state library.
  Verified: server-rendered HTML reflects URL params directly in both text
  inputs (`value="backend"`) and `<select>` (`selected` on the matching
  `<option>`), confirming refresh/bookmark/back-forward all work.
- **Debouncing**: free-text fields (`q`, `location`, `company`, `role`,
  salary, date) are debounced 400ms as a group before updating the URL/
  triggering a request. Dropdowns and pagination apply immediately — no
  "typing" concern for a `<select>`.

## Known limitations

- `location`/`company`/`role` substring filters aren't index-accelerated
  (see Indexes above) — fine at current scale, `pg_trgm` is the documented
  next step if needed.
- Exact `COUNT(*)` for pagination totals doesn't scale indefinitely (see
  Performance above).
- No semantic/fuzzy matching — a search for "js" won't match "JavaScript"
  unless PostgreSQL's English text-search dictionary already treats them as
  related (it doesn't). This is intentional for Phase 7 (deterministic,
  explainable search only).
- Cross-source duplicate jobs (same posting published on two different ATS
  platforms) are not merged — pre-existing Phase 5 limitation, unchanged.
- Full interactive browser verification (visual click-through) wasn't
  possible in this sandbox (no browser-automation tool available); instead,
  the exact HTTP contract was verified against a real local Postgres via a
  server reusing the actual production search code, and the rendered HTML
  (via `curl`) was confirmed to correctly reflect URL-driven filter state.
  See the implementation report for full detail.
