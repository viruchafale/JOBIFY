# JobiFy 2.0 — Phase 0 Architecture Blueprint

**Status:** proposed; no application code changed.  
**Repository reviewed:** frontend plus `auth`, `job`, `user`, and `utils` services.  
**Purpose:** establish the safe sequence for evolving the existing portal into an intelligent job-discovery platform.

## 1. Executive decision

Keep the existing Node/TypeScript stack and preserve the current recruiter-created job workflow. Do **not** add more independently deployed services yet. First turn the four deployments into a well-bounded, securely operated modular backend behind one public API boundary. The ingestion capability should initially be a module/worker owned by the job domain, and only become a separate deployable when schedules, failures, or throughput justify it.

The immediate priority is correctness and security, not ingestion. The current application-table bug can expose another applicant's records; public utilities permit unrestricted upload/AI spend; and there is no reliable local or CI execution path.

## 2. Current architecture

```text
Next.js 16 / React 19 browser client
  ├─ direct HTTP → auth :5002       (register, login, reset)
  ├─ direct HTTP → job :5007        (companies, jobs, applications)
  ├─ direct HTTP → user :5006       (profiles, skills, applications)
  └─ direct HTTP → utils :5005      (Cloudinary proxy, Gemini)

auth, job, and user ───────────────→ one Neon PostgreSQL database
auth ──────────────────────────────→ Redis (password-reset tokens)
auth + job ── Kafka topic send-mail → utils → Gmail SMTP
auth/job/user ─────────────────────→ utils → Cloudinary
utils ─────────────────────────────→ Gemini
```

### Frontend

- Next.js App Router client with Tailwind/Radix-style components and one React authentication context.
- Every page calls service URLs directly, with hard-coded public IP addresses in `frontend/src/context/AppContext.tsx`.
- JWTs are read from a JavaScript-readable cookie and supplied in `Authorization` headers.
- No shared typed API client, server/BFF boundary, query cache, route-level metadata, or end-to-end tests.

### Backend and data ownership

| Deployment | Current responsibility | Data reality | Assessment |
|---|---|---|---|
| `auth` | registration, login, password reset | creates `users`, `skills`, `user_skills` | useful boundary, but auth is coupled to profile and uploads |
| `job` | companies, internal jobs, applications | creates `companies`, `jobs`, `applications` | useful domain owner; application workflow needs repair |
| `user` | profiles, uploads, skills | directly reads/writes auth-owned tables and duplicates apply flow | should become a profile module, not a separately exposed data owner |
| `utils` | uploads, Gemini, email consumer | no database | unsafe public catch-all; split into internal capabilities over time |

All three database-using services share the same Neon database and JWT secret. This is therefore a **modular monolith distributed as four services**, with no enforced data ownership.

### External services and deployment

- Neon PostgreSQL through `@neondatabase/serverless`; schemas are created at service startup.
- Redis only stores reset tokens; it is not a session or rate-limit system.
- Kafka only carries the `send-mail` payload; the consumer has no idempotency, retry policy, or dead-letter path.
- Cloudinary receives data-URI uploads through an unauthenticated proxy.
- Gemini produces generic JSON-formatted career and resume responses.
- Dockerfiles exist for each deployment. `docker-compose.yml`, health checks, environment examples, CI, and an API gateway do not exist, despite README claims.

## 3. Current feature map

| State | Features |
|---|---|
| Working (demo level) | Registration/login/reset, roles, profiles and skills, recruiter company/job CRUD, public job browse, job-service application submission, Cloudinary-backed uploads, Kafka-triggered email, Gemini resume/career UI. |
| Broken | `user` application creation writes a user ID into the application primary key; “my applications” filters by `application_id = user_id`, creating an IDOR/data-leak risk; frontend application statuses do not match database values; job detail omits company data; reset email link path differs from the frontend route. |
| Partial | Search has only title/location `ILIKE`; no pagination; recruiter job edit does not surface activation state; upload validation is client-only; AI output is generic/unvalidated; job/application status email does not use a defined lifecycle. |
| Missing | External ingestion, raw/normalized job storage, dedupe, source health, scheduled runs, serious search/ranking, saved jobs, structured candidate/job intelligence, matching, migrations, API documentation, rate limits, CI/tests, Compose, observability, and gateway/BFF. |

## 4. Technical-debt register

