# JobiFy Job Intelligence (Phase 8)

Turns normalized job postings into structured, explainable, versioned
intelligence — skills, responsibilities, requirements, experience,
education, seniority — without candidate matching, embeddings, or any
personalization. See `docs/architecture/PHASE-8-JOB-INTELLIGENCE.md` for the
full implementation report; this document is the day-to-day reference.

## Design principle

```text
Raw Job (external_jobs — unchanged, source of truth)
   ↓
Deterministic Extraction   (skills taxonomy, regex, structured reuse)
   ↓
Semantic/AI Extraction     (ONLY for responsibilities/requirements/summary,
                             ONLY when deterministic extraction found nothing)
   ↓
Validation                 (strict schema on any AI output — see ai/schema.ts)
   ↓
Normalization              (canonical vocabularies — seniority/education/skills)
   ↓
Persistence                (job_intelligence + related tables — never touches
                             external_jobs)
   ↓
Job Intelligence API       (GET /api/job/external/:id/intelligence)
```

The original job (`external_jobs.title`/`description`/`salary_*`/...) is
**never** modified by this phase. Everything under `job_intelligence` and
its related tables is derived, versioned data.

## Architecture

```text
services/job/src/intelligence/
  types.ts, constants.ts, config.ts    shared types, EXTRACTOR_VERSION, env config
  extractors/
    experience.ts, seniority.ts, education.ts   regex-based, deterministic
    sections.ts                        responsibilities/requirements from raw HTML
    skills.ts                          taxonomy matching (job_skills/job_skill_aliases)
    deterministic.ts                   combines all of the above into one pass
  ai/
    provider.ts                        AiExtractionProvider interface + Gemini impl
    schema.ts                          zod schema, strict-validates AI output
    extractor.ts                       call provider -> parse -> validate -> classify errors
  repository.ts                        all SQL (extractors never touch the DB)
  processor.ts                         processJobIntelligence(jobId) — the one entry point
  batch.ts                             keyset-paginated batch/backfill, bounded concurrency
  logger.ts                            structured logs
  scripts/
    cli.ts                             backs process/backfill/reprocess npm scripts
    worker.ts                          periodic background processing
```

## Versioning

```ts
export const EXTRACTOR_VERSION = "1.0"; // services/job/src/intelligence/constants.ts
```

Centralized in exactly one place — never hard-coded elsewhere.
`job_intelligence` has `UNIQUE(external_job_id, extractor_version)`, so
bumping this constant never overwrites or deletes an existing version's
rows; it just means new processing produces a new, additional row. A future
version can coexist with `1.0` for the same job until backfilled.

## Idempotency / caching

Each `job_intelligence` row also stores `content_fingerprint` — the
`external_jobs.content_fingerprint` value at extraction time. Before
reprocessing, `processJobIntelligence()` checks: same job, same extractor
version, same fingerprint, status already `completed`? If so, it's skipped
(no DB writes beyond the check itself). Reprocessing happens automatically
when the job's content changed (fingerprint differs) or explicitly via
`--force`. Verified live: running the batch a second time on unchanged data
processes 0 jobs in ~24ms; changing a job's content or extractor version
correctly triggers reprocessing.

## Deterministic extraction

