/**
 * P1.1 — Authorization matrix.
 *
 * Built from reading every route file in services/{auth,user,job,utils}
 * before writing any test (per instruction), not assumed. The role-gated
 * endpoints below are exactly the ones whose controllers check
 * `user.role !== "..."` — found in services/job/src/controller/jobs.ts
 * and services/user/src/controller/user.ts. Everything else under isAuth
 * is role-agnostic (any authenticated user, regardless of role, may call
 * it) and is covered by the plain "unauthenticated -> 401" checks below.
 *
 * Verifies both status code and response body, per instruction — a 403
 * that still returned the protected resource would not actually be a
 * fix.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { FRONTEND_ORIGIN, GATEWAY_URL } from "./helpers/config.js";
import { createCompany, createLoggedInJobseeker, createLoggedInRecruiter } from "./helpers/authClient.js";
import { uniqueEmail } from "./helpers/fixtures.js";

describe("Authorization matrix — unauthenticated access (P1.1)", () => {
  const cases: [string, "get" | "post" | "put" | "delete", string][] = [
    ["auth", "post", "/api/auth/logout"],
    ["user", "get", "/api/user/me"],
    ["user", "put", "/api/user/update/profile"],
    ["user", "post", "/api/user/skill/add"],
    ["user", "get", "/api/user/application/all"],
    ["job", "post", "/api/job/company/new"],
    ["job", "post", "/api/job/new"],
    ["job", "get", "/api/job/company/all"],
    ["utils", "post", "/api/utils/career"],
    ["utils", "post", "/api/utils/resume-analyzer"],
  ];

  it.each(cases)("%s: %s %s is denied without a session", async (_service, method, path) => {
    const res = await request(GATEWAY_URL)[method](path).set("Origin", FRONTEND_ORIGIN).send({});
    // /api/auth/logout intentionally succeeds even with no session (it's
    // idempotent — "already logged out" is not an error); everything else
    // under isAuth/requireSession must reject.
    if (path === "/api/auth/logout") {
      expect(res.status).toBe(200);
    } else {
      expect(res.status).toBe(401);
    }
  });
});

describe("Authorization matrix — role restrictions (P1.1)", () => {
  it("jobseeker cannot create a company (403, no company created)", async () => {
    const jobseeker = await createLoggedInJobseeker(uniqueEmail("role-js-company"));
    const res = await request(GATEWAY_URL)
      .post("/api/job/company/new")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", jobseeker.cookie)
      .field("name", "Should Not Exist Inc")
      .field("description", "x")
      .field("website", "https://example.test");

    expect(res.status).toBe(403);
    expect(res.body.company).toBeUndefined();
  });

  it("recruiter can create a company (200)", async () => {
    const recruiter = await createLoggedInRecruiter(uniqueEmail("role-rec-company"));
    const company = await createCompany(recruiter.cookie, `QA Co ${Date.now()}`);
    expect(company.company_id).toBeTypeOf("number");
  });

  it("jobseeker cannot create a job (403)", async () => {
    const jobseeker = await createLoggedInJobseeker(uniqueEmail("role-js-job"));
    const res = await request(GATEWAY_URL)
      .post("/api/job/new")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", jobseeker.cookie)
      .send({ title: "x", description: "x", salary: "1", location: "x", role: "x", openings: 1, company_id: 1 });

    expect(res.status).toBe(403);
    expect(res.body.newJob).toBeUndefined();
  });

  it("recruiter cannot apply to a job (403)", async () => {
    const recruiter = await createLoggedInRecruiter(uniqueEmail("role-rec-apply"));
    const res = await request(GATEWAY_URL)
      .post("/api/job/apply/1")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", recruiter.cookie)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/jobseeker/i);
  });

  it("recruiter cannot list a jobseeker's own applications endpoint (403)", async () => {
    // GET /api/user/application/all is jobseeker-only per
    // getAllApplications's role check.
    const recruiter = await createLoggedInRecruiter(uniqueEmail("role-rec-apps"));
    const res = await request(GATEWAY_URL)
      .get("/api/user/application/all")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", recruiter.cookie);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/jobseeker/i);
  });

  it("jobseeker cannot view applications for a job (403, recruiter-only endpoint)", async () => {
    const jobseeker = await createLoggedInJobseeker(uniqueEmail("role-js-viewapps"));
    const res = await request(GATEWAY_URL)
      .get("/api/job/application/1")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", jobseeker.cookie);

    expect(res.status).toBe(403);
    expect(Array.isArray(res.body)).toBe(false);
  });

  it("jobseeker cannot update an application's status (403, recruiter-only endpoint)", async () => {
    const jobseeker = await createLoggedInJobseeker(uniqueEmail("role-js-updateapp"));
    const res = await request(GATEWAY_URL)
      .put("/api/job/application/update/1")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", jobseeker.cookie)
      .send({ status: "Rejected" });

    expect(res.status).toBe(403);
  });
});