### Critical

1. Public `/api/utils/upload`, `/career`, and `/resume-analyzer` endpoints expose storage and paid AI capacity.
2. Application retrieval uses the application primary key in place of applicant identity, allowing wrong-user data exposure.
3. The duplicate user-service application endpoint can corrupt application IDs and contradicts the working job-service endpoint.
4. JWTs are accessible to JavaScript, last 15 days, and cannot be revoked by logout.
5. There is no rate limiting on authentication, upload, or AI endpoints.

### High

1. Open CORS and direct public service exposure; no gateway or internal-service trust boundary.
2. In-memory multipart uploads lack size, MIME, and content-signature validation.
3. `companies.recruiter_id` and `jobs.posted_by_recruiter_id` have no foreign keys to `users`.
4. Startup DDL is not versioned migration history; schema declarations and auth middleware are copied across services.
5. Kafka producers can proceed before initialization; email delivery is not idempotent or observable.
6. No automated tests, CI, environment templates, Compose, health endpoints, structured logs, or request IDs.

### Medium

1. `Submitted/Rejected/Hired` conflicts with frontend `pending/accepted/rejected`; required lifecycle states are also absent.
2. Search full-scans `jobs`, has no stable pagination, and has no filtering/index strategy.
3. Destructive company deletion cascades jobs/applications; no archive/soft-delete model.
4. Generic AI responses have no schema validation, versioned prompt, quota controls, or stored structured result.
5. Remote Next image policy permits every host; frontend TypeScript is non-strict.
6. README makes claims (true microservices, Compose, strict REST) that are not reflected in the repository.

### Low

1. Dead subscription fields, unused imports/dependencies, inconsistent naming/formatting, misleading hero metrics, and a tracked Redis dump.
2. Duplicate `express.json` registration in utils and repeated Dockerfile patterns.

## 5. Proposed JobiFy 2.0 architecture

### Target through Phase 6

```text
Browser / Next.js
       │ HTTPS, same-origin secure session cookie
       ▼
API Gateway / BFF (only public backend surface)
       ├─ Auth & identity module
       ├─ Profile module
       ├─ Jobs module (internal + external search/read model)
       ├─ Applications module
       └─ Career/AI module
                 │
                 ▼
           PostgreSQL (one database, migration-managed)
                 │
       ┌─────────┴──────────┐
       ▼                    ▼
 Redis: rate limits,    Kafka: durable async events only
 refresh/session state  (email initially; ingestion only after proven need)

Ingestion worker (job-domain owned)
 Source adapter → raw capture → deterministic normalization
                → validation → exact/fingerprint dedupe → persistence
                → run/source-health records
       │
 permitted official/public ATS APIs and feeds only
```

The gateway may initially be a small Express BFF/reverse proxy in this repository, not a new infrastructure product. It owns external route shape, CORS, secure cookie/session behavior, request IDs, rate limits, input validation, and error envelopes. Existing domain code can be moved behind it incrementally.

### Future extensions, only after prerequisites

- **Search:** PostgreSQL full-text/trigram search and indexed filters first; add a dedicated search engine only after measured needs exceed PostgreSQL.
- **AI:** an internal career-intelligence module operating on structured candidate/job data; asynchronous analysis events only when synchronous latency or reliability warrants a worker.
- **Matching:** deterministic and explainable score composed of skills, experience, location, work preference, and recency. Embeddings/ML are explicitly deferred.
- **Services:** split an ingestion worker or AI worker into a separately deployed service only when independent schedule/scaling/failure isolation is demonstrated.

## 6. Proposed database evolution

Migrations become the single source of truth. Keep existing internal jobs and companies, but repair them through compatible migrations rather than startup `CREATE TABLE` statements.

| Existing table | Evolution |
|---|---|
| `users` | retain; add consistent timestamps/session/revocation support as chosen in Phase 1; retire unused `subscription` after data assessment. |
| `skills`, `user_skills` | retain; normalize skill names and later add canonical taxonomy identifiers. |
| `companies` | add FK to users, timestamps, archive state; preserve recruiter-created companies. |
| `jobs` | rename conceptually to `internal_jobs` only if a safe compatibility strategy exists; add integer openings, currency-aware salary model, lifecycle timestamps and indexes. |
| `applications` | add `applicant_user_id` FK while preserving email snapshot, replace enum with documented lifecycle (`APPLIED`, `VIEWED`, `INTERVIEW`, `REJECTED`, `HIRED`, `WITHDRAWN`), status history, and appropriate uniqueness. |