| Field | Strategy | Source |
| :--- | :--- | :--- |
| Seniority | Fixed most-senior-first keyword priority against the **title only** (`executive > director > principal > staff > lead > manager > senior > mid > junior > entry > intern`); `unknown` if nothing matches | `extractors/seniority.ts` |
| Experience (min/max years) | Ordered regex patterns (range, at-least, N+, bare N) scanned against **structured requirement items first**, falling back to the full description | `extractors/experience.ts` |
| Education | Keyword regex (PhD > Master's > Bachelor's > Associate's > Bootcamp > High school > explicit "no degree") against the description | `extractors/education.ts` |
| Skills | Data-driven taxonomy match (`job_skills` + `job_skill_aliases`) — see below | `extractors/skills.ts` |
| Responsibilities / Requirements | HTML-structure-aware section extraction from the **raw** ingested payload — see below | `extractors/sections.ts` |
| Employment type | **Reused verbatim** from `external_jobs.job_type` | processor.ts |
| Work arrangement | **Reused verbatim** from `external_jobs.work_location` | processor.ts |
| Compensation | **Reused verbatim** from `external_jobs.salary_min/max/currency` | processor.ts |

No AI call is made for any of the above — this is why AI usage stays rare
(only responsibilities/requirements/summary ever need it, and only when the
deterministic pass finds nothing).

### Why responsibilities/requirements read raw HTML, not `description`

Phase 3's `stripHtml()` replaces every tag (`<li>`, `<br>`, `<p>`) with a
single space before storing `external_jobs.description` — correct for
full-text search (Phase 7), but it destroys exactly the list/heading
structure needed to tell responsibilities and requirements apart. So
`extractors/sections.ts` reads `raw_external_jobs.raw_payload` (preserved
verbatim since Phase 3) instead, and does its own minimal HTML-to-lines
conversion + heading detection:

- **Lever**: postings already arrive pre-split into `{ text: heading,
  content: html }` blocks (`rawPayload.lists`) — used directly.
- **Greenhouse / Ashby / fixture**: a single HTML blob (`content` /
  `descriptionHtml` / `description`) is walked line-by-line, switching
  "current section" (responsibilities / requirements / preferred) on
  recognized headings, collecting subsequent `<li>` items into that
  section. Text outside any recognized heading is dropped — never guessed
  into a category.

Recognized headings (case-insensitive, ≤8 words to avoid mid-sentence
false triggers): "Responsibilities" / "What you'll do" / "Duties" /
"Key responsibilities" for responsibilities; "Requirements" / "Requires" /
"Qualifications" / "What you'll bring" / "What we're looking for" /
"Minimum qualifications" for requirements; "Preferred" / "Nice to have" /
"Bonus points" / "A plus" / "What we value" as a **preferred**-level
sub-section of requirements. The last two headings ("Requires" / "What we
value") were added after live-data verification found a real Palantir
(Lever) posting using exactly this phrasing that the initial pattern set
missed — see the implementation report for the before/after.

### Skill taxonomy (data-driven, not hard-coded)

`job_skills` (canonical name, category, `technical`/`soft`/`domain`) +
`job_skill_aliases` (alias → skill, `case_sensitive` flag), seeded by
migration 007 from patterns actually observed in live-ingested Lever/
Greenhouse/Ashby postings (~70 skills, ~100 aliases across programming
languages, frameworks, databases, cloud, devops, architecture, protocols,
AI/ML, mobile, tools, a small set of soft skills, and domain terms).
Extraction code never contains `if (text.includes("kubernetes"))` — it
queries these tables (`loadSkillTaxonomy()`) and matches generically.

**Aliases normalize variants** to one canonical skill: "Postgres" /
"PostgreSQL" / "postgres" all resolve to the same `PostgreSQL` skill;
"Golang" resolves to `Go`; "K8s" resolves to `Kubernetes`.

**False-positive control**: short/common-English-word skill names are
flagged `case_sensitive = true` and matched with exact case + word
boundaries — "Go" (capitalized) matches the language, bare lowercase "go"
in "we go the extra mile" does not; "REST" (all-caps) matches the
architecture style, "the rest of the team" does not. Verified with
dedicated tests (`skills.test.ts`) and confirmed against 699 real jobs with
zero observed false positives of this kind.

**Requirement level is derived from *where* a skill is found, not merely
its presence**: a skill found inside a structured `required`/`preferred`
requirement item inherits that level; a skill only found in the general
description is `mentioned` — never upgraded to required/preferred just
because the technology is named somewhere in the posting.

## AI extraction (optional, minimal, off by default)

Used **only** for `responsibilities`/`requirements` (when the deterministic
HTML-structure pass found none) and the job `summary` (always AI-only —
deterministic extraction can't reliably synthesize a summary). Disabled by
default (`INTELLIGENCE_AI_ENABLED=false`); the entire deterministic pipeline
above works fully without any AI key.

### Reuses the project's existing AI provider

The utils service already calls Google Gemini directly via `@google/genai`
(`/career`, `/resume-analyzer` routes, `API_KEY_GEMINI`). Phase 8 reuses the
**same provider/SDK** — `GeminiExtractionProvider` in
`intelligence/ai/provider.ts` — rather than introducing a second AI client
architecture. Job-service gets its own key
(`INTELLIGENCE_GEMINI_API_KEY`) since it's a separate deployable process,
not because it's a different provider.

### Provider boundary

```ts
interface AiExtractionProvider {
  readonly name: string;
  generate(input: AiProviderInput): Promise<string>;
}
```

`processor.ts` depends only on this interface — swapping providers means
writing a new class, nothing else in the pipeline changes.

### Prompt injection defense

The job description is wrapped in explicit `<<<JOB_DESCRIPTION>>>`
delimiters with an instruction to treat everything inside as data to
analyze, never as instructions — the standard documented mitigation. This
is defense-in-depth, not a guarantee: combined with strict schema
validation of the output (below), even a successful injection can only
produce garbage text within a bounded shape (a `text` string ≤500 chars in
a known array position) — never code execution, tool calls, or data
exfiltration, since the model's output is only ever displayed as plain
text, never executed or reinterpreted.

### Structured output validation (zod)

```ts
AiExtractionSchema = z.object({
  responsibilities: z.array(z.object({ text: z.string().min(1).max(500) }).strict()).max(20),
  requirements: z.array(z.object({ text: z.string().min(1).max(500), level: z.enum(["required","preferred"]) }).strict()).max(20),
  summary: z.string().min(1).max(600),
}).strict();
```

`.strict()` rejects any unexpected field a model might add (e.g. a leaked
instruction or unrequested field). Untrusted model output is **never**
persisted without passing this — see `ai/schema.ts` and its 17 tests
(malformed JSON, missing fields, wrong enum, oversized values, wrong types,
model refusal, empty response, non-object output, and more).

### Failure handling — the job is never lost

| Failure | Classification | Effect |
| :--- | :--- | :--- |
| Timeout | retryable | Deterministic fields still persisted; `job_intelligence.status = 'retryable_failed'` |
| Network/provider error | retryable | Same as above |
| Malformed JSON | retryable | Same as above |
| Schema validation failure | **not** retryable (a prompt/schema mismatch won't fix itself) | Deterministic fields still persisted; `status = 'failed'` |

In every case, `external_jobs` is completely untouched and every
deterministic field (skills, seniority, experience, education, employment
type, work arrangement, compensation) is still persisted — only the
AI-specific fields (responsibilities/requirements/summary, and only when
deterministic found nothing) are missing. `last_error` records what
happened; a later `npm run intelligence:reprocess` retries it.

## Provenance and confidence

Every skill/responsibility/requirement row has `source`:
`'deterministic'` or `'ai'`. Deterministic matches always have
`confidence = NULL` — there's no calibrated probability to report for a
regex/taxonomy match, and the schema/code never pretend otherwise. AI
matches *could* carry a 0–1 confidence in a future extractor version (the
column exists for this), but the current AI schema doesn't request one
from the model, so AI-sourced rows also have `confidence = NULL` today.

## Database (migration 007)

```text
job_intelligence          one row per (external_job_id, extractor_version)
job_skills                controlled skill taxonomy (renamed from a naive
                           "skills" — see Known limitations)
job_skill_aliases         alias -> canonical skill, case-sensitivity flag
job_intelligence_skills   job <-> skill, with requirement level + provenance
job_responsibilities      structured, ordered responsibility statements
job_requirements          structured, ordered requirement statements
```

All additive; nothing in Phase 1–7's schema changed. Indexes: standard
lookup indexes on every foreign key (`external_job_id`, `extractor_version`,
`status`, `skill_id`, `job_intelligence_id`), plus a generated
`alias_lower` column with a unique index for case-insensitive alias lookup.

**Important naming note**: a `skills` table already existed from Phase 1/2
(user-profile skills, `skill_id`/`name`, completely different schema).
Phase 8's taxonomy tables are named `job_skills`/`job_skill_aliases`
specifically to avoid colliding with it — discovered and fixed during
migration testing against a real database (see the implementation report).

## Backfill / reprocessing

```bash
npm run intelligence:process -- --job-id=<id> [--force]   # single job, for debugging
npm run intelligence:backfill                              # all pending jobs
npm run intelligence:reprocess                              # all jobs, forced (ignore cache)
```

One CLI (`intelligence/scripts/cli.ts`) backs all three — no duplicated
batch/single-job logic. Backfill uses **keyset pagination**
(`WHERE id > lastId ORDER BY id LIMIT batchSize`, never `OFFSET`) and only
selects jobs that actually need work (no completed row for the current
extractor version, or the job changed since last processed) — a periodic
worker tick doesn't re-scan already-done jobs. `--force` bypasses that
filter and reprocesses every active job regardless.

Bounded concurrency (`INTELLIGENCE_MAX_CONCURRENCY`, default 2) — never
loads the whole table into memory, never opens unbounded parallel work.
One bad job never stops the batch: each job is wrapped in its own
try/catch, and `processJobIntelligence()` itself catches failures
internally and returns a `failed`/`retryable_failed` result rather than
throwing in the normal case.

## Automatic processing for new jobs

```bash
npm run intelligence:worker
```

A small long-running process (`intelligence/scripts/worker.ts`) that ticks
on an interval (`INTELLIGENCE_WORKER_INTERVAL_MS`, default 60s), running one
backfill pass over pending jobs each time. Deployed as its own container
(`job-intelligence-worker` in `docker-compose.yml`), sharing the same
job-service image as `job-service` and `job-scheduler` — no new
microservice.

**This is deliberately not the Phase 6 `Scheduler`.** It needs no
per-source cron configuration and no lock table: each tick's query only
ever selects jobs that still need work, so two overlapping ticks (even from
two worker replicas) just do redundant no-op checks, never duplicate
writes — reusing the actual `Scheduler` class here would mean bolting on
cron parsing and a lock table this task doesn't need. A plain interval loop
is the smaller, correct fit.

## API

```http
GET /api/job/external/:id/intelligence
```

Read-only — never triggers processing itself (that's the batch/worker's
job). Returns 404 if intelligence hasn't been generated yet, or is still
`pending`/`processing`. Never exposes raw AI prompts, raw model responses,
`last_error`, `attempt_count`, or internal processing status beyond
`completed`/`failed`/`retryable_failed`.

## Frontend

`frontend/src/app/external-jobs/[id]/page.tsx` (new — no external-job detail
page existed before Phase 8) shows the original job description verbatim,
clearly separated from a "JobiFy Intelligence" section labeled
**"Extracted by JobiFy — not written by the employer"**, with seniority,
experience, education, skills (badged by required/preferred/mentioned),
requirements, and responsibilities. Linked from a new "View details" link
on each search result card (Phase 7's `/external-jobs` list page).

## Security

- Job descriptions are treated as **untrusted input** throughout: hard
  length cap (`INTELLIGENCE_MAX_DESCRIPTION_LENGTH`, default 20000 chars)
  before any processing; never rendered as raw HTML in the frontend (React
  renders it as plain text, never `dangerouslySetInnerHTML`); never
  interpreted as instructions when passed to the AI provider (delimited +
  explicit guardrail in the prompt).
- All SQL is parameterized.
- AI output is never persisted without passing strict schema validation
  first (see above).

## Cost control

```env
INTELLIGENCE_AI_ENABLED=false          # off by default — zero AI cost unless explicitly enabled
INTELLIGENCE_MAX_DESCRIPTION_LENGTH=20000
INTELLIGENCE_BATCH_SIZE=20
INTELLIGENCE_MAX_CONCURRENCY=2
INTELLIGENCE_AI_TIMEOUT_MS=15000
```

AI is only ever called when deterministic extraction found nothing for
responsibilities/requirements — verified live: across 699 real jobs (all
with rich raw HTML), deterministic extraction alone produced results for
every single one, so **zero** AI calls were needed in the live
verification dataset. AI would only trigger for a source/posting whose raw
HTML has no recognizable section structure at all.

## Known limitations

- Skill taxonomy is intentionally small (~70 skills) and English-only —
  not an attempt to enumerate every skill in existence (per the phase
  brief). Extending it is a data change (`job_skills`/`job_skill_aliases`
  rows), not a code change.
- Heading detection for responsibilities/requirements is heuristic
  (keyword + short-line matching). It was refined twice during live-data
  verification against real postings (see the implementation report) and
  will not catch every possible phrasing a company might use; postings with
  no recognizable structure at all yield empty arrays rather than fabricated
  data — a deliberate, documented trade-off over guessing.
- Experience-year extraction is regex-based and was found (via live-data
  verification) to initially false-positive on company/team-history text
  ("formed 15+ years ago"); mitigated by excluding "years ago"/"years old"
  phrasing and preferring structured requirement-item text over general
  prose, but is not a guarantee against every possible phrasing.
- AI-derived confidence scores are not currently requested from the model
  (the schema/column support them for a future extractor version).
- No semantic/candidate matching, embeddings, or personalization — out of
  scope for Phase 8 by design (see the implementation report's phase
  boundary).
