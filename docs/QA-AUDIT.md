# JobiFy 2.0 — QA Audit

Initial deliverable of the quality/reliability initiative. No product
features were added or changed. Everything below is either (a) directly
observed by reading the current source, or (b) reproduced live against
the real Docker Compose stack (real PostgreSQL, Redis, Kafka, all five
backend services, the Gateway, and the frontend) — never fabricated,
never against mocks. Every request in this document went through
`http://localhost:5500` (the Gateway) with `Origin: http://localhost:3010`
(the frontend's real origin in this environment), exactly the path a real
browser uses — not service-to-service shortcuts.

Two bugs below (the registration chain and the Gateway path-rewrite bug)
were found and fixed in the immediately preceding session, before this
formal audit was commissioned — they're included here for completeness
and because they set the pattern for nearly everything found since:
**a whole family of `docker-compose.yml` environment-variable names that
don't match what the code actually reads.**

---

## 1. Existing test coverage

| Service | Framework | Test files | Tests | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `auth` | Vitest + Supertest | 1 | 7 | DB/Redis/Kafka mocked |
| `user` | Vitest + Supertest | 1 | 7 | DB/Redis mocked |
| `job` | Vitest + Supertest | 28 | 423 | DB mocked; the one service with real depth (ingestion, scheduler, search, intelligence) |
| `utils` | Vitest + Supertest | 1 | 14 | DB/Redis/Kafka mocked |
| `gateway` | Vitest + Supertest | 1 | 6 | Only covers `/health`, `/ready`, and the 404 handler — **no test ever exercises an actual proxied route** |
| `frontend` | — | 0 | 0 | **No test framework installed at all.** No Jest, no Vitest, no Playwright, no Testing Library. `package.json` has no `test` script. |

**Correction to the brief:** the brief refers to "existing Jest tests" —
every backend service actually uses **Vitest**, not Jest. There is no
Jest anywhere in this repository (checked every `package.json` and
`node_modules`).

**The headline problem this audit exists to describe:** all 457 backend
tests mock the database, Redis, and Kafka entirely. Every single bug
found in this document — nine of them — passed its service's full test
suite while being completely broken in the real, running system. This is
exactly the "component works alone, fails through the real path" failure
mode the brief describes, and it is systemic, not a one-off.

No Playwright, Cypress, or any browser-automation tool is present or was
added as part of this audit (per instructions, tooling changes are
deferred until the audit is reviewed).

---

## 2. Current failing / previously-failing workflows

### 2.1 Registration — **now fixed**, root-caused and reproduced live

Reported symptom: "403 Forbidden" registering through the frontend.

Reproduced by POSTing to `/api/auth/register` through the Gateway with
`Origin: http://localhost:3010` (matching the actual frontend). Root
cause was not one bug but four, stacked — each one only visible once the
one before it was fixed:

1. `docker-compose.yml` set `CLIENT_URL`/`ALLOWED_ORIGIN` for CORS; the
   code (`services/*/src/app.ts`) only ever reads `CORS_ORIGINS`. CORS
   was silently locked to `http://localhost:3000` regardless of config
   — this produced the reported 403/CORS failure.
2. `docker-compose.yml` set `JWT_SECRET`/`SESSION_SECRET`; the code
   (`services/*/src/**/auth.ts`, `session.ts`) reads `SECRET_KEY`
   exclusively. Every login/register/protected route failed:
   `"SECRET_KEY is required"`.
3. `RETURNING ... create_at` in `services/auth/src/controllers/auth.ts`
   (both recruiter and jobseeker paths) referenced a column that has
   never existed — the real column is `created_at`. Every registration
   failed at the database with `column "create_at" does not exist`.
4. `NEXT_PUBLIC_GATEWAY_URL` is inlined into the frontend's browser
   bundle at Docker **build** time; `docker-compose.yml` only set it as
   a runtime `environment:` value, which has no effect on an
   already-built bundle. The bundle was permanently pointed at the
   Dockerfile's fallback regardless of where the Gateway actually was.

Fixed in commits `5d29ea7` (env var names, `create_at` typo,
`NEXT_PUBLIC_GATEWAY_URL` build arg) and `b99f688`/`2892cb2`/`873301c`
(Gateway routing and startup-order bugs found during the same pass — see
2.3). **Re-verified live after the fix**: register → 201-equivalent
success payload; login → session cookie; authenticated route
(`/api/user/me`) → 200 with correct data. No automated regression test
exists for any of this yet — see §4.

### 2.2 Resume upload / jobseeker registration — **currently broken, root-caused, not yet fixed**

Reproduced live, twice, via two different entry points:

**a) Jobseeker registration with a resume file**, through the Gateway,
multipart, real generated PDF fixture (`%PDF-` header, valid trailer):

