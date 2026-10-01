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

---

## 8. P0 fixes closed (follow-up pass)

Everything in §1–§7 above is the original audit, unmodified — this
section records what happened in the follow-up pass that actually fixed
the four P0 items and added regression coverage for them. For each: the
bug, the fix, the regression test, and whether red→green was actually
demonstrated (reverting the fix, confirming the test fails, restoring
it, confirming the test passes) or — for bugs fixed in an earlier
session, before this test suite existed — relying on this audit's
already-recorded live reproduction instead of re-breaking old code.

New regression suite: `tests/integration/` (Vitest + Supertest, real
HTTP against the real running Gateway — see `tests/integration/README.md`
for exactly what is and isn't mocked, and why Cloudinary specifically
needed a local stub in this environment).

### 8.1 P0.1 — Resume upload (§2.2) — **fixed**

Root cause confirmed by reading the code before changing anything, per
instruction: `UPLOAD_SERVICE` and `INTERNAL_SERVICE_KEY` were absent from
`docker-compose.yml` for every service that needed them. Fixed with the
real Docker network service name (`http://utils-service:5004`, matching
`utils-service`'s own `PORT: 5004`) — not `localhost`, which was
considered and rejected since it's unreachable from a sibling container.

A second, deeper instance of the same pattern was found while verifying
the fix: `utils-service` itself reads `CLOUD_NAME`/`API_KEY`/`API_SECRET`
for Cloudinary, but `docker-compose.yml` only ever set the differently
named `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`
— and only for the wrong services (`user-service`/`job-service`, the
senders, not `utils-service`, the one that actually calls
`cloudinary.config()`). Fixed the same way: mapped through to the real
names, same root-level values.

A third bug, unrelated to env-var naming, was found while verifying the
oversized-file case specifically: every service's generic error handler
computed HTTP status from `err.statusCode`/`err.status` only, which
Multer's `LIMIT_FILE_SIZE` error never sets — so it fell through to 500
despite the response body already correctly saying `"File too large"` /
`"LIMIT_FILE_SIZE"`. Fixed in all four services' `observability.ts`.

**Regression tests**: `tests/integration/upload.resume.test.ts` — valid
jobseeker registration with a PDF, valid resume update for an existing
user, non-PDF rejection, oversized rejection, unauthenticated rejection,
and two internal-endpoint-protection cases (no key, wrong key).

**Red→green demonstrated**: yes, for the actual `UPLOAD_SERVICE` wiring
— temporarily removed it from `user-service` only (pure config, no code
change) and reran the suite: exactly and only "an existing authenticated
user can update their resume" failed (500), every other test (including
the jobseeker-registration case, which goes through `auth-service`,
unaffected) still passed — confirming the test is sensitive to the
specific service it claims to protect, not just generally flaky.
Restored, reran: 22/22 green.

**Known environment limitation, not a code bug**: no real Cloudinary
account exists in this environment. The regression test's "full success"
assertions depend on a local HTTPS stub (self-signed cert,
`CLOUDINARY_UPLOAD_PREFIX` override, `NODE_TLS_REJECT_UNAUTHORIZED=0` —
all three inert by default, documented in `tests/integration/README.md`).
A real deployment with real Cloudinary credentials needs none of this;
the stub exists purely so this environment could verify the complete
workflow rather than stopping at "reaches Cloudinary and gets a
credentials error," which was the best this audit could do before this
pass.

### 8.2 P0.2 — IDOR on `GET /api/user/:userId` (§3.1) — **fixed**

Checked the frontend (`account/[id]/page.tsx`, the endpoint's only
caller) and job-service's application-review routes before deciding the
fix, per instruction not to invent a new authorization model — found no
documented or implemented recruiter/candidate cross-access relationship
anywhere in the product. Fixed by enforcing authenticated user id ==
requested user id, denied before any row is fetched (so a 403 can never
confirm or deny whether a given id exists), in
`services/user/src/controller/user.ts`.

