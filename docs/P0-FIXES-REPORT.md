# JobiFy 2.0 — P0 Fixes Report

Final report for the QA audit → P0 bug fixes → regression tests pass
described in `docs/QA-AUDIT.md`. That document is the source of truth
for root-cause detail, exact log output, and the full verification
record (§8); this is the condensed summary.

## Bugs fixed

**P0.1 — Resume upload completely broken**
- Root cause: `UPLOAD_SERVICE` and `INTERNAL_SERVICE_KEY` were never set
  anywhere in `docker-compose.yml` for auth/user/job-service, and
  `INTERNAL_SERVICE_KEY` was also missing on the receiving side
  (utils-service). Fixed with the real Docker network name
  (`http://utils-service:5004`).
- A second instance of the same pattern, found while verifying:
  utils-service's actual Cloudinary vars (`CLOUD_NAME`/`API_KEY`/
  `API_SECRET`) were never set either — only the differently-named
  `CLOUDINARY_*` vars were set, and on the wrong services. Fixed.
- A third, unrelated bug found while testing the oversized-file case:
  the generic error handler defaulted every error without
  `.statusCode` to 500 — including Multer's `LIMIT_FILE_SIZE`, which
  should be 400. Fixed in all four services.
- Regression test: `tests/integration/upload.resume.test.ts` (7 cases).
- Live verification: jobseeker registration with PDF → success; resume
  update → success; invalid type → 400; oversized → 400;
  unauthenticated → 401; internal endpoint still rejects no-key/
  wrong-key.

**P0.2 — IDOR on `GET /api/user/:userId`**
- Root cause: endpoint checked for *a* valid session but never that it
  matched the requested profile. Checked the frontend and job-service
  first — no legitimate cross-user access pattern exists — so fixed via
  the documented fallback: `authenticated user id == requested user
  id`, denied before any row is fetched.
- Regression test: `tests/integration/idor.profile.test.ts` (5 cases,
  asserting response bodies, not just status).
- **Red→green actually demonstrated**: reverted the fix, rebuilt,
  confirmed the test fails exactly as the original bug did (200 + full
  profile leaked); restored, rebuilt, confirmed 5/5 pass.

**P0.3 — Gateway path-rewrite (regression coverage added)**
- Already fixed in a prior session. Added
  `tests/integration/gateway.proxy.test.ts`.
- **Red→green demonstrated**: reverted `proxy.ts` to the old no-op,
  rebuilt the Gateway, confirmed all four path-reconstruction tests
  fail with the exact historical symptom (HTML "Cannot GET"); restored,
  confirmed full suite green.

**P0.4 — Registration chain (regression coverage added)**
- All four historical bugs were already fixed before this audit
  existed. Added `tests/integration/auth.registration.test.ts` to
  protect them going forward (not re-broken/re-fixed — judged not worth
  four separate reverts for already well-documented history).

## Tests

| Suite | Count |
| :--- | :--- |
| auth | 7 |
| user | 7 |
| job | 423 |
| utils | 14 |
| gateway | 6 |
| frontend | typecheck clean, build succeeds (16 routes) |
| new integration tests (`tests/integration`) | 22 |
| **Total (backend + integration)** | **457 + 22 = 479** |

All Vitest + Supertest (no Jest anywhere, no new test framework
introduced). Integration tests use real HTTP through the real Gateway,
never an imported Express app.

## Security

- IDOR: fixed and verified red→green
- Internal upload protection: confirmed still enforced (no-key and
  wrong-key both still rejected with 403)
- No secrets committed — `.env`/real credentials untouched; only
  placeholder defaults in `.env.example` and docker-compose fallbacks
  (same pattern as the existing `SECRET_KEY` fallback)
- Confirmed the production register rate limit (5/hour) is unweakened
  after reverting to plain `NODE_ENV=production`

## Live workflows (all actually executed through the Gateway)

| Workflow | Result |
| :--- | :--- |
| Recruiter registration | PASS |
| Jobseeker registration with PDF | PASS |
| Resume upload (existing user) | PASS |
| Profile access / IDOR denial | PASS |
| Gateway routing (auth/user/job/utils) | PASS |
| Full regression suite (457 + 22) | PASS |

## Remaining (unchanged from the audit, P1–P3)

No Playwright/E2E yet, `docs/TESTING.md` not created (correctly
deferred), Redis/Kafka failure-injection tests, broader authorization
matrix beyond this one IDOR, search edge cases, job-intelligence
live-reprocessing checks, CORS-rejection 500→4xx cleanup. One new gap:
job-service's company-logo/apply-resume upload paths got the same fix
but don't have their own integration test yet.

See `docs/QA-AUDIT.md` §8 for full detail behind every line above.