New tables are introduced only in the phase that uses them:

| New table | Purpose | Phase |
|---|---|---|
| `schema_migrations` | migration bookkeeping | 2 |
| `auth_sessions` / `refresh_tokens` (chosen design) | secure session revocation/rotation | 1–2 |
| `external_job_sources` | registered source, source type, enabled state, cursor/config reference, policy metadata | 3 |
| `ingestion_runs` | run lifecycle, counts, errors, timestamps | 3–4 |
| `raw_external_jobs` | immutable/minimally changed source payload, source identity, fetch provenance | 3 |
| `external_jobs` | normalized external job record and lifecycle state | 3 |
| `external_job_aliases` | source/canonical URL/fingerprint mappings to a canonical external job | 3 |
| `job_skills` | normalized job-to-skill associations | 8 |
| `candidate_profiles`, `candidate_preferences`, `candidate_experiences`, `candidate_education` | structured candidate intelligence | 9 |
| `job_requirements`, `match_results` | explainable requirements and calculated matches | 8–10 |

Important indexes: unique `(source_id, source_job_id)`, canonical URL where present, content fingerprint, external job lifecycle/recency, `applications(applicant_user_id, applied_at DESC)`, and search/filter indexes chosen from real query plans.

## 7. Job ingestion architecture

```text
Permitted source
  ↓ fetch (official API/feed; source-specific rate policy)
JobSourceAdapter.fetchJobs()
  ↓ retain source record and run context
RawExternalJob
  ↓ adapter.normalize() — deterministic title/location/type/date transforms
NormalizedExternalJob
  ↓ schema/business validation, reject reason recorded
Validated job
  ↓ 1) source + source_job_id  2) canonical URL  3) content hash
     4) bounded deterministic similarity review queue (later)
Canonical external job + aliases
  ↓ transactional upsert and first/last-seen lifecycle updates
PostgreSQL + ingestion metrics
```

Each adapter implements a shared, typed contract: source metadata, fetch, parse/normalize, and source-specific pagination/cursor behavior. Adapters never own database writes, deduplication, or scheduling. The first live adapter must use a documented permitted public endpoint (for example, a company-approved Greenhouse/Lever board) and must comply with its terms, robots rules, rate limits, and attribution/apply-link requirements. CAPTCHA/authentication/bot-protection bypasses are out of scope.

Lifecycle: each successful source run marks encountered records `last_seen_at`; records absent from a successful full run become `NOT_SEEN`; a configurable grace window moves them to `EXPIRED`. Raw history remains for reprocessing. Failed/incomplete runs must never expire jobs.

## 8. Phase plan