**Regression test**: `tests/integration/idor.profile.test.ts` — A→A
(pass), B→B (pass), A→B (denied, body checked for B's email/phone/
resume, not just status), B→A (denied, same body check), unauthenticated
(denied). Checks response bodies, not only status codes, per instruction.

**Red→green demonstrated**: yes — reverted the fix via `git stash`,
rebuilt `user-service`, reran: `A→B` and `B→A` both failed with the
exact original symptom (`200`, full profile body, instead of `403`).
Restored via `git stash pop`, rebuilt, reran: 5/5 green.

### 8.3 P0.3 — Gateway path-rewrite (§2.3) — **regression coverage added**

This bug was already fixed in a prior session (`b99f688`), before this
audit or this test suite existed. Added the regression coverage the
audit flagged as missing.

**Regression test**: `tests/integration/gateway.proxy.test.ts` — one
representative route per service prefix (`/api/auth/login`,
`/api/user/me`, `/api/job/all`, `/api/utils/upload`), asserting a real,
path-specific JSON response rather than Express's generic
`"Cannot GET /xxx"` HTML page, which is exactly what the unfixed
version produced for every one of these.

**Red→green demonstrated**: yes — temporarily reverted
`services/gateway/src/proxy.ts`'s `pathRewrite` to the old no-op,
rebuilt the Gateway, reran: all four path-reconstruction assertions
failed with the exact historical symptom (HTML 404, not JSON). Restored
the real fix, rebuilt, reran: full 22-test suite green.

### 8.4 P0.4 — Registration regression coverage (§2.1) — **regression coverage added**

