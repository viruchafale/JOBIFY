# JobiFy

### Intelligent Job Discovery & Job Intelligence Platform

[![CI](https://github.com/viruchafale/JOBIFY/actions/workflows/ci.yml/badge.svg)](https://github.com/viruchafale/JOBIFY/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Kafka](https://img.shields.io/badge/Apache%20Kafka-async%20email-231F20?logo=apachekafka&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker%20Compose-13%20services-2496ED?logo=docker&logoColor=white)

JobiFy ingests job postings from multiple Applicant Tracking Systems, normalizes them into a single canonical schema, deduplicates and schedules that ingestion reliably, exposes them through PostgreSQL-native full-text search, and derives structured, explainable intelligence (skills, seniority, experience, requirements, responsibilities) from each posting. It is not a scraper and not a chatbot — it's an ingestion, search, and job-understanding pipeline with a recruiter/jobseeker web application built on top of it.

---

## Table of Contents

- [Overview](#overview)
- [Why JobiFy](#why-jobify)
- [Key Capabilities](#key-capabilities)
- [Architecture](#architecture)
- [Ingestion Architecture](#ingestion-architecture)
- [Live Sources](#live-sources)
- [Scheduling & Reliability](#scheduling--reliability)
- [Search](#search)
- [Job Intelligence](#job-intelligence)
- [API](#api)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Local Development](#local-development)
- [Environment Configuration](#environment-configuration)
- [Running with Docker](#running-with-docker)
- [Running Ingestion](#running-ingestion)
- [Running Job Intelligence](#running-job-intelligence)
- [Testing](#testing)
- [Security](#security)
- [Engineering Decisions](#engineering-decisions)
- [Verification](#verification)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Job postings for the same role are published in incompatible shapes across dozens of ATS platforms, with inconsistent location formats, missing compensation data, and unstructured free-text descriptions. JobiFy addresses this with a source-agnostic ingestion pipeline:

```text
Source Adapters (Lever, Greenhouse, Ashby)
        ↓
Normalization (canonical job schema)
        ↓
Validation
        ↓
Deduplication (source ID → canonical URL → content fingerprint)
        ↓
PostgreSQL (external_jobs)
        ↓
   ┌────┴────┐
   ▼         ▼
Search    Job Intelligence
(FTS)     (skills, seniority, experience, requirements, responsibilities)
```

A companion recruiter/jobseeker application (auth, profiles, recruiter-posted jobs, applications, resume analysis) is layered on top of the same PostgreSQL/Redis/Kafka infrastructure.

## Why JobiFy

Building reliable job ingestion is harder than calling a few APIs. JobiFy's engine specifically addresses:

| Problem | JobiFy's approach |
| :--- | :--- |
| Every ATS has a different response shape | One `JobSourceAdapter` contract; adapters only fetch and shape data |
| The same job can be re-fetched thousands of times | Idempotent upserts keyed on source ID → canonical URL → SHA-256 content fingerprint |
| Ingestion jobs can overlap or crash mid-run | PostgreSQL-backed per-source leases, bounded retries, graceful shutdown |
| Free-text descriptions aren't queryable | Deterministic PostgreSQL full-text search, not a bolt-on afterthought |
| "AI extraction" is often unreliable and unexplainable | Deterministic extraction first; optional, schema-validated AI only where deterministic extraction genuinely can't reach |

## Key Capabilities

| Capability | Description |
| :--- | :--- |
| Multi-source ingestion | Lever, Greenhouse, and Ashby, via their official public APIs |
| Normalization | Deterministic canonical job schema (title, location, salary, job type, work arrangement) shared across all sources |
| Deduplication | Three-tier: `source + sourceJobId` → canonical URL → SHA-256 content fingerprint |
| Scheduling | Config-driven cron schedules per source, run by a dedicated scheduler process |
| Reliability | DB-backed per-source locks, bounded exponential-backoff retries, source health tracking, conservative stale-job detection |
| Search | PostgreSQL full-text search (`websearch_to_tsquery` + `ts_rank`) with structured filters, sorting, and pagination |
| Job intelligence | Skills, seniority, experience, education, responsibilities, and requirements extracted per posting |
| AI enrichment | Optional, schema-validated Google Gemini extraction — used only when deterministic extraction finds nothing |
| REST APIs | Express-based APIs behind a single Gateway/BFF |
| Frontend | Next.js 16 / React 19 job search, job detail + intelligence view, recruiter dashboard |
| Containerization | Docker Compose — 13 services: Postgres, Redis, Kafka/Zookeeper, a migration runner, 4 app microservices, 2 background ingestion processes, Gateway, frontend |
| CI | GitHub Actions: typecheck, test, and build every backend service and the frontend against real Postgres/Redis containers |

## Architecture

```mermaid
flowchart TB
    subgraph Sources["External ATS APIs"]
        Lever[Lever]
        Greenhouse[Greenhouse]
        Ashby[Ashby]
    end

    Sources --> Adapters["Source Adapters<br/>fetch + shape only"]
    Adapters --> Raw["RawExternalJob[]"]
    Raw --> Norm["Normalize"]
    Norm --> Valid["Validate"]
    Valid --> Dedupe["Deduplicate"]
    Dedupe --> PG[(PostgreSQL)]

    PG --> Scheduler["Scheduler / job-scheduler"]
    PG --> SearchAPI["Search API<br/>GET /api/job/external/search"]
    SearchAPI --> Frontend["Next.js Frontend"]
    Scheduler -.-> Health["Source Health"]

    PG --> Intel["Job Intelligence<br/>job-intelligence-worker"]
    Intel --> Skills["Skills"]
    Intel --> Exp["Experience"]
    Intel --> Sen["Seniority"]
    Intel --> Req["Requirements"]
    Intel --> Resp["Responsibilities"]
    Intel --> Edu["Education"]

    Frontend --> Gateway["API Gateway (:5000)"]
    Gateway --> JobSvc["job-service"]
    Gateway --> AuthSvc["auth-service"]
    Gateway --> UserSvc["user-service"]
    Gateway --> UtilsSvc["utils-service"]
    UtilsSvc --> Kafka[(Kafka)]
    AuthSvc --> Redis[(Redis)]
    JobSvc --> Redis
    UserSvc --> Redis
    UtilsSvc --> Redis
```

Redis is used for session/rate-limit state across all four backend services (`auth`, `user`, `job`, `utils`); Kafka carries asynchronous transactional email (auth/job producers → utils consumer → SMTP). Neither is used for ingestion, search, or intelligence — those are entirely PostgreSQL-native.

## Ingestion Architecture

```text
                    JobSourceAdapter
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
       Lever         Greenhouse          Ashby
          │               │               │
          └───────────────┼───────────────┘
                          ▼
                    runIngestion()
                          │
           normalize → validate → dedupe → persist
                          ▼
                    external_jobs
```

Every adapter implements one contract:

```ts
interface JobSourceAdapter {
  readonly source: string;
  fetchJobs(): Promise<RawExternalJob[]>;
  getLastFetchErrors?(): string[]; // multi-company/board sources
}
```

Adapters do **only** HTTP request → shape into `RawExternalJob[]`. They never touch PostgreSQL, never normalize, never deduplicate, never schedule. This isolation means each ATS's response shape and quirks (e.g. Greenhouse's double-escaped HTML, Lever's pre-split responsibility/requirement lists) are contained in one file, while normalization, validation, deduplication, and persistence are implemented exactly once and shared by every source. Adding a new source has never required changing that shared pipeline.

## Live Sources

JobiFy ingests from the **official public postings APIs** of:

- **Lever** — `api.lever.co/v0/postings/<slug>`
- **Greenhouse** — `boards-api.greenhouse.io/v1/boards/<token>/jobs`
- **Ashby** — `api.ashbyhq.com/posting-api/job-board/<slug>`

No credentials are required for any of these — they are public, documented endpoints. JobiFy does not scrape HTML, bypass rate limits, or use undocumented/private endpoints for any source.

## Scheduling & Reliability

```text
Scheduler
   │
   ▼
Acquire source lease (PostgreSQL ingestion_locks, TTL-bound)
   │
   ▼
runIngestion()
   │
   ├── completed → source health: consecutive failures reset
   ├── partial   → source health: degraded, not reset, not incremented
   └── failed    → classify error → retryable? bounded backoff+jitter retry : stop
   │
   ▼
Stale-job evaluation (only after a completed run)
   │
   ▼
Release lease
```

- **Config-driven schedules** — a semicolon-separated `source:cron` list (`INGESTION_SCHEDULES`), validated at startup against the registered source list.
- **PostgreSQL-backed leases, not advisory locks** — the job service talks to Postgres through `@neondatabase/serverless`'s HTTP driver, where each query is its own request with no guaranteed persistent connection. A session-level advisory lock requires exactly that guarantee, so a `ingestion_locks` table row with a TTL is used instead — it survives across requests, processes, and crashes using the same query interface every other ingestion query already uses.
- **Bounded retries** — exponential backoff with jitter, only for errors classified `retryable` (HTTP 429/5xx, timeouts, network errors); permanent/configuration errors are never retried.
- **Failure isolation** — one source failing never affects another; a scheduler task throwing never crashes the process.
- **Source health** — `ingestion_source_health` tracks `last_status`, `consecutive_failures`, and totals per source.
- **Stale-job detection** — conservative by design: a job is only deactivated after a configurable number of **successful, full** runs stop seeing it (`INGESTION_STALE_AFTER_RUNS`); a failed or partial run never deactivates anything, and historical jobs are never deleted, only flagged `is_active = false`.
- **Graceful shutdown** — `SIGTERM`/`SIGINT` stop new scheduling immediately and wait (bounded by `INGESTION_SHUTDOWN_TIMEOUT_MS`) for in-flight runs before exiting.

## Search

`GET /api/job/external/search` is PostgreSQL-native and deterministic — **no Elasticsearch, OpenSearch, or vector database is used or required.**

- A `GENERATED ALWAYS ... STORED` `tsvector` column (`search_vector`) on `external_jobs`, weighted `title (A) > role/company (B) > description/location (C)`, backed by a GIN index.
- Queries use `websearch_to_tsquery('english', ...)` (never raw `to_tsquery` string-building) and rank with `ts_rank()`.
- Structured filters combine with full-text search under AND semantics: `location`, `company`, `role` (case-insensitive substring), `source`, `jobType`, `workLocation` (normalized enums), `minSalary`/`maxSalary` (interval-overlap semantics), `postedAfter`/`postedBefore`, `active`.
- Deterministic sort with a stable secondary key (`sort=relevance|newest|oldest|salary_high|salary_low`, always tie-broken by `id`).
- Bounded pagination (`limit` capped at 100) and a public-endpoint rate limit (120 requests/minute/IP).

Query plans were inspected with `EXPLAIN ANALYZE` against a locally-populated dataset of real ingested jobs; all representative query shapes (keyword search, filters, pagination) executed in single-digit milliseconds. This is a local verification result, not a production-scale benchmark — see [`docs/search.md`](docs/search.md) for the full methodology and figures.

## Job Intelligence

```text
Job Description (raw ingested payload)
      │
      ▼
Deterministic Extraction
      │
      ├── Skills          (taxonomy + alias matching, case-sensitive guards against false positives)
      ├── Experience       (regex, structured-requirements-first)
      ├── Seniority        (title keyword priority)
      └── Education        (regex)
      │
      ▼
Section-aware extraction (raw HTML structure, not the flattened search-index text)
      │
      ├── Responsibilities
      └── Requirements (required vs. preferred)
      │
      ▼
Optional AI enrichment (only if deterministic found nothing here)
      │
      ▼
Strict schema validation → job_intelligence + related tables
```

JobiFy uses **deterministic extraction for reliably structured fields** — skills, seniority, experience, education, employment type, work arrangement, and compensation are never sent to an AI model; they come from a data-driven skill taxonomy (`job_skills`/`job_skill_aliases`, ~70 skills / ~100 aliases) and regex/structural rules, and are fully reproducible. AI (Google Gemini, via the same provider already used elsewhere in this codebase) is **optional, disabled by default, and used only** for `responsibilities`/`requirements`/`summary` when the deterministic HTML-structure pass finds nothing — its output is never persisted without passing a strict schema (zod, `.strict()`, length/count-capped) first, and a provider failure never removes a job or its already-extracted deterministic fields.

Every extracted field is versioned (`extractor_version`) and provenanced (`source: 'deterministic' | 'ai'`); reprocessing is idempotent via a `(job, extractor_version)` cache key plus a content fingerprint, so unchanged jobs are never redundantly reprocessed.

**Not implemented**: candidate profiles, resume matching, candidate scoring, recommendations, or auto-apply. This phase is job *understanding*, not candidate matching.

## API

Served through a single Gateway (`:5000`) that proxies `/api/job/*`, `/api/auth/*`, `/api/user/*`, `/api/utils/*` to the corresponding internal service.

```http
GET  /api/job/external                       # Phase 3 — bare list, legacy filters
GET  /api/job/external/search                 # Phase 7 — full-text + structured search
GET  /api/job/external/:id                    # single external job
GET  /api/job/external/:id/intelligence       # Phase 8 — derived intelligence (read-only)
```

Search examples:

```http
GET /api/job/external/search?q=backend+engineer
GET /api/job/external/search?q=golang&location=India&workLocation=remote
GET /api/job/external/search?workLocation=remote&source=lever&sort=newest
```

Intelligence:

```http
GET /api/job/external/482/intelligence
```

The application layer (auth, jobseeker/recruiter profiles, recruiter-posted jobs, applications, company management) is documented in [`docs/api/PUBLIC-API.md`](docs/api/PUBLIC-API.md) and [`docs/api/openapi.yaml`](docs/api/openapi.yaml).

## Technology Stack

| Layer | Technologies |
| :--- | :--- |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Radix UI |
| Backend | Node.js, Express 5, TypeScript (5 services: `gateway`, `auth`, `user`, `job`, `utils`) |
| Database | PostgreSQL 16 (`@neondatabase/serverless` driver; plain SQL migrations, no ORM) |
| Cache | Redis 7 (sessions, rate limiting) |
| Messaging | Apache Kafka (asynchronous transactional email) |
| Search | PostgreSQL full-text search (no external search engine) |
| AI | Google Gemini (`@google/genai`) — optional, schema-validated, used in `utils` (career guidance, resume analysis) and optionally in `job` (Phase 8 intelligence enrichment) |
| Validation | zod (untrusted-input and AI-output schema validation) |
| Infrastructure | Docker, Docker Compose |
| Testing | Vitest (all backend services) |
| CI | GitHub Actions (typecheck + test + build, all services, against live Postgres/Redis containers) |

## Repository Structure

```text
.
├── frontend/                      # Next.js 16 app (jobseeker/recruiter UI, external job search + detail)
├── services/
│   ├── gateway/                   # API Gateway / BFF (:5000)
│   ├── auth/                      # Registration, login, sessions
│   ├── user/                      # Profiles, skills, applications
│   ├── job/                       # Jobs, companies, and the ingestion/search/intelligence engine
│   │   └── src/
│   │       ├── ingestion/         # Phase 3-7: adapters, normalize/validate/dedupe, search, scheduler
│   │       │   ├── sources/       # leverAdapter.ts, greenhouseAdapter.ts, ashbyAdapter.ts
│   │       │   └── scheduler/     # cron, DB-backed locks, retries, health
│   │       ├── intelligence/      # Phase 8: extractors, optional AI layer, batch/worker
│   │       ├── controller/
│   │       └── routes/
│   └── utils/                     # Uploads (Cloudinary), Gemini career/resume features, email consumer
├── database/
│   └── migrations/                # 000-007, plain SQL, applied by database/scripts/migrate.mjs
├── docs/
│   ├── architecture/               # Phase 0-8 implementation reports
│   ├── api/                        # PUBLIC-API.md, openapi.yaml
│   ├── ingestion.md, search.md, intelligence.md, operations.md
├── docker-compose.yml              # 13 services — see Running with Docker
└── .github/workflows/ci.yml
```

## Local Development

### Prerequisites

- Node.js 20+ (matches CI and Docker base images)
- Docker & Docker Compose (recommended path)
- PostgreSQL 16 and Redis 7 if running services outside Docker

### Option A — Docker Compose (recommended)

```bash
git clone https://github.com/viruchafale/JOBIFY.git
cd JOBIFY
cp .env.example .env
docker compose up -d --build
docker compose ps
```

See [Running with Docker](#running-with-docker) for what starts and how to reach it.

### Option B — Per-service local development

There is no root-level install/start script — each package is independent:

```bash
# one service at a time, e.g.:
cd services/job && npm install && npm run dev

# frontend
cd frontend && npm install && npm run dev
```

Apply database migrations before starting any service:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/jobify \
  node database/scripts/migrate.mjs up
```

## Environment Configuration

Copy the example file and fill in real values — never commit a filled `.env`:

```bash
cp .env.example .env
```

The root `.env.example` covers what `docker-compose.yml` consumes (database credentials, Redis, Kafka, JWT/session secrets, Cloudinary, SMTP, Gemini key, gateway/frontend URLs). Each service also has its own `.env.example` (e.g. `services/job/.env.example`) with service-specific configuration:

- **Ingestion sources**: `LEVER_COMPANIES`, `GREENHOUSE_COMPANIES`, `ASHBY_COMPANIES`
- **Scheduler**: `INGESTION_SCHEDULER_ENABLED`, `INGESTION_SCHEDULES`, `INGESTION_TIMEZONE`, `INGESTION_MAX_CONCURRENCY`, `INGESTION_LOCK_TTL_SECONDS`, `INGESTION_RETRY_MAX_ATTEMPTS`, `INGESTION_STALE_AFTER_RUNS`, `INGESTION_SHUTDOWN_TIMEOUT_MS`
- **Job intelligence**: `INTELLIGENCE_AI_ENABLED` (default `false`), `INTELLIGENCE_GEMINI_API_KEY`, `INTELLIGENCE_MAX_DESCRIPTION_LENGTH`, `INTELLIGENCE_BATCH_SIZE`, `INTELLIGENCE_MAX_CONCURRENCY`, `INTELLIGENCE_WORKER_INTERVAL_MS`

Full descriptions and defaults for every variable are in [`docs/operations.md`](docs/operations.md) and [`docs/intelligence.md`](docs/intelligence.md).

## Running with Docker

```bash
docker compose up -d --build
```

This starts, in dependency order: `postgres`, `redis`, `zookeeper`, `kafka`, a one-shot `migration` runner, then `auth-service`, `user-service`, `job-service`, `job-scheduler`, `job-intelligence-worker`, `utils-service`, `gateway`, and `frontend`.

| Service | Reachable at |
| :--- | :--- |
| Frontend | `http://localhost:3000` |
| API Gateway | `http://localhost:5000` (`/health`, `/ready`) |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |
| Kafka | `localhost:29092` (host), `kafka:9092` (in-network) |

`auth-service`, `user-service`, `job-service`, `utils-service`, `job-scheduler`, and `job-intelligence-worker` are internal to the Compose network and reached only through the Gateway — they have no host port mappings.

`job-scheduler` and `job-intelligence-worker` share the exact same image/codebase as `job-service`, started with a different `command:` — they are not separate microservices, and `INGESTION_SCHEDULER_ENABLED`/`INTELLIGENCE_AI_ENABLED` both default to `false`, so neither does anything until explicitly configured.

## Running Ingestion

From `services/job`:

```bash
npm run ingest:fixture        # deterministic local fixture, no network required
npm run ingest:lever          # requires LEVER_COMPANIES
npm run ingest:greenhouse     # requires GREENHOUSE_COMPANIES
npm run ingest:ashby          # requires ASHBY_COMPANIES
npm run ingest:scheduler      # long-running; requires INGESTION_SCHEDULER_ENABLED=true
npm run ingest:scheduler -- --once   # run every configured source once, then exit
npm run ingest:health         # operator CLI: source health table
```

## Running Job Intelligence

From `services/job`:

```bash
npm run intelligence:process -- --job-id=<id>   # single job, for debugging
npm run intelligence:backfill                    # all pending jobs, keyset-paginated batches
npm run intelligence:reprocess                   # force-reprocess every job (e.g. after a taxonomy change)
npm run intelligence:worker                      # long-running background processor
```

Safe to run repeatedly: a job whose content and extractor version are unchanged is skipped, not reprocessed.

## Testing

```bash
cd services/gateway && npm test   # 6 tests
cd services/auth && npm test      # 7 tests
cd services/user && npm test      # 7 tests
cd services/job && npm test       # 423 tests (ingestion, scheduler, search, intelligence)
cd services/utils && npm test     # 14 tests
```

Typecheck and build (per service, matching CI exactly):

```bash
npx tsc --noEmit --project services/<service>/tsconfig.json
cd services/<service> && npm run build
```

Frontend:

```bash
cd frontend && npx tsc --noEmit && npm run build
```

GitHub Actions (`.github/workflows/ci.yml`) runs all of the above — migrations, typecheck, test, build — against real Postgres and Redis containers on every push/PR to `main`/`master`.

## Security

- **Authentication & sessions**: JWT + Redis-backed sessions, `httpOnly` cookies.
- **Role-based access control**: `jobseeker`/`recruiter` roles enforced at the controller level (e.g. only a `recruiter` can create a company or post a job).
- **Rate limiting**: `express-rate-limit` + Redis store on authentication, uploads, application submission, and public search endpoints (search: 120 req/min/IP).
- **CORS**: explicit allow-list (`CORS_ORIGINS`) enforced at both the Gateway and each service.
- **Upload validation**: file-type/size/magic-byte checks on resumes and images before they reach storage.
- **Parameterized SQL everywhere** — no string-concatenated queries, in the application layer or the ingestion/search/intelligence pipeline.
- **Untrusted-input handling in ingestion & intelligence**: job descriptions are treated as untrusted data — length-capped, never rendered as raw HTML in the frontend, and explicitly delimited with an anti-injection instruction before being passed to the optional AI provider.
- **Strict AI output validation**: any AI-generated content is validated against a `zod` schema (rejecting unexpected fields, oversized values, and invalid enums) before it is ever persisted.
- **Secrets via environment variables only** — `.env` files are git-ignored; `.env.example` files contain no real credentials.

## Engineering Decisions

**Why PostgreSQL for search, not Elasticsearch/OpenSearch?**
The current data volume and query patterns (keyword + structured filters over a single table) are well served by PostgreSQL's native full-text search and GIN indexing. Introducing a second, distributed search system would add operational surface area — new deployment, new sync pipeline, new failure mode — without a demonstrated need. This is intentionally revisited only if real usage proves PostgreSQL insufficient.

**Why per-source adapters instead of one ingestion implementation per pipeline stage?**
Each ATS has its own response shape, quirks (Greenhouse's double-escaped HTML; Lever's pre-split `lists`), and failure modes. Isolating that in a thin adapter (`fetchJobs()` only) keeps every external API contract in exactly one file, while normalization/validation/deduplication/persistence are written once and never duplicated per source.

**Why PostgreSQL-backed leases instead of `pg_advisory_lock`?**
The job service reaches Postgres through `@neondatabase/serverless`'s stateless HTTP driver — there is no guarantee the same connection persists for an entire ingestion run, which a session-level advisory lock requires. A row with a TTL in `ingestion_locks` survives across requests, processes, and crashes using the same query interface already used everywhere else.

**Why deterministic extraction before AI?**
Skills, seniority, experience, education, and compensation can be derived reliably and reproducibly from structured data and pattern matching. Reserving AI for the cases deterministic extraction genuinely can't reach (unstructured responsibility/requirement prose) keeps the system's output explainable, keeps AI cost near zero by default, and means the system is fully functional with `INTELLIGENCE_AI_ENABLED=false`.

**Why is AI enrichment optional and schema-gated?**
A third-party model call can fail (timeout, rate limit, malformed output) for reasons outside JobiFy's control. Making it optional, timeboxed, and validated against a strict schema before persistence means a provider outage degrades gracefully — the job and its deterministic fields are never lost — rather than corrupting data or blocking the pipeline.

## Verification

The following are results from local development/test-environment verification, not production benchmarks:

- **457 automated tests passing** across all five backend services (`gateway` 6, `auth` 7, `user` 7, `job` 423, `utils` 14), plus a clean `tsc --noEmit` and production build for every service and the frontend.
- A local backfill of **699 real ingested jobs** (fixture data plus live Lever/Greenhouse/Ashby postings pulled during development) completed job-intelligence processing with **699 completed, 0 failed**, in roughly 7 seconds, with zero AI calls required — deterministic extraction alone was sufficient for the entire local dataset.
- Representative search queries (keyword search, structured filters, pagination) were inspected with `EXPLAIN ANALYZE` against that same locally-populated dataset and executed in single-digit milliseconds.
- CI (`.github/workflows/ci.yml`) re-runs migrations, typecheck, tests, and builds for every service on every push, against real Postgres/Redis containers.

These figures describe a local verification environment with hundreds of jobs, not a production deployment at scale.

## Roadmap

```text
[x] Security + Correctness
[x] Production Foundation
[x] Ingestion Foundation
[x] Lever ingestion
[x] Greenhouse + Ashby ingestion
[x] Scheduling + Reliability
[x] Advanced Search
[x] Job Intelligence
[ ] Candidate Intelligence
[ ] Explainable Job/Candidate Matching
[ ] AI Career Intelligence
[ ] Personal Job Agent
```

Items below the line are directional and not yet implemented.

## Documentation

- [Public API Specification](docs/api/PUBLIC-API.md) · [OpenAPI Contract](docs/api/openapi.yaml)
- [Ingestion System Reference](docs/ingestion.md)
- [Operations Guide (Scheduler)](docs/operations.md)
- [Search Reference](docs/search.md)
- [Job Intelligence Reference](docs/intelligence.md)
- Phase reports: [1](docs/architecture/PHASE-1-IMPLEMENTATION-REPORT.md) · [2](docs/architecture/PHASE-2-IMPLEMENTATION-REPORT.md) · [3](docs/architecture/PHASE-3-INGESTION-FOUNDATION.md) · [4](docs/architecture/PHASE-4-LEVER-INGESTION.md) · [5](docs/architecture/PHASE-5-MULTI-SOURCE-INGESTION.md) · [6](docs/architecture/PHASE-6-SCHEDULING-RELIABILITY.md) · [7](docs/architecture/PHASE-7-ADVANCED-SEARCH.md) · [8](docs/architecture/PHASE-8-JOB-INTELLIGENCE.md)
- [Architecture Blueprint](docs/architecture/JOBIFY-2.0-PHASE-0-BLUEPRINT.md)

## Contributing

```text
1. Fork and clone the repository
2. Copy .env.example to .env and configure it
3. Install dependencies per service (cd services/<name> && npm install)
4. Run the relevant service's tests before and after your change
5. Create a feature branch
6. Make your change, keeping it scoped to one concern
7. Ensure npm test, tsc --noEmit, and npm run build all pass for any service you touched
8. Open a pull request describing the change and why it's needed
```

## License

No `LICENSE` file is currently present in this repository. License information will be added separately.
