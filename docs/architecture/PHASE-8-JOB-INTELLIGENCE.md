# JobiFy 2.0 — Phase 8: Job Intelligence

Turns normalized job postings into structured, explainable, versioned
intelligence. For the full technical reference (extraction strategy,
taxonomy, AI provider, provenance, API, frontend), see **`docs/intelligence.md`**.
This document covers what changed and why, at the phase level, plus the
evidence gathered while implementing it.

## What changed

- **New**: `services/job/src/intelligence/` — the entire extraction
  pipeline (deterministic extractors, optional AI layer, repository,
  processor, batch, CLI, worker). ~20 files, ~110 unit tests.
- **New**: `database/migrations/007_phase8_job_intelligence.sql` — six new
  tables, zero changes to Phase 1–7 schema.
- **New**: `GET /api/job/external/:id/intelligence` (read-only).
- **New**: `frontend/src/app/external-jobs/[id]/page.tsx` — the first
  external-job detail page (none existed before Phase 8).
- **New**: `job-intelligence-worker` in `docker-compose.yml` — same
  job-service image, different command, no new microservice.
- **Modified**: `frontend/src/app/external-jobs/page.tsx` — added a "View
  details" link per result card; `frontend/src/type.ts` / `lib/api.ts` —
  new types/client methods.
- **Unchanged**: `external_jobs`, all of Phase 3–7's ingestion/search
  pipeline, the Phase 6 scheduler, the Gateway (no routing change needed).

## A real bug found and fixed during migration testing

Migration 007 originally named its taxonomy tables `skills`/`skill_aliases`.
Applying it against a real database failed: a `skills` table **already
existed** from Phase 1/2 (user-profile skills — `skill_id SERIAL PRIMARY
KEY, name VARCHAR(100)`, completely different shape, used by
`services/user`'s `addSkill`/`deleteSkill` endpoints). This was not caught
by unit tests (which use fake in-memory DBs) — only live migration testing
against a real Postgres surfaced it. Fixed by renaming to `job_skills`/
`job_skill_aliases` everywhere (migration, `repository.ts`, doc comments)
and re-verifying the full migration + backfill from a clean database. The
pre-existing `skills`/`user_skills` tables are completely untouched.

## Two extraction-quality issues found and fixed via live-data verification

Both were found by running the full pipeline against 699 real jobs
(fixture + live Lever/Greenhouse/Ashby ingestion from Phases 4–7), not by
unit tests alone — exactly the kind of thing "inspect actual JobiFy data"
in the phase brief was asking for:

1. **False-positive experience extraction**: a real Palantir (Lever)
   posting titled *"Privacy & Civil Liberties Engineer - New Grad"* was
   extracted with `min_experience_years = 15`, from the text *"our team was
   formed 15+ years ago"* — a team-history statement, not a candidate
   requirement. Fixed with two changes to `extractors/experience.ts`: (a) a
   negative lookahead excluding "N years ago"/"N years old" phrasing
   (non-trivial — the naive lookahead was defeated by regex backtracking
   into the optional plural "s"; fixed with a `\b` boundary that blocks the
   backtrack path — see the code comment and `experience.test.ts`), and (b)
   preferring structured requirement-item text over general description
   prose when scanning for experience statements. Re-verified: the same job
   now correctly shows `null`, and a full-dataset scan for any remaining
   `> 15` years outliers returned zero rows.
2. **Missed requirements section**: a real Palantir posting used Lever
   list headings *"What We Require"* and *"What We Value"* — the initial
   `REQUIREMENTS_HEADING` regex only matched the substring "requirement"
   (not "require"/"requires"), and there was no "preferred" heading pattern
   for "what we value". Fixed by adding both patterns to
   `extractors/sections.ts`, with regression tests. Re-verified: total
   `job_requirements` rows across the dataset grew from ~0 (for
   previously-unclassified Lever postings) to correctly populated
   required/preferred items, e.g. *"Active Full Scope Poly Level
   clearance."* → required, *"We value team members who aren't satisfied
   with surface-level answers..."* → preferred.

## Verification summary

All against a real local Postgres, from a clean migration, populated with
699 real jobs (unless noted):

- Migration 007 applies cleanly on top of 000–006 from scratch (after the
  naming fix above); 70 skills / 102 aliases seeded.
- Full backfill: 699/699 processed, 699 completed, 0 failed, ~7 seconds
  total (~10ms/job average) — zero AI calls needed (deterministic
  extraction alone succeeded for every job in this dataset).
- Idempotency: re-running the batch with no changes processes 0 jobs
  (~24ms, just the pending-check query); changing a job's content or
  forcing reprocessing correctly triggers new extraction without
  duplicating skill/responsibility/requirement rows.
- Spot-checked real extractions for quality: seniority (`"Staff Site
  Reliability Engineer"` → `staff`), experience (`"Minimum of 3 years of
  industry experience"` → `min: 3`, evidence attached), skills (Python,
  Go, TypeScript, Kubernetes, etc. — top skill by frequency: Python at 255
  mentions across 699 jobs) — all explainable, all traceable to real
  source text.
- `EXPLAIN ANALYZE` on the batch's pending-job query and the API's
  skills-lookup query: both sub-3ms, using the expected indexes
  (`job_intelligence_external_job_id_idx`,
  `job_intelligence_skills_job_intelligence_id_idx`).
- API (`GET /api/job/external/:id/intelligence`) verified end-to-end
  against real data via a server reusing the actual production
  `search.ts`/`repository.ts`/`intelligence/repository.ts` code.
- Frontend: production build (`next build`) succeeds, TypeScript passes,
  the new `/external-jobs/[id]` route registers as dynamic; server-rendered
  HTML for the detail page confirmed to render without error (shows the
  expected initial loading state — data fetching is client-side, same
  pattern as the Phase 7 search page). Full interactive browser
  verification wasn't possible in this sandbox (no browser-automation tool
  available) — see `docs/intelligence.md`'s Known Limitations.
- AI layer: fully unit-tested with a mocked provider (schema validation,
  timeout/network/malformed-JSON/schema-failure classification, retryable
  vs. non-retryable status). **Not** exercised against the real Gemini API
  in this environment — no API key is available in this sandbox, and
  `INTELLIGENCE_AI_ENABLED` defaults to `false` specifically so the system
  is fully functional without one.

## Phase boundary

Implemented: job intelligence schema, skill taxonomy, deterministic
extraction (seniority, experience, education, skills, responsibilities,
requirements, employment type, work arrangement, compensation), optional
AI extraction with strict schema validation and graceful failure handling,
provenance, versioning, processing status, batch/backfill/reprocessing,
idempotency, the read API, frontend intelligence display, observability,
tests, live-data verification (including two real bugs found and fixed).

NOT implemented (later phases): candidate intelligence, resume matching,
candidate scoring, personalized recommendations, skill-gap analysis, career
paths, embeddings, semantic candidate matching, auto-apply, notifications,
personal job agent.
