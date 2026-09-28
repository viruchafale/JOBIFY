# JobiFy 2.0 — Deployment Guide

This is the production deployment runbook for the system as it actually
exists (Phases 1–8). It does not introduce new infrastructure, new
services, or new architecture — it documents how to run the existing
`docker-compose.yml` stack in a real environment, plus everything that
had to be fixed to make that stack actually work end-to-end.

**Scope note:** this guide covers Phases 1–8 only (auth, jobs, ingestion,
search, job intelligence). Candidate intelligence, resume matching,
recommendations, embeddings, auto-apply, and the personal job agent
(Phases 9–12) are not implemented and are out of scope here.

## Architecture

One Gateway (Express, `http-proxy-middleware`) in front of four internal
services, backed by Postgres, Redis, and Kafka:

```
Internet → Gateway :5000 → auth-service :5001
                          → user-service :5002
                          → job-service  :5003 ── job-scheduler (same image, ingestion cron)
                          → utils-service:5004 ── job-intelligence-worker (same image, poll loop)
         Frontend (Next.js) :3000 ────────────→ Gateway (browser + SSR calls)

Postgres :5432 ── Redis :6379 ── Kafka :9092/29092 (+ Zookeeper)
```

Only the Gateway and the Frontend are meant to be internet-facing. Postgres,
Redis, Kafka, and the four internal services communicate over the Docker
network and should never be exposed to the internet directly.
`job-scheduler` and `job-intelligence-worker` are the same `services/job`
image as `job-service`, started with a different `command:` — not separate
microservices (see `docs/operations.md` and
`docs/architecture/PHASE-8-JOB-INTELLIGENCE.md`).

## Prerequisites

- Docker + Docker Compose v2 on the host (or a container platform that can
  run the same images — ECS, Cloud Run, a VM, etc.)
- A reachable PostgreSQL 16 instance (see **Database setup** — this can be
  the bundled `postgres` container, a managed Neon database, or any
  standard Postgres)
- A reachable Redis 7 instance (the bundled `redis` container is fine for
  a single-host deployment)
- A reachable Kafka broker (the bundled `kafka`/`zookeeper` containers are
  fine for a single-host deployment; only `utils-service` and
  `auth-service`/`job-service` producers depend on it, for email delivery)
- Cloudinary account (file uploads), SMTP or Gmail credentials (email),
  optionally a Google Gemini API key (only if you want AI-assisted job
  intelligence — the system is fully functional without one)

## Environment variables

Copy `.env.example` (root) to `.env` and every `services/*/.env.example`
to `services/*/.env`, then fill in real values. **Never commit a filled
`.env` file** — `.gitignore` already excludes `.env` and `*.pem`.

Two variables have no safe default and **must** be set to real random
values before any real deployment — Docker Compose's fallback values
(`supersecretjwtkey`, `supersecretsessionkey`) exist only so the stack
can boot for local smoke-testing, not for production use:

```bash
openssl rand -hex 64   # JWT_SECRET
openssl rand -hex 64   # SESSION_SECRET
openssl rand -hex 32   # INTERNAL_SERVICE_KEY (shared across all services)
```

If you deploy `auth-service`, `user-service`, and `job-service` outside
Docker Compose (e.g. directly on a VM or a serverless platform), set
`DB_URL` — not `DATABASE_URL` — to the Postgres connection string; that is
the variable name `services/{auth,user,job}/src/utils/db.ts` actually
reads. The ingestion/intelligence one-off scripts under
`services/job/src/ingestion/scripts/` and `src/intelligence/scripts/`
accept either name.

## Database setup

The database driver is `postgres` (porsager/postgres), a standard
Postgres-wire-protocol client — it works against the bundled `postgres`
container, a self-hosted Postgres, RDS, or a real Neon database's
standard connection string (`...?sslmode=require`).

> **Migration note:** this codebase originally used
> `@neondatabase/serverless`'s HTTP-only driver, which only works against
> Neon's HTTPS proxy endpoint and cannot reach a plain Postgres server —
> it does not work with the bundled `postgres` container or any other
> self-hosted Postgres. It has been replaced with `postgres` everywhere
> (`services/{auth,user,job}/src/utils/db.ts`, `database/scripts/migrate.mjs`,
> and every ingestion/intelligence CLI script) specifically so this stack
> can run against the Postgres it ships with. See **Known limitations**
> in the final report for what else this touched.

## Migration process

Migrations are plain SQL files in `database/migrations/`, applied in order
by `database/scripts/migrate.mjs` (idempotent — tracks applied versions in
a `schema_migrations` table, safe to re-run).

```bash
cd database
DB_URL=postgres://user:pass@host:5432/jobify npm install postgres
DB_URL=postgres://user:pass@host:5432/jobify node scripts/migrate.mjs up
# or: node scripts/migrate.mjs status
```