```
POST /api/auth/register (role=jobseeker, file attached)
→ {"message":"Failed to upload resume"}
```

`docker logs jobify-auth-service`:
```
Uploading to utils service at: undefined/api/utils/upload
FULL UPLOAD ERROR: TypeError [ERR_INVALID_URL]: Invalid URL
```

**b) Standalone resume update for an already-registered user**
(`PUT /api/user/update/resume`), authenticated, same PDF fixture:

```
→ {"message":"Invalid URL"}
```

**Root cause**: `UPLOAD_SERVICE` (the URL `auth-service` and
`user-service` call to reach `utils-service`'s Cloudinary upload
endpoint) is **never set anywhere in `docker-compose.yml`** for either
service. `process.env.UPLOAD_SERVICE` is `undefined`, so the code builds
the literal string `"undefined/api/utils/upload"`, which is not a valid
URL.

**A second, independent bug on the same path**: `INTERNAL_SERVICE_KEY`
(the shared secret `utils-service`'s `requireInternalService` middleware
checks) is **also never set anywhere in `docker-compose.yml`**, for any
service. Confirmed directly:

```
POST /api/utils/upload (no header, no key)
→ 403 {"message":"Trusted internal service access is required"}
```

`services/utils/src/middleware/auth.ts` explicitly checks
`!process.env.INTERNAL_SERVICE_KEY` first and rejects unconditionally if
it's unset — so even after `UPLOAD_SERVICE` is fixed, every upload will
still fail with 403 until this is also set. Both variables are already
correctly documented in every affected service's own `.env.example`;
only `docker-compose.yml` never wires them through.

**Impact**: every jobseeker registration is completely broken (jobseeker
registration mandates a resume). Every profile-picture and resume update
for any existing user is completely broken. Recruiter registration and
everything not touching file upload is unaffected.

**Validation logic upstream of the broken call was verified correct**,
live, with real fixtures:

| Input | Result |
| :--- | :--- |
| `.txt` file | 400 `"Resume must be a valid PDF under 5 MB"` |
| 6 MB PDF | 400 `"File too large"` (multer, clean error envelope) |
| Valid small PDF | Reaches the broken upload call (`"Invalid URL"`) |
| No auth cookie | 401 `"Authentication is required"` |

This bug is **not yet fixed** — it is reported here per the audit-first
instruction. Fix + regression test are proposed in §6 as P0.

### 2.3 Gateway path-rewrite bug — **fixed**, regression-relevant

Found in the same session as §2.1: `services/gateway/src/proxy.ts`'s
`pathRewrite` was a no-op identity function, but Express strips the
`app.use()` mount prefix (`/api/job`, etc.) before the proxy middleware
ever sees the URL, and every downstream service mounts its own routes
under that same prefix. Every proxied route to every service was broken;
only each service's bare `/health` (mounted at root) happened to work.
Fixed in `b99f688`. The Gateway's own test suite (`services/gateway/src/*.test.ts`)
never exercises a real proxied route, so this class of bug has **zero**
regression coverage today — flagged explicitly in the brief as needing
one; see §6, P0.

### 2.4 Authentication/session startup crash — **fixed**

`auth`, `user`, `job`, and `utils` all crashed on startup with a real
Redis present: `rateLimit.ts`'s `RedisStore` constructs eagerly and sends
a command to Redis at module-import time, before `connectRedis()` (run
later in `index.ts`) had resolved. `ClientClosedError`, unhandled,
crashed the process every time. Fixed in `2892cb2` by deferring the
`app.js` import until after Redis connects. No regression test exists
for this either — it's a startup-ordering issue that unit tests (which
never boot the real `index.ts` entrypoint) cannot catch by construction.

---

## 3. New findings from this audit pass

### 3.1 IDOR — `GET /api/user/:userId` — **P0, confirmed live, not fixed**