| Phase | Objective / features | Services/files and DB/API scope | Tests and definition of done | Complexity / dependencies |
|---|---|---|---|---|
| 0 | Audit and approved blueprint. | Documentation only. | Architecture, risks, baseline verified; no code change. | Complete. |
| 1 | Stabilize security and application integrity: one application workflow; IDOR repair; status contract; auth hardening; protected utils; rate limits; CORS; upload controls; FKs. | Auth/job/user/utils/frontend; compatibility migrations; remove or quarantine duplicate apply route; versioned API contract. | Unit/API tests for authorization, application ownership/status, uploads, rate limits. Existing core flows remain runnable. | High; depends on explicit session/auth decision. |
| 2 | Production foundation: migrations, gateway/BFF, central config, Compose, health/logging/error format, CI/test harness. | Root workspace, deployment configs, all service entry points; schema migration baseline; gateway routes. | CI runs lint/typecheck/test/build; one-command local stack starts and reports healthy. | High; follows Phase 1 contract. |
| 3 | Ingestion foundation, without scheduler. | Job module/worker; external-source migrations and adapter/normalizer/dedupe modules; internal administration APIs only. | Fixture tests for normalization, hashes, exact dedupe, transactional persistence. One source can be represented by fixtures. | High; relies on migrations and job contract. |
| 4 | One permitted live source through manual CLI. | First adapter, `ingest:<source>` command, ingestion run/error logging. | Manual run is idempotent; metrics logged; source failure does not corrupt lifecycle. | Medium; source permission and terms required. |
| 5 | Add sources using the same adapter contract. | Additional adapters/config; no duplicated pipeline. | Contract tests per adapter plus cross-source duplicate fixtures. | Medium; each source independently approved. |
| 6 | Automate ingestion and expiry. | Scheduler/worker, source health, retry policy, stale lifecycle; Kafka only if queued processing is justified. | Retry, failed-run/no-expiry, idempotent rerun and health tests. | Medium-high; stable Phase 4 pipeline required. |
| 7 | Serious external + internal job search. | Search read model/API/UI, indexes and pagination. | Query/filter/sort cursor tests and performance check with realistic fixture volume. | High; enough job data and confirmed UX needed. |
| 8 | Structured job intelligence. | Skill taxonomy, requirements extraction, job quality validation. | Deterministic extraction tests and reviewed AI fallback contract. | Medium. |
| 9 | Candidate intelligence. | Structured profile/resume parsing/preferences and privacy controls. | Parsing, consent, deletion/access-control tests. | High; data policy required. |
| 10 | Explainable matching. | Deterministic scoring module, match results/API/UI. | Golden scoring fixtures and explanation consistency tests. | High; phases 8–9 required. |
| 11 | Context-aware career intelligence. | AI orchestration with structured context, quotas/audit trails. | Prompt/schema/error/authorization tests; manual quality evaluation set. | High; phases 8–10 required. |
| 12 | Useful candidate, recruiter, and system analytics. | Aggregates/dashboards/metrics. | Metric definition tests and privacy review. | Medium; reliable events/data needed. |
| 13 | Production deployment. | HTTPS, secrets, backups, dashboards, alerts, recovery documentation. | Deploy/rollback and restore drills. | High; operational authority required. |
| 14 | Final polish and evidence. | Dead-code removal, docs, ADRs, performance/security review. | All checks green; architecture and operational docs current. | Medium; all prior phases complete. |

## 9. Risk register

| Category | Risk | Mitigation / gate |
|---|---|---|
| Security | Token theft, IDOR, public upload/AI abuse, brute force, unsafe files. | Resolve in Phase 1 before features; secure session design, authorization tests, rate/size/type/signature controls, CORS allowlist. |
| Data quality | Duplicate/incomplete/stale jobs, inconsistent titles/locations, expired listings. | Retain raw data, deterministic normalization, layered identities, run records, grace lifecycle, quality metrics. |
| Sources | Terms/robots violations, API changes, rate limits, source removal. | Only permitted interfaces; per-source policy/config; adapter isolation, backoff, attribution and health tracking. |
| Scalability | Full-scan search, large payloads, synchronous third-party calls, Kafka email duplicates. | Pagination/indexes, payload limits, queues only when justified, idempotency keys and observability. |
| AI | Hallucinated advice/scores, sensitive resume handling, malformed output, runaway cost. | Structured inputs, deterministic scoring where possible, schema validation, quotas, no unsupported claims, retention minimization. |
| Operational | No reproducible local stack, secret leaks, silent worker failure, unsafe migrations. | Compose/env examples, secret manager at deployment, health/metrics/alerts, reversible migrations/backups. |
| Product | Recruiter-created and external jobs become indistinguishable or application flow misroutes users. | Preserve provenance and apply URL; distinguish internal application vs external redirect in API/UI. |

## 10. Architecture decisions to approve before Phase 1

1. **Adopt a gateway/BFF as the sole public backend surface in Phase 2**, keeping internal modules/deployments intact initially.
2. **Use migration-managed PostgreSQL as the sole system of record**; do not introduce another database or search engine yet.
3. **Retire the user-service apply endpoint** after a compatibility assessment, retaining job-service (later application-domain) ownership of applications.
4. **Move to secure, revocable sessions/tokens**; the exact cookie/session implementation is designed in Phase 1 so it matches the gateway rollout.
5. **Begin ingestion with one permitted ATS/public source and manual invocation**, with raw data retention, deterministic normalization, and deterministic dedupe.

## 11. Audit notes

No builds, tests, network calls, migrations, or runtime services were executed during this phase: the repository has no test suite or unified runner, and Phase 0 is documentation-only. The worktree also contains pre-existing unrelated changes (including generated `node_modules` deletions and package-lock modifications); they were not altered.