In Docker Compose this runs automatically as the one-shot `migration`
service; every other service's `depends_on: migration: condition:
service_completed_successfully` blocks until it exits 0.

## Redis setup

Any Redis 7-compatible instance works. Used for: session/rate-limit
counters in every service, and the Phase 7 search rate limiter. No
persistence requirements beyond what's needed for rate-limit accuracy —
losing Redis data on restart just resets counters, it does not lose
application data.

## Kafka setup

Used for asynchronous email delivery (`utils-service` consumer,
`auth-service`/`job-service` producers). If you don't need email
notifications immediately, the bundled `kafka`/`zookeeper` containers are
sufficient; there's no external Kafka dependency required.

## Backend deployment

Build and run each service's Docker image (`services/{auth,user,job,utils,gateway}/Dockerfile`)
exactly as `docker-compose.yml` does. All four internal services expose
`GET /health` at their container root (not behind `/api/*`) for container
health checks — this is intentionally separate from the Gateway's own
`GET /health`, which is the externally relevant one.

```bash
docker compose build
docker compose up -d
```

If you're not using Docker Compose, replicate its `environment:` blocks
per service (`DB_URL`, `REDIS_URL`, `JWT_SECRET`, `SESSION_SECRET`,
`CORS_ORIGINS`, `INTERNAL_SERVICE_KEY`, etc. — see each
`services/*/.env.example`).

## Frontend deployment

`frontend/Dockerfile` produces a standalone Next.js production build.
`NEXT_PUBLIC_GATEWAY_URL` is a **build-time** value (Next.js inlines
`NEXT_PUBLIC_*` vars into the client bundle) — if the Gateway's public
URL differs between build and deploy environments, pass it as a Docker
build arg / rebuild the image rather than relying on the runtime
`environment:` entry in `docker-compose.yml` to change already-built
browser-side behavior.

## Worker deployment

`job-intelligence-worker` is the `services/job` image running
`node dist/intelligence/scripts/worker.js` — a polling loop
(`INTELLIGENCE_WORKER_INTERVAL_MS`, default 60s) that processes any
`external_jobs` without up-to-date intelligence. Stateless, safe to run
as a single replica; idempotent by `content_fingerprint` if you ever run
more than one.

## Scheduler deployment

`job-scheduler` is the `services/job` image running
`node dist/ingestion/scripts/run-scheduler.js`. **It refuses to start**
(logs a message and exits) unless `INGESTION_SCHEDULER_ENABLED=true` —
this is intentional (see `docs/operations.md`), but combined with
`restart: unless-stopped` it means the container will keep restarting
(harmlessly — no ingestion runs, no resource leak, Docker backs off
retries) for as long as the scheduler is deliberately left disabled,
which is the default. This is expected, not a crash; set
`INGESTION_SCHEDULER_ENABLED=true` and `INGESTION_SCHEDULES` once you
have real sources to schedule. Per-source overlap (across restarts, crashes,
or multiple replicas) is prevented by the DB-backed lock in
`ingestion_locks`, not by there being exactly one process — see
`docs/architecture/PHASE-6-SCHEDULING-RELIABILITY.md`.

## Domain setup

No domain is registered or configured for this deployment. Point your own
domain's DNS at wherever you host the Gateway and Frontend containers
(A/AAAA record, or a CNAME to your host/load balancer), then set
`CORS_ORIGINS` (Gateway and every backend service) and
`NEXT_PUBLIC_GATEWAY_URL` (Frontend, at build time) to the real HTTPS
URLs. Until a domain exists, use your hosting provider's temporary URL —
do not hardcode a placeholder domain anywhere.

## HTTPS

None of the application containers terminate TLS themselves. Put a
reverse proxy or your cloud provider's load balancer (which most managed
container platforms provide by default) in front of the Gateway and
Frontend containers to terminate HTTPS, and keep the origin-to-container
hop on the private network. Do not expose Gateway port 5000 or Frontend
port 3000 directly to the internet without TLS in front of them.

## Health checks

| Target | Endpoint | Used for |
| :--- | :--- | :--- |
| Gateway | `GET /health` | External/LB health check |
| Gateway | `GET /ready` | Readiness |
| auth/user/job/utils-service | `GET /health` (container-internal) | Docker healthcheck, not proxied |
| `job-scheduler` | `npm run ingest:health` (`services/job`) | Reads `ingestion_source_health`; exits non-zero if any source is unhealthy — safe as an external liveness probe |

## Monitoring

No new observability stack was introduced (per the explicit
"don't over-engineer" scope for this pass). Every service already emits
structured JSON logs (see `requestTracker` middleware and the
`ingestion`/`intelligence` event logs used throughout Phases 6–8) — ship
those to whatever log aggregation your host already provides (CloudWatch,
a `docker logs` driver, etc.) rather than standing up a new pipeline.

## Backups

Not configured as part of this pass — no managed database with automatic
backups has been provisioned in this environment. If you deploy against a
managed Postgres (Neon, RDS, Cloud SQL), enable that provider's automatic
backup/point-in-time-recovery feature; if you run the bundled `postgres`
container in production, you are responsible for backing up the
`pgdata` volume yourself (e.g. periodic `pg_dump`).

## Rollback procedure

1. `docker compose down` the affected service(s) (not the whole stack,
   unless the failure is systemic).
2. Re-deploy the previous image tag / previous commit's build.
3. Database migrations in this system are additive/forward-only (no
   `down` migrations exist) — a code rollback does not need a matching
   schema rollback unless the failed migration itself was the problem, in
   which case restore from a backup taken before it ran.

## Troubleshooting

- **A service is "unhealthy" and dependents never start**: check
  `docker logs <container>`. Two real issues were found and fixed while
  verifying this stack (see the final report's Verification section) —
  a Redis-store initialization race at startup, and a Gateway
  proxy-path bug — both now fixed; if you see either symptom recur after
  further changes, check `services/*/src/index.ts` (app import must stay
  deferred until after `connectRedis()` resolves) and
  `services/gateway/src/proxy.ts` (`pathRewrite` must re-add the stripped
  mount prefix).
- **Migration container never exits**: the `postgres` driver holds an open
  connection; `database/scripts/migrate.mjs` must call `sql.end()` after
  `up()`/`status()` resolves, or the container (and everything gated on
  `service_completed_successfully`) will hang indefinitely.
- **Port conflicts on a shared host**: `docker-compose.yml`'s `DB_PORT`,
  `REDIS_PORT`, `GATEWAY_PORT`, and `FRONTEND_PORT` are all overridable via
  environment variables specifically so this stack can coexist with other
  projects on the same machine.