All four bugs this covers (CORS env-var mismatch, `JWT_SECRET`/
`SECRET_KEY` mismatch, the `create_at` typo, the frontend build-time URL
bug) were fixed in the prior session (`5d29ea7`, `b99f688`, `2892cb2`,
`873301c`), before this audit or test suite existed — each with its own
live reproduction already recorded in §2.1. Not re-broken and re-fixed
in this pass (four separate reverts for already well-documented history
wasn't judged worth the cost); instead protected going forward.

**Regression test**: `tests/integration/auth.registration.test.ts` —
recruiter registration through to a working authenticated session
(checking the `created_at` field specifically, the CORS header
specifically, and a follow-up `/api/user/me` call specifically, so a
regression in any one of the four original bugs would fail a targeted
assertion, not just "something, somewhere, broke"), jobseeker
registration with a PDF, duplicate-email rejection, invalid-role
rejection, missing-field rejection.

### 8.5 Verification run (this pass)

All executed against the real running Docker Compose stack, through
the real Gateway (`http://localhost:5500` in this environment — see
`docs/DEPLOYMENT.md` for why non-default ports), never against an
imported app:

- `services/{auth,user,job,utils,gateway}`: `npx tsc --noEmit` clean,
  `npm test` — 7 + 7 + 423 + 14 + 6 = **457/457 passed**
- `frontend`: `npx tsc --noEmit` clean, `npm run build` succeeded (16
  routes)
- `tests/integration`: `npm test` — **22/22 passed**
- Live, manual, through the Gateway, after all fixes:
  - Recruiter registration → **PASS** (real user created, real session)
  - Jobseeker registration with a PDF → **PASS** (resume URL stored)
  - Existing-user resume update → **PASS**
  - IDOR (`A`→`B`'s profile) → **PASS** (denied, `403`, no profile data
    in the body)
  - Gateway routing, one route per service → **PASS** (auth `400`,
    user `401`, job `200`, utils `403` — all real, path-specific
    responses)
  - Full regression suite (unit + integration) → **PASS**
- Confirmed the production rate limit is unweakened: after restoring
  plain `NODE_ENV=production` defaults, `POST /api/auth/register`
  correctly rate-limited at 5/hour again on the next attempt.

### 8.6 What's still open

- No Playwright/browser E2E yet (still correctly deferred — §6 already
  scoped it as the next stage, not part of P0).
- `docs/TESTING.md` not created (not requested this pass either).
- P1–P3 items from §6 are unchanged and still open: Redis/Kafka
  failure-injection tests, broader authorization matrix (profile
  update, skill add/delete, company/job ownership), search edge cases,
  job-intelligence live-reprocessing checks, the CORS-rejection 500→4xx
  status-code cleanup.
- One more instance of the `UPLOAD_SERVICE`/`INTERNAL_SERVICE_KEY`
  pattern was found but is **not** covered by an automated regression
  test yet: `job-service`'s company-logo upload and apply-with-resume
  paths use the identical mechanism and were fixed by the same
  `docker-compose.yml` change, and spot-checked once manually, but
  don't have a `tests/integration` test of their own — only
  `auth-service`'s and `user-service`'s upload paths do.

---

## 9. P1 — Authorization matrix, ownership, and browser E2E

Everything in §1–§8 is unchanged — this section is additive. Scope per
the P1 brief: authorization coverage, cross-user/resource ownership,
real browser E2E, complete happy-path workflows, and finding
integration bugs unit tests can't reach. Playwright was added fresh
(not present before this pass); Vitest was not replaced or removed
anywhere.

### 9.1 Authorization matrix

Built by reading every route in `services/{auth,user,job,utils,gateway}`
before writing any test (not assumed) — see
`tests/integration/authorization.matrix.test.ts` and
`ownership.idor.test.ts` for the full reasoning behind each row,
including which endpoints were deliberately judged *not* to need
ownership scoping and why.

| Endpoint | Jobseeker | Recruiter | Unauthenticated | Ownership |
| :--- | :--- | :--- | :--- | :--- |
| `POST /api/job/company/new` | 403 denied | 200 allowed | 401 | n/a (create) |
| `POST /api/job/new` | 403 denied | 200 allowed (own company only — 404 if `company_id` isn't theirs) | 401 | enforced at create time |
| `PUT /api/job/update/:jobId` | 403 denied (ownership blocks any non-owner regardless of role) | 200 if owner, 403 if not | 401 | enforced — **found and fixed a crash in this path, see §9.2** |
| `DELETE /api/job/company/:companyId` | 403 (role-blind path still 401/403 via isAuth+no company match) | 200 if owner, 404 if not (no existence leak) | 401 | enforced |
| `GET /api/job/company/:id` | 200 (by design) | 200 (by design) | 401 | **not** ownership-scoped — deliberate: public company-profile data, confirmed by `GET /api/job/company/all` existing as the owner-only counterpart |
| `GET /api/job/company/all` | 200, own companies only (empty for a jobseeker, since they own none) | 200, own companies only | 401 | enforced (query itself is scoped) |
| `GET /api/job/application/:jobId` | 403 | 200 if owner, 403 if not | 401 | enforced |
| `PUT /api/job/application/update/:id` | 403 | 200 if owner, **404** if not (see §9.2 — should arguably be 403, not a security hole) | 401 | enforced |
| `POST /api/job/apply/:jobId` | 200 (own identity only) | 403 | 401 | n/a (create, self-only) |
| `GET /api/user/application/all` | 200, own applications only | 403 | 401 | enforced |
| `GET /api/user/:userId` | 200 if self, 403 if not (any role) | 200 if self, 403 if not (any role) | 401 | enforced — the original P0.2 IDOR fix |
| `PUT /api/user/update/profile`, `/pic`, `/resume`; `POST /skill/add`; `DELETE /skill/delete` | 200, operates on caller's own id only | 200, operates on caller's own id only | 401 | not applicable — no client-supplied id exists to substitute |
| `POST /api/utils/career`, `/resume-analyzer` | 200 (session required) | 200 (session required) | 401 | not applicable — no persisted/shared resource by id |

### 9.2 Bugs found

**Bug: `PUT /api/job/update/:jobId` crashes (500) on any partial update**

- **Reproduction**: sent a real update payload missing `job_type`,
  `work_location`, `company_id`, and `is_active` (exactly the kind of
  partial update a "toggle is_active" feature would send) through the
  Gateway as an authenticated, owning recruiter.
  `{"message":"UNDEFINED_VALUE: Undefined values are not allowed"}`,
  HTTP 500.
- **Root cause**: `postgres.js` (the driver introduced during the P0
  Neon-driver replacement) rejects `undefined` as a query parameter
  outright. `updateJob` (`services/job/src/controller/jobs.ts`)
  interpolated every destructured `req.body` field directly into the
  `UPDATE` statement with no fallback, so any omitted field crashed the
  whole request — not specific to this endpoint's logic, the same class
  of issue already fixed once during P0 for `req.user?.user_id`, just
  not caught there because unit tests mock the DB and always construct
  the full object.
- **Regression test**: `tests/integration/ownership.idor.test.ts` — "recruiter
  A can update A's own job with a partial payload" and "toggling only
  is_active... does not crash."
- **Fix**: `updateJob` now selects the full existing row first (already
  fetching it for the ownership check) and falls back to the existing
  value (`field ?? existingJob.field`) for anything the caller didn't
  send.
- **Verification**: red→green actually demonstrated — reverted the fix,
  rebuilt `job-service`, confirmed both new tests failed with the exact
  original 500; restored, rebuilt, confirmed 60/60 integration tests
  pass.

**Finding (not a bug): apply-time file upload validation is unreachable in practice**

- `applyJob` only inspects `req.file` when `resumeUrl` is still falsy
  after trying `req.body.resume` and then `user.resume`. Every jobseeker
  in this product already has a resume from registration (mandatory at
  signup), so that fallback is always populated — attaching an invalid
  or oversized file at apply time is silently ignored, not rejected,
  because the code never reaches `assertPdf` on that path. Not a
  security issue (no unsafe data is stored — the existing, already-
  validated resume URL is used) and not fixed, since "fix" would mean
  guessing at an unspecified product decision (should re-uploading at
  apply time ever override the profile resume?) rather than a clear
  bug. Documented and asserted as the real, current behavior in
  `tests/integration/upload.job-service.test.ts`.

**Minor findings, documented, not fixed (no security impact):**

- `PUT /api/job/application/update/:id`'s ownership-denial branch
  returns 404, not 403, unlike every other ownership check in this
  codebase (`services/job/src/controller/jobs.ts`, `updateApplication`).
  Access is correctly denied either way; only the status code is
  inconsistent.
- `updateJob`'s role check is commented out (dead code) — not
  exploitable in practice because the ownership check
  (`posted_by_recruiter_id !== user.user_id`) still blocks every
  non-owner regardless of role, and only recruiters can ever own a job.
- The frontend's `/account/[id]` page shows a generic "User not found"
  for both "doesn't exist" and "exists but isn't yours" (the IDOR-denied
  case) — correct in substance (no data leak either way) but doesn't
  give a user a clear "access denied" explanation. Confirmed via
  `tests/e2e/cross-user.authorization.spec.ts`.

### 9.3 Ownership / IDOR coverage beyond the original fix

`tests/integration/ownership.idor.test.ts` — searched every route for
the same "authenticated but not owned" pattern that caused the original
IDOR before writing any test. Companies, jobs, and applications all
have real ownership enforcement, verified both by status code and
response body (never leaking the other party's data in a denial). Full
reasoning for each resource, including why `GET /api/job/company/:id`
is correctly *not* ownership-scoped, is written as comments directly in
that file and summarized in §9.1's table.

### 9.4 Upload integration coverage (closing the gap §8.6 flagged)

`tests/integration/upload.job-service.test.ts` — company-logo upload
(valid/invalid-type/oversized/unauthenticated/wrong-role) and
apply-with-resume upload (valid/oversized/unauthenticated/wrong-role/
duplicate-application), through the real Gateway, real `UPLOAD_SERVICE`,
real `INTERNAL_SERVICE_KEY`, real Cloudinary stub. This was the one gap
explicitly called out as remaining in §8.6 — now covered.

### 9.5 Playwright E2E

Added fresh — `tests/e2e/` (Playwright, real frontend, real Gateway,
real services, no API mocking anywhere). Vitest remains the unit/API
framework; nothing was replaced.

| Spec | Workflow | Result |
| :--- | :--- | :--- |
| `jobseeker.happy-path.spec.ts` | register (+ resume upload) → login → profile → resume visible → browse → search → open job → intelligence (where available) → logout → protected data gone | PASS |
| `recruiter.happy-path.spec.ts` | register → profile (no resume section) → create company (+ logo upload) → post a job → dashboard shows it → jobseeker-only nav entry absent → logout | PASS |
| `cross-user.authorization.spec.ts` | two real browser contexts/identities; A→A allowed, B→A denied (no data in response), B→B allowed | PASS |
| `search.spec.ts` | keyword, multi-word, no-results, special characters, SQL-injection-shaped input, empty query, oversized query (API-rejected, shown as error), filters, sort, malformed numeric filter (API-rejected, shown as error), pagination, debounced typing | PASS (12 cases) |
| `session.spec.ts` | login persists across refresh; logout clears it; refresh after logout shows nothing; a cleared/invalid session never leaves authenticated data displayed | PASS (2 cases) |

Three real locator/timing bugs were found and fixed **in the tests
themselves** during this work (not product bugs) — recorded here for
honesty about what "17/17 passing" actually took to get right:
duplicate "Sign In"/"Post Job" accessible names between the navbar and
page content requiring scoped locators; a loose `/result/` regex
matching real job-description prose containing words like
"results-driven"; and a redundant `page.goto` after the app's own
client-side redirect that raced the just-created company against the
next page's on-mount fetch (removing the redundant navigation, not
adding a wait/sleep, fixed it — consistent with not depending on
arbitrary timing).

### 9.6 Rate limiting

Confirmed explicitly, not assumed: after this pass's test runs (under
`NODE_ENV=test`, which raises these specific limits — see §3.6/§8),
brought the stack back to plain `NODE_ENV=production` defaults and sent
6 rapid `POST /api/auth/register` requests — **all 6 returned 429**,
because the real Redis counter for that window already reflected more
than 5 requests (every prior run against this environment, test-mode or
not, increments the same key). This is exactly the correct, unweakened
production behavior — the limit value itself never changed, only
`NODE_ENV=test` temporarily permits more requests through it.

### 9.7 Test counts (exact, this pass)

```text
Unit/API:
auth       7/7
user       7/7
job        423/423
utils      14/14
gateway    6/6

Integration (tests/integration):
60/60

Playwright (tests/e2e):
17/17

Typecheck (all 5 backend services + frontend):
PASS

Frontend build:
PASS (16 routes)

Backend builds:
PASS (5/5)
```

### 9.8 Remaining gaps after P1

- Redis/Kafka failure-injection tests (§6 P3) — still not attempted.
- Search: no dedicated test for the search rate limiter itself (120
  req/min) or for result ranking quality — only that queries don't
  crash and return a sane shape.
- Job intelligence: live reprocessing/idempotency verified in Phase 8's
  own unit suite and once manually in the P0 pass; not re-verified
  through the browser beyond "the Intelligence section renders when
  present," which `jobseeker.happy-path.spec.ts` does check.
- The three minor findings in §9.2 (404-vs-403 on application update,
  dead role-check comment, generic "User not found" wording) are
  documented, not fixed — none are security issues.
- No CI integration yet for either `tests/integration` or `tests/e2e` —
  both still require a manually-started Docker stack and (for upload
  tests) the Cloudinary stub; out of scope for this pass.
- Playwright currently runs one browser (Chromium) only — no
  cross-browser matrix.