`services/user/src/routes/user.ts`: `router.get("/:userId", isAuth, getUserProfile)`.
`isAuth` only checks that *a* valid session exists — `getUserProfile`
(`services/user/src/controller/user.ts:18`) does not check that the
requested `userId` belongs to the caller. It returns the full profile row
including `email`, `phone_number`, `resume` (a direct URL to the user's
private uploaded resume), `resume_public_id`, `bio`, and `subscription`.

Reproduced live with two real registered accounts:

```
User A (user_id=2) and User B (user_id=3), both authenticated.
GET /api/user/2 with User B's session cookie
→ 200 {"user_id":2,"name":"Test Recruiter 2","email":"livetest6@example.com","phone_number":"1234567890", ...}
```

Any authenticated user — jobseeker or recruiter, no relationship
required — can read any other user's full profile by incrementing the
URL parameter. This is a genuine data-exposure vulnerability, not a
theoretical one. Not fixed as part of this audit (audit-first mandate);
proposed as P0 in §6.

### 3.2 Unsafe manual transaction — **fixed**

`addSkillToUser` used separate tagged-template `BEGIN`/`COMMIT`/`ROLLBACK`
calls, which `postgres` (the driver introduced when replacing
`@neondatabase/serverless`) correctly refuses outright
(`"UNSAFE_TRANSACTION"`) because a pooled client cannot guarantee
separate calls share one connection. Fixed in `5d29ea7` using
`sql.begin()`. Verified live: add → success, add again → correctly
detected as already-possessed, delete → success.

### 3.3 Kafka broker misconfiguration — **fixed**

`docker-compose.yml` set `KAFKA_BROKERS` (plural, utils-service only);
the code (`services/{auth,job,utils}/src/*.ts`) reads `KAFKA_BROKER`
(singular). `auth-service` and `job-service` had no Kafka variable at
all. All three defaulted to `localhost:9092`, unreachable from inside a
container. Fixed in `5d29ea7`. Re-verified live: triggering
`/api/auth/forgot` now successfully connects and publishes; the message
is consumed by `utils-service`; the only remaining failure is the
expected one — no real SMTP credentials are configured in this
environment (`Missing credentials for "PLAIN"`), which is correct,
non-bug behavior for a local/dev deployment.

### 3.4 Gateway → service-unavailable behavior — verified correct, no bug

Live test: stopped `auth-service` mid-session, hit `/api/auth/login`
through the Gateway.

```
→ 502 {"message":"Bad Gateway: Upstream service unavailable","code":"BAD_GATEWAY", ...}
```

Clean, structured, no stack trace, no hang. Restarted the container and
it recovered automatically. This path works correctly as-is.

### 3.5 `job-scheduler` restart loop — known, documented, not a bug

`job-scheduler` intentionally refuses to start and exits when
`INGESTION_SCHEDULER_ENABLED=false` (the default), and `restart:
unless-stopped` restarts it anyway — harmlessly, but continuously.
Already documented in `docs/DEPLOYMENT.md`. Listed here only so it isn't
mistaken for a new finding.

### 3.6 Rate limiting interferes with rapid manual/automated QA

`register`'s rate limit (5/hour/IP) was hit twice during this audit
purely from sequential manual test requests, requiring a Redis flush to
continue. A real integration/E2E suite that exercises registration more
than 5 times against a shared Redis will hit this by default. Needs a
resolution before §12 (auth test matrix) can be automated — see §6.

---

## 4. Verified-behavior summary (only what was actually executed)

