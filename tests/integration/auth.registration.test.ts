/**
 * P0.4 — Registration regression test.
 *
 * docs/QA-AUDIT.md §2.1 documented four stacked bugs that made every
 * registration fail through the real Gateway: a CORS env-var mismatch,
 * a JWT secret env-var mismatch, a `create_at`/`created_at` column
 * typo, and a frontend build-time URL bug. All four were already fixed
 * (commits 5d29ea7, b99f688, 2892cb2, 873301c) before this test existed.
 * This protects that fix going forward — it exercises the exact path
 * (Frontend origin -> Gateway -> Auth -> PostgreSQL) those bugs broke.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { FRONTEND_ORIGIN, GATEWAY_URL } from "./helpers/config.js";
import { login, registerJobseeker, registerRecruiter } from "./helpers/authClient.js";
import { uniqueEmail, validPdfBuffer } from "./helpers/fixtures.js";

describe("Registration (P0.4 regression)", () => {
  it("recruiter registration succeeds end-to-end: Gateway -> Auth -> PostgreSQL", async () => {
    const email = uniqueEmail("recruiter");
    const res = await registerRecruiter(email);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, role: "recruiter" });
    // Regression guard for the exact `create_at` typo: this column is
    // only present in the response if the real INSERT ... RETURNING
    // succeeded against the real `created_at` column.
    expect(res.body.user.created_at).toBeTruthy();

    // The CORS-mismatch bug would have rejected this request outright
    // before it ever reached auth-service; confirm the Gateway actually
    // echoed the real frontend origin back.
    expect(res.headers["access-control-allow-origin"]).toBe(FRONTEND_ORIGIN);

    // The login would fail with "SECRET_KEY is required" under the old
    // JWT_SECRET/SECRET_KEY env-var mismatch.
    const { res: loginRes, cookie } = await login(email);
    expect(loginRes.status).toBe(201);
    expect(cookie).toBeTruthy();

    const me = await request(GATEWAY_URL)
      .get("/api/user/me")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", cookie!);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
  });

  it("jobseeker registration with a valid PDF resume succeeds end-to-end (requires P0.1's upload fix)", async () => {
    const email = uniqueEmail("jobseeker");
    const res = await registerJobseeker(email, validPdfBuffer());

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, role: "jobseeker" });
    expect(res.body.user.resume).toBeTruthy();
  });

  it("rejects duplicate email registration", async () => {
    const email = uniqueEmail("dup");
    const first = await registerRecruiter(email);
    expect(first.status).toBe(201);

    const second = await registerRecruiter(email);
    expect(second.status).toBe(409);
  });

  it("rejects an invalid role", async () => {
    const res = await request(GATEWAY_URL)
      .post("/api/auth/register")
      .set("Origin", FRONTEND_ORIGIN)
      .field("name", "Bad Role")
      .field("email", uniqueEmail("badrole"))
      .field("password", "password123")
      .field("phoneNumber", "5550000002")
      .field("role", "admin");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/role/i);
  });

  it("rejects registration with missing required fields", async () => {
    const res = await request(GATEWAY_URL)
      .post("/api/auth/register")
      .set("Origin", FRONTEND_ORIGIN)
      .field("name", "No Password")
      .field("email", uniqueEmail("nopass"))
      .field("phoneNumber", "5550000003")
      .field("role", "recruiter");

    expect(res.status).toBe(400);
  });
});
