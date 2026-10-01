/**
 * P1.2 — Ownership / IDOR matrix.
 *
 * The original IDOR (docs/QA-AUDIT.md §3.1, fixed — see
 * idor.profile.test.ts) existed because authentication was checked but
 * ownership wasn't. Searched the rest of the codebase for the same
 * pattern against every client-supplied resource ID, before writing any
 * test (per instruction):
 *
 * - DELETE /api/job/company/:companyId — ownership checked
 *   (services/job/src/controller/jobs.ts: deleteCompany scopes its
 *   SELECT by `recruiter_id = user.user_id`, 404s generically — doesn't
 *   leak whether a company owned by someone else even exists)
 * - PUT    /api/job/update/:jobId — ownership checked
 *   (updateJob compares `existingJob.posted_by_recruiter_id !== user.user_id`)
 * - GET    /api/job/application/:jobId — role + ownership checked
 *   (getAllApplicationForJOb)
 * - PUT    /api/job/application/update/:id — role + ownership checked
 *   (updateApplication)
 * - GET    /api/job/company/:id — deliberately NOT ownership-scoped.
 *   This is a read of public company-profile data (name/description/
 *   website/job listings) that any authenticated user is expected to
 *   see when browsing jobs — not a private resource. Confirmed this
 *   isn't an oversight by checking getAllCompany (which IS scoped to
 *   the caller — `GET /api/job/company/all` only ever returns the
 *   caller's own companies) exists as the owner-only counterpart.
 * - skill/add, skill/delete, update/profile, update/pic, update/resume,
 *   application/all — all operate on `req.user.user_id` directly, with
 *   no client-supplied ID in the URL/body to substitute — not IDOR
 *   candidates by construction.
 *
 * Verifies response bodies, not just status codes.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { FRONTEND_ORIGIN, GATEWAY_URL } from "./helpers/config.js";
import { createCompany, createJob, createLoggedInJobseeker, createLoggedInRecruiter } from "./helpers/authClient.js";
import { uniqueEmail, validPdfBuffer } from "./helpers/fixtures.js";

describe("Ownership — companies (P1.2)", () => {
  it("recruiter A can delete A's own company", async () => {
    const a = await createLoggedInRecruiter(uniqueEmail("own-company-a1"));
    const company = await createCompany(a.cookie, `QA Delete Own ${Date.now()}`);

    const res = await request(GATEWAY_URL)
      .delete(`/api/job/company/${company.company_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", a.cookie);

    expect(res.status).toBe(200);
  });

  it("recruiter B cannot delete recruiter A's company", async () => {
    const a = await createLoggedInRecruiter(uniqueEmail("own-company-a2"));
    const b = await createLoggedInRecruiter(uniqueEmail("own-company-b2"));
    const company = await createCompany(a.cookie, `QA Protected ${Date.now()}`);

    const res = await request(GATEWAY_URL)
      .delete(`/api/job/company/${company.company_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", b.cookie);

    expect(res.status).toBe(404);

    // Confirm it genuinely wasn't deleted — A can still see it.
    const stillThere = await request(GATEWAY_URL)
      .get("/api/job/company/all")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", a.cookie);
    expect(stillThere.body.some((c: any) => c.company_id === company.company_id)).toBe(true);
  });
});

describe("Ownership — jobs (P1.2)", () => {
  it("recruiter A can update A's own job with a partial payload", async () => {
    // Deliberately omits job_type/work_location/company_id/is_active —
    // this exact payload shape is what originally caught a real P1 bug:
    // postgres.js rejects `undefined` query parameters outright
    // ("UNDEFINED_VALUE"), so any field the caller didn't send crashed
    // the whole update with a 500. Fixed in
    // services/job/src/controller/jobs.ts (updateJob) by falling back to
    // the existing row's value for anything omitted. Red->green
    // demonstrated manually (see docs/QA-AUDIT.md P1 section) before
    // this test was written against the fix.
    const a = await createLoggedInRecruiter(uniqueEmail("own-job-a1"));
    const company = await createCompany(a.cookie, `QA Job Owner ${Date.now()}`);
    const job = await createJob(a.cookie, company.company_id, "QA Own Job");

    const res = await request(GATEWAY_URL)
      .put(`/api/job/update/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", a.cookie)
      .send({ title: "QA Own Job (edited)", description: "x", salary: "1", location: "x", role: "x", openings: 1 });

    expect(res.status).toBe(200);
    expect(res.body.updatedJob.title).toBe("QA Own Job (edited)");
    // Omitted fields must survive unchanged, not be nulled out.
    expect(res.body.updatedJob.job_type).toBe("Full-time");
    expect(res.body.updatedJob.work_location).toBe("Remote");
  });

  it("toggling only is_active (the realistic partial-update case) does not crash", async () => {
    const a = await createLoggedInRecruiter(uniqueEmail("own-job-toggle"));
    const company = await createCompany(a.cookie, `QA Job Toggle ${Date.now()}`);
    const job = await createJob(a.cookie, company.company_id, "QA Toggle Job");

    const res = await request(GATEWAY_URL)
      .put(`/api/job/update/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", a.cookie)
      .send({ is_active: false });

    expect(res.status).toBe(200);
    expect(res.body.updatedJob.is_active).toBe(false);
    expect(res.body.updatedJob.title).toBe("QA Toggle Job");
  });

  it("recruiter B cannot update recruiter A's job", async () => {
    const a = await createLoggedInRecruiter(uniqueEmail("own-job-a2"));
    const b = await createLoggedInRecruiter(uniqueEmail("own-job-b2"));
    const company = await createCompany(a.cookie, `QA Job Protected ${Date.now()}`);
    const job = await createJob(a.cookie, company.company_id, "QA Protected Job");

    const res = await request(GATEWAY_URL)
      .put(`/api/job/update/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", b.cookie)
      .send({ title: "Hijacked", description: "x", salary: "1", location: "x", role: "x", openings: 1 });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("Hijacked");
  });

  it("jobseeker cannot update any job (ownership check also blocks non-owning authenticated users of any role)", async () => {
    const a = await createLoggedInRecruiter(uniqueEmail("own-job-a3"));
    const jobseeker = await createLoggedInJobseeker(uniqueEmail("own-job-js3"));
    const company = await createCompany(a.cookie, `QA Job Role ${Date.now()}`);
    const job = await createJob(a.cookie, company.company_id, "QA Role Job");

    const res = await request(GATEWAY_URL)
      .put(`/api/job/update/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", jobseeker.cookie)
      .send({ title: "Hijacked", description: "x", salary: "1", location: "x", role: "x", openings: 1 });

    expect(res.status).toBe(403);
  });
});

describe("Ownership — applications (P1.2)", () => {
  async function setupJobWithApplication() {
    const recruiterA = await createLoggedInRecruiter(uniqueEmail("own-app-a"));
    const recruiterB = await createLoggedInRecruiter(uniqueEmail("own-app-b"));
    const jobseeker = await createLoggedInJobseeker(uniqueEmail("own-app-js"));

    const company = await createCompany(recruiterA.cookie, `QA App Owner ${Date.now()}`);
    const job = await createJob(recruiterA.cookie, company.company_id, "QA Applied-To Job");

    const applyRes = await request(GATEWAY_URL)
      .post(`/api/job/apply/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", jobseeker.cookie)
      .attach("file", validPdfBuffer(), { filename: "resume.pdf", contentType: "application/pdf" });
    if (applyRes.status !== 200) {
      throw new Error(`Setup failed: could not apply to job: ${applyRes.status} ${JSON.stringify(applyRes.body)}`);
    }

    return { recruiterA, recruiterB, jobseeker, job, application: applyRes.body.application };
  }

  it("the owning recruiter (A) can view applications for A's job", async () => {
    const { recruiterA, job } = await setupJobWithApplication();

    const res = await request(GATEWAY_URL)
      .get(`/api/job/application/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", recruiterA.cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("a non-owning recruiter (B) cannot view applications for A's job", async () => {
    const { recruiterB, job, jobseeker } = await setupJobWithApplication();

    const res = await request(GATEWAY_URL)
      .get(`/api/job/application/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", recruiterB.cookie);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(jobseeker.email);
  });

  it("the owning recruiter (A) can update the application's status", async () => {
    const { recruiterA, application } = await setupJobWithApplication();

    const res = await request(GATEWAY_URL)
      .put(`/api/job/application/update/${application.application_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", recruiterA.cookie)
      .send({ status: "Rejected" });

    expect(res.status).toBe(200);
    expect(res.body.updatedApplication.status).toBe("Rejected");
  });

  it("a non-owning recruiter (B) cannot update the application's status", async () => {
    const { recruiterB, application } = await setupJobWithApplication();

    const res = await request(GATEWAY_URL)
      .put(`/api/job/application/update/${application.application_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", recruiterB.cookie)
      .send({ status: "Rejected" });

    // Correctly denied — but note the controller's denial branch for this
    // specific ownership check (services/job/src/controller/jobs.ts,
    // updateApplication) returns 404, not 403, unlike every other
    // ownership check in this file. Recorded as a real (minor, non-
    // security) finding in docs/QA-AUDIT.md's P1 section rather than
    // silently asserting the "should be" status.
    expect(res.status).toBe(404);
    expect(res.body.updatedApplication).toBeUndefined();
  });
});
