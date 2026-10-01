# Browser E2E tests (Playwright)

Real browser, real frontend, real Gateway, real services, real
PostgreSQL/Redis/Kafka. No API mocking anywhere — see
`docs/QA-AUDIT.md` §9.5 for exactly what each spec covers and the
locator/timing bugs found and fixed in these tests themselves while
getting them green.

Vitest (`tests/integration/`, each service's own unit suite) remains
the unit/API framework. Playwright is only ever used here, for
browser-level E2E.

## Prerequisites

Same stack, same test-mode env vars, as `tests/integration/` — see
`tests/integration/README.md` for the exact `docker compose up`
command (`NODE_ENV=test`, the Cloudinary stub, `NODE_TLS_REJECT_UNAUTHORIZED=0`).
The jobseeker and recruiter happy-path specs upload a resume/logo, so
the Cloudinary stub must be running and reachable from `utils-service`
for those two specs to reach a real success state — start it the same
way (`tests/integration/helpers/cloudinaryStub.ts`, fixed port
`41234`), independently of whether `tests/integration` itself is also
running, since each process's `globalSetup`/stub lifecycle is separate.

## Running

```bash
cd tests/e2e
npm install
npx playwright install chromium   # first run only
FRONTEND_URL=http://localhost:3010 GATEWAY_URL=http://localhost:5500 npx playwright test
```

(Port numbers match this environment's actual mapping — see
`docs/DEPLOYMENT.md`. Use the real defaults, `http://localhost:3000` /
`http://localhost:5000`, if nothing on your machine conflicts with
them. `GATEWAY_URL` is only read by `cross-user.authorization.spec.ts`,
which registers test users directly against the Gateway rather than
through the UI form, purely as fast setup — see that file.)
