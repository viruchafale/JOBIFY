# Gateway-boundary integration tests

Real HTTP requests against a real, already-running Docker Compose stack
— never an imported Express `app`. These exist specifically to catch the
class of bug that unit tests (which mock the DB/Redis/Kafka, and import
services directly rather than going through the Gateway) cannot: a
component works alone but fails through the real path. See
`docs/QA-AUDIT.md` for the bugs each test file protects against.

## Prerequisites

1. The full stack must already be running via `docker compose up`.
2. Two things need non-default configuration for these tests specifically
   — **neither changes production behavior**; both are only active when
   explicitly set:

   - `NODE_ENV=test` on auth-service/user-service (raises their
     registration/login/upload rate limits so the suite can create many
     test users without a manual Redis flush between runs — see
     `docs/QA-AUDIT.md` §3.6. The production default is untouched).
   - `CLOUDINARY_UPLOAD_PREFIX` on utils-service, pointed at a local
     stub (see `helpers/cloudinaryStub.ts` for exactly what it does and
     does not replace — it is not a mock of `UPLOAD_SERVICE` or
     `INTERNAL_SERVICE_KEY`, both of which stay completely real).

### Bringing the stack up for this test run

```bash
# from the repo root — adjust GATEWAY_PORT/FRONTEND_PORT if 5000/3000
# are already taken on your machine, and set GATEWAY_URL/FRONTEND_ORIGIN
# below to match
NODE_ENV=test \
CLOUDINARY_UPLOAD_PREFIX=https://host.docker.internal:41234 \
CLOUDINARY_CLOUD_NAME=qa-test CLOUDINARY_API_KEY=qa-test CLOUDINARY_API_SECRET=qa-test \
NODE_TLS_REJECT_UNAUTHORIZED=0 \
  docker compose up -d --build
```

`NODE_TLS_REJECT_UNAUTHORIZED=0` only needs to reach `utils-service`
(the only one that talks to Cloudinary) — it's harmless there because
the only outbound HTTPS call it ever makes is the Cloudinary one this
stub replaces for the duration of the test run. Requires `openssl` on
the machine running the test suite (used once, to generate a throwaway
self-signed cert for the stub — not committed, not reused between runs).

`host.docker.internal` is resolved automatically by Docker Desktop (Mac/
Windows); on native Linux Docker you'd instead need
`extra_hosts: ["host.docker.internal:host-gateway"]` added to
`utils-service` in `docker-compose.yml` — not added here since this
environment doesn't need it, flagged for whoever runs this on Linux CI.

### Running the tests

```bash
cd tests/integration
npm install
GATEWAY_URL=http://localhost:5500 FRONTEND_ORIGIN=http://localhost:3010 npm test
```

(Port numbers above match this environment's actual mapping — see
`docs/DEPLOYMENT.md`. Use the real defaults, `http://localhost:5000` /
`http://localhost:3000`, if nothing on your machine conflicts with them.)

The Cloudinary stub itself is started by `beforeAll` inside
`upload.resume.test.ts`, on the fixed port `41234` referenced above —
it has to match between the `docker compose up` command and the test
run, since utils-service is a separate process that connects to it at
request time, not something the test process can renegotiate per-run.

## What's deliberately not mocked

Per `docs/QA-AUDIT.md`'s instruction not to mock away the exact
dependency that caused the production failure: `UPLOAD_SERVICE`,
`INTERNAL_SERVICE_KEY`, the Gateway's proxy, CORS, rate limiting,
PostgreSQL, Redis, and the real `docker-compose.yml` wiring are all
exercised for real in every test here. Only Cloudinary's actual
third-party cloud API — which this environment has no account for — is
replaced with a local stub, and only when `CLOUDINARY_UPLOAD_PREFIX` is
explicitly set.
