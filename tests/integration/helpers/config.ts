/**
 * Every test in this suite talks to a real, already-running Gateway —
 * never an imported Express app — because the bugs these tests guard
 * against (the path-rewrite bug, the env-var-name mismatches) only
 * exist at that real HTTP boundary.
 *
 * GATEWAY_URL / FRONTEND_ORIGIN default to this repo's documented
 * defaults (ports 5000/3000). Override them to match whatever ports
 * `docker compose up` actually published, e.g. when 5000/3000 are
 * already taken by something else on the host.
 */
export const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:5000";
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