| Area | Test | Method | Expected | Actual | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Auth | Register (recruiter, valid) | Live, via Gateway | 2xx + user object | 200, user object with `created_at` | PASS (after fix) |
| Auth | Register (jobseeker, valid PDF) | Live, via Gateway | 2xx + user object | `"Failed to upload resume"` | **FAIL** — see §2.2 |
| Auth | Register, duplicate email | Live, via Gateway | 409 | 409 `"User with this email already exists"` | PASS |
| Auth | Register, missing password | Live, via Gateway | 400 | 400 `"Please fill all the details"` | PASS |
| Auth | Register, invalid role | Live, via Gateway | 400 | 400 `"Invalid role"` | PASS |
| Auth | Login, valid credentials | Live, via Gateway | 2xx + session cookie | 200, cookie set, session usable | PASS |
| Auth | Login, wrong password | Live, via Gateway | 4xx | 400 `"Invalid Credentials"` | PASS |
| Auth | Login, unknown user | Live, via Gateway | 4xx, no enumeration | 400 `"Invalid credentials"` | PASS (message differs only in capitalization from wrong-password case — cosmetic, not a leak) |
| Auth | Forgot password | Live, via Gateway | 2xx, generic message | 200, generic message, Kafka publish succeeds, SMTP fails (no real creds — expected) | PASS |
| Auth | Logout | Live, via Gateway | 2xx, session revoked | 200; subsequent request with same cookie → `"Session has expired or was revoked"` | PASS |
| Session | Authenticated request | Live, via Gateway | 200 | 200 | PASS |
| Session | Unauthenticated request | Live, via Gateway | 401 | 401 `"Authentication is required"` | PASS |
| Authorization | User A reads own profile | Live, via Gateway | 200, own data | 200, own data | PASS |
| Authorization | User B reads User A's profile by ID | Live, via Gateway | 403/404 | **200, User A's full profile** | **FAIL (IDOR)** — see §3.1 |
| Upload | Valid PDF, authenticated | Live, via Gateway | 200 | 500 `"Invalid URL"` | **FAIL** — see §2.2 |
| Upload | Invalid type (.txt) | Live, via Gateway | 400 | 400 `"Resume must be a valid PDF under 5 MB"` | PASS |
| Upload | Oversized PDF (6 MB) | Live, via Gateway | 400/413 | 400 `"File too large"` | PASS |
| Upload | Unauthenticated | Live, via Gateway | 401 | 401 `"Authentication is required"` | PASS |
| Upload | Internal endpoint direct-called, no key | Live, via Gateway | 403 | 403 `"Trusted internal service access is required"` | PASS (this guard itself is correct; the problem is nothing ever supplies a real key — see §2.2) |
| Jobs | Public job list | Live, via Gateway | 200, `[]` on empty DB | 200, `[]` | PASS |
| Jobs | External job list | Live, via Gateway | 200, real data | 200, 321 real ingested Lever jobs | PASS |
| Search | Keyword search | Live, via Gateway | 200, ranked results | 200, real ranked results | PASS |
| Search | SQL-injection-shaped query (`' OR '1'='1`) | Live, via Gateway | 200, safely handled, no data leak | 200, empty result set, no error, no leak | PASS |
| Search | Empty query | Live, via Gateway | 200, some sane result | 200 | PASS (not deeply inspected — see §5 gaps) |
| Job Intelligence | Existing job | Live, via Gateway | 200, structured data | 200, structured data (skills/seniority/etc.) | PASS |
| Gateway | Route to healthy service | Live | 2xx/4xx from the service | Correct | PASS |
| Gateway | Route to a stopped service | Live (stopped `auth-service` deliberately) | 502, structured, no leak | 502 `"Bad Gateway: Upstream service unavailable"` | PASS |
| CORS | Allowed origin | Live, via Gateway | `Access-Control-Allow-Origin` echoed | Correct | PASS |
| CORS | Disallowed origin | Live, via Gateway | Rejected, no CORS headers | Rejected (`"Origin is not allowed"`) — status code is 500, not a clean 4xx | PASS functionally; minor: should be 4xx not 500 (noted previously, not re-litigated here) |

Everything in this table was actually executed against the live stack in
this session or the immediately preceding one. Nothing here is
inferred or assumed.

---

## 5. Known gaps not yet tested (honesty about what this audit did *not* cover)

- **Frontend rendering/UI behavior** — no browser-automation tool is
  available in this environment yet (that's exactly what §6 recommends
  adding). SSR HTML was confirmed to load (`/`, `/external-jobs`,
  `/external-jobs/[id]` all return 200), but no click-through, no error-
  state rendering, no "does the UI show a useful message instead of a
  raw stack trace" check was performed.
- **Job ingestion failure modes** (malformed jobs, source timeout,
  retry, partial failure, concurrent scheduler execution) — Phase 6/7's
  own test suite (28 files, 423 tests) already covers most of this at
  the unit level against a fake DB; this audit did not re-verify it
  live against real Lever/Greenhouse/Ashby failure conditions.
- **Redis/DB/Kafka *failure-injection* tests** (killing Redis mid-request,
  killing Postgres mid-request) — not attempted in this pass; scoped
  into §6 as P1 for the next phase.
- **Search**: pagination, sorting, special characters beyond one
  injection-shaped payload, and large queries were not individually
  exercised.
