/**
 * P0.2 — IDOR regression test.
 *
 * docs/QA-AUDIT.md §3.1: GET /api/user/:userId only checked that *a*
 * valid session existed, never that it belonged to the requested
 * profile — any authenticated user could read any other user's full
 * profile (email, phone_number, resume URL, bio, subscription).
 * Reproduced live with two real accounts before the fix.
 *
 * Fixed in services/user/src/controller/user.ts: the endpoint now
 * enforces authenticated user id == requested user id, since no
 * documented recruiter/candidate cross-access relationship exists
 * anywhere in the current product (checked frontend + job-service
 * before deciding this, per the no-invented-model instruction).
 *
 * This asserts both status codes AND response bodies — a 403 that
 * still leaked the profile in its body would not actually fix anything.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { FRONTEND_ORIGIN, GATEWAY_URL } from "./helpers/config.js";
import { createLoggedInRecruiter } from "./helpers/authClient.js";
import { uniqueEmail } from "./helpers/fixtures.js";

describe("Profile access authorization (P0.2 regression)", () => {
  it("A -> A's own profile: PASS, returns real data", async () => {
    const a = await createLoggedInRecruiter(uniqueEmail("idor-a1"));

    const res = await request(GATEWAY_URL)
      .get(`/api/user/${a.user_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", a.cookie);

    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(a.user_id);
    expect(res.body.email).toBe(a.email);
  });

  it("A -> B's profile: DENIED, no profile data in the response body", async () => {
    const a = await createLoggedInRecruiter(uniqueEmail("idor-a2"));
    const b = await createLoggedInRecruiter(uniqueEmail("idor-b2"));

    const res = await request(GATEWAY_URL)
      .get(`/api/user/${b.user_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", a.cookie);

    expect(res.status).toBe(403);
    expect(res.body.email).toBeUndefined();
    expect(res.body.phone_number).toBeUndefined();
    expect(res.body.resume).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(b.email);
  });

  it("B -> A's profile: DENIED, no profile data in the response body", async () => {
    const a = await createLoggedInRecruiter(uniqueEmail("idor-a3"));
    const b = await createLoggedInRecruiter(uniqueEmail("idor-b3"));

    const res = await request(GATEWAY_URL)
      .get(`/api/user/${a.user_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", b.cookie);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(a.email);
  });

  it("B -> B's own profile: PASS", async () => {
    const b = await createLoggedInRecruiter(uniqueEmail("idor-b4"));

    const res = await request(GATEWAY_URL)
      .get(`/api/user/${b.user_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", b.cookie);

    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(b.user_id);
  });

  it("unauthenticated request: DENIED", async () => {
    const a = await createLoggedInRecruiter(uniqueEmail("idor-a5"));

    const res = await request(GATEWAY_URL)
      .get(`/api/user/${a.user_id}`)
      .set("Origin", FRONTEND_ORIGIN);

    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(a.email);
  });
});
