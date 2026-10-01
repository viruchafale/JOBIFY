/**
 * P1.3 — Upload integration coverage for job-service.
 *
 * docs/QA-AUDIT.md §8.6 flagged this gap explicitly: job-service's
 * company-logo (createCompany) and apply-with-resume (applyJob) paths
 * received the same P0.1 UPLOAD_SERVICE/INTERNAL_SERVICE_KEY fix as
 * auth-service/user-service, and were spot-checked once manually, but
 * had no dedicated regression test. This closes that gap.
 *
 * Same boundary-fidelity rule as upload.resume.test.ts: UPLOAD_SERVICE,
 * INTERNAL_SERVICE_KEY, and the Gateway are all real. Only Cloudinary's
 * third-party API is replaced by the shared stub (globalSetup.ts).
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { FRONTEND_ORIGIN, GATEWAY_URL } from "./helpers/config.js";
import { createCompany, createJob, createLoggedInJobseeker, createLoggedInRecruiter } from "./helpers/authClient.js";
import {
  oversizedImageBuffer,
  oversizedPdfBuffer,
  plainTextBuffer,
  uniqueEmail,
  validPdfBuffer,
  validPngBuffer,
} from "./helpers/fixtures.js";

describe("Company logo upload (P1.3)", () => {
  it("valid image -> success", async () => {
    const recruiter = await createLoggedInRecruiter(uniqueEmail("logo-valid"));
    const company = await createCompany(recruiter.cookie, `QA Logo Valid ${Date.now()}`);
    expect(company.company_id).toBeTypeOf("number");
  });

  it("invalid file type -> 400", async () => {
    const recruiter = await createLoggedInRecruiter(uniqueEmail("logo-badtype"));
    const res = await request(GATEWAY_URL)
      .post("/api/job/company/new")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", recruiter.cookie)
      .field("name", `QA Logo BadType ${Date.now()}`)
      .field("description", "x")
      .field("website", "https://example.test")
      .attach("file", plainTextBuffer(), { filename: "logo.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
  });

  it("oversized file -> 400 or 413", async () => {
    const recruiter = await createLoggedInRecruiter(uniqueEmail("logo-oversized"));
    const res = await request(GATEWAY_URL)
      .post("/api/job/company/new")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", recruiter.cookie)
      .field("name", `QA Logo Oversized ${Date.now()}`)
      .field("description", "x")
      .field("website", "https://example.test")
      .attach("file", oversizedImageBuffer(), { filename: "logo.png", contentType: "image/png" });

    expect([400, 413]).toContain(res.status);
  });

  it("unauthenticated -> 401", async () => {
    const res = await request(GATEWAY_URL)
      .post("/api/job/company/new")
      .set("Origin", FRONTEND_ORIGIN)
      .field("name", `QA Logo Unauth ${Date.now()}`)
      .field("description", "x")
      .field("website", "https://example.test")
      .attach("file", validPngBuffer(), { filename: "logo.png", contentType: "image/png" });

    expect(res.status).toBe(401);
  });

  it("wrong role (jobseeker) -> 403, no company created", async () => {
    const jobseeker = await createLoggedInJobseeker(uniqueEmail("logo-wrongrole"));
    const res = await request(GATEWAY_URL)
      .post("/api/job/company/new")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", jobseeker.cookie)
      .field("name", `QA Logo WrongRole ${Date.now()}`)
      .field("description", "x")
      .field("website", "https://example.test")
      .attach("file", validPngBuffer(), { filename: "logo.png", contentType: "image/png" });

    expect(res.status).toBe(403);
    expect(res.body.company).toBeUndefined();
  });
});

describe("Apply-to-job resume upload (P1.3)", () => {
  async function setupActiveJob() {
    const recruiter = await createLoggedInRecruiter(uniqueEmail("apply-upload-rec"));
    const company = await createCompany(recruiter.cookie, `QA Apply Upload ${Date.now()}`);
    const job = await createJob(recruiter.cookie, company.company_id, "QA Apply Upload Job");
    return { recruiter, job };
  }

  it("valid PDF -> success", async () => {
    const { job } = await setupActiveJob();
    const jobseeker = await createLoggedInJobseeker(uniqueEmail("apply-upload-valid"));

    const res = await request(GATEWAY_URL)
      .post(`/api/job/apply/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", jobseeker.cookie)
      .attach("file", validPdfBuffer(), { filename: "resume.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(res.body.application.resume).toBeTruthy();
  });

  it("a file attached at apply-time is ignored when the jobseeker already has a resume on file", async () => {
    // Real finding, not a test bug: applyJob (services/job/src/controller/
    // jobs.ts) only looks at req.file when resumeUrl is still falsy after
    // trying req.body.resume and then user.resume. Every jobseeker in
    // this product already has a resume from registration (mandatory at
    // signup — see docs/QA-AUDIT.md §2.2), so that fallback is always
    // populated and the uploaded file's own type/size (assertPdf) is
    // never actually reached via this path in practice. Documented in
    // docs/QA-AUDIT.md's P1 section rather than asserting a 400 that the
    // current product logic cannot produce here.
    const { job } = await setupActiveJob();
    const jobseeker = await createLoggedInJobseeker(uniqueEmail("apply-upload-badtype"));

    const res = await request(GATEWAY_URL)
      .post(`/api/job/apply/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", jobseeker.cookie)
      .attach("file", plainTextBuffer(), { filename: "resume.txt", contentType: "text/plain" });

    expect(res.status).toBe(200);
    // The stored resume is the jobseeker's existing (valid PDF) resume
    // URL from registration, never derived from the attached .txt file.
    expect(res.body.application.resume).toBeTruthy();
    expect(res.body.application.resume).not.toContain("resume.txt");
  });

  it("oversized file -> 400 or 413", async () => {
    const { job } = await setupActiveJob();
    const jobseeker = await createLoggedInJobseeker(uniqueEmail("apply-upload-oversized"));

    const res = await request(GATEWAY_URL)
      .post(`/api/job/apply/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", jobseeker.cookie)
      .attach("file", oversizedPdfBuffer(), { filename: "resume.pdf", contentType: "application/pdf" });

    expect([400, 413]).toContain(res.status);
  });

  it("unauthenticated -> 401", async () => {
    const { job } = await setupActiveJob();

    const res = await request(GATEWAY_URL)
      .post(`/api/job/apply/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .attach("file", validPdfBuffer(), { filename: "resume.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(401);
  });

  it("wrong role (recruiter applying) -> 403, denied", async () => {
    const { job, recruiter } = await setupActiveJob();

    const res = await request(GATEWAY_URL)
      .post(`/api/job/apply/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", recruiter.cookie)
      .attach("file", validPdfBuffer(), { filename: "resume.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(403);
    expect(res.body.application).toBeUndefined();
  });

  it("duplicate application -> 409, denied", async () => {
    const { job } = await setupActiveJob();
    const jobseeker = await createLoggedInJobseeker(uniqueEmail("apply-upload-dup"));

    const first = await request(GATEWAY_URL)
      .post(`/api/job/apply/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", jobseeker.cookie)
      .attach("file", validPdfBuffer(), { filename: "resume.pdf", contentType: "application/pdf" });
    expect(first.status).toBe(200);

    const second = await request(GATEWAY_URL)
      .post(`/api/job/apply/${job.job_id}`)
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", jobseeker.cookie)
      .attach("file", validPdfBuffer(), { filename: "resume.pdf", contentType: "application/pdf" });

    expect(second.status).toBe(409);
  });
});