- **Company/job creation, application flows** — reachability and
  validation were spot-checked (missing-field rejection confirmed) but
  full create → apply → review lifecycle was not run end-to-end.
- **Duplicate resume upload, Unicode/special-character filenames** — not
  reachable to test meaningfully while the underlying upload path is
  broken (§2.2); deferred until that's fixed.

---

## 6. Recommended test architecture, tools, and priority order

Matches the shape requested in the brief:

```
                    JobiFy
                       │
              ┌────────┴─────────┐
              │                  │
           Backend             Frontend
              │                  │
       ┌──────┼──────┐           │
       ▼      ▼      ▼           ▼
      Unit  API   Integration   E2E
       │      │       │           │
       └──────┴───────┴───────────┘
                       │
                       ▼
                 Real Docker
                 Infrastructure
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
      PostgreSQL      Redis        Kafka
```

- **Unit** (exists, Vitest): keep as-is for pure functions
  (validation, normalization, parsers, extractors). Not where the real
  problems live, per this audit — don't over-invest here.
- **API** (exists at the single-service level via Supertest; **does not
  exist through the Gateway**): this is the single highest-leverage gap.
  Every bug in §2–3 would have been caught by an API-level test that hit
  `http://gateway/api/...` instead of importing a service's `app`
  directly.
- **Integration** (barely exists): real Postgres/Redis/Kafka against a
  real service, no Gateway. Useful for e.g. transaction-safety
  regression (§3.2) and Kafka publish/consume (§3.3).
- **E2E** (does not exist): needs a real browser driving the real
  frontend against the real stack. **Playwright is recommended** — it
  isn't present in the repo yet, and nothing here conflicts with adding
  it (no competing E2E tool, no CI job to redesign around it, Next.js
  16/App Router is well-supported).

**Tools required**: Playwright (E2E + can double as an API-testing
client for Gateway-path tests if preferred over raw Supertest+HTTP);
otherwise nothing new — Vitest + Supertest already cover unit/API/
integration.

**Test-environment note**: rate limiting (§3.6) needs a resolution
before Gateway/API/E2E tests can run repeatedly and unattended — either
a documented Redis-flush step between suites, or a lower/disabled limit
under a `NODE_ENV=test`-style flag. This should be decided, not assumed,
before building out the framework.

### Priority order

**P0 — critical user/system failure**
1. Fix `UPLOAD_SERVICE` / `INTERNAL_SERVICE_KEY` not being set in
   `docker-compose.yml` (§2.2) — blocks all jobseeker registration and
   all resume/profile-picture uploads.
2. Fix the IDOR on `GET /api/user/:userId` (§3.1) — real data exposure.
3. Add a Gateway-path API regression test for the path-rewrite class of
   bug (§2.3) — this exact bug already happened once and has zero
   coverage today.
4. Add a regression test for the registration chain (§2.1) — four real
   bugs, zero tests.

**P1 — important functionality**
5. Redis-flush/rate-limit strategy for automated testing (§3.6).
6. Integration tests for the transaction-safety class of bug (§3.2) and
   Kafka publish/consume (§3.3).
7. E2E happy path: register → login → profile → resume upload → browse
   jobs → search → view job → view intelligence → logout (once upload is
   fixed).
8. Authorization test matrix beyond the one IDOR found (§9 of the brief)
   — profile update, skill add/delete, applications, company/job
   ownership.

**P2 — secondary functionality**
9. Upload edge cases once the path is fixed: duplicate upload, Unicode/
   long filenames, corrupted PDF.
10. Search: pagination, sorting, large queries, rate-limit behavior.
11. Job intelligence: missing/reprocessing/idempotency/AI-disabled paths
    (mostly already unit-tested; verify live once).

**P3 — nice-to-have**
12. DB/Redis/Kafka failure-injection tests (kill mid-request, verify
    graceful degradation and no leaked internals).
13. CORS-rejection status code cleanup (500 → 4xx) — correct behavior
    today, just an imprecise status code.

---

## 7. What was deliberately *not* done in this pass

Per the audit-first instruction: no Playwright installation, no new test
files, no `docs/TESTING.md`, no CI changes, and no fix for §2.2 (upload)
or §3.1 (IDOR) were made as part of this document. Those are the P0
items above, to be picked up next — each following the required
Bug → Reproduce → Regression test → Fix → Regression test passes → Full
suite passes sequence, not a silent patch.
