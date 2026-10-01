/**
 * P0.1 — Resume upload regression test.
 *
 * docs/QA-AUDIT.md §2.2: UPLOAD_SERVICE and INTERNAL_SERVICE_KEY were
 * never set anywhere in docker-compose.yml, so every call from
 * auth/user/job-service to utils-service's upload endpoint failed
 * before it ever reached utils-service. Fixed by wiring both through
 * docker-compose.yml with the real Docker network service name
 * (http://utils-service:5004), not localhost.
 *
 * Nothing here mocks UPLOAD_SERVICE or INTERNAL_SERVICE_KEY — both are
 * exercised for real, against the real running auth/user/utils
 * containers. Only Cloudinary itself (a third-party account this
 * environment doesn't have) is replaced, via a local stub utils-service
 * is pointed at through CLOUDINARY_UPLOAD_PREFIX — see
 * helpers/cloudinaryStub.ts for exactly what that does and does not
 * replace.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { FRONTEND_ORIGIN, GATEWAY_URL } from "./helpers/config.js";
import { createLoggedInRecruiter, registerJobseeker } from "./helpers/authClient.js";
import { oversizedPdfBuffer, plainTextBuffer, uniqueEmail, validPdfBuffer } from "./helpers/fixtures.js";

// The Cloudinary stub itself is started once for the whole suite in
// globalSetup.ts (not per-file) — auth.registration.test.ts's jobseeker
// test needs it too, regardless of which test file vitest runs first.

describe("Resume upload (P0.1 regression)", () => {

  it("jobseeker registration with a valid PDF stores a real resume URL", async () => {
    const email = uniqueEmail("upload-register");
    const res = await registerJobseeker(email, validPdfBuffer());

    expect(res.status).toBe(201);
    expect(res.body.user.resume).toBeTruthy();
    expect(typeof res.body.user.resume).toBe("string");
  });

  it("an existing authenticated user can update their resume with a valid PDF", async () => {
    const user = await createLoggedInRecruiter(uniqueEmail("upload-update"));

    const res = await request(GATEWAY_URL)
      .put("/api/user/update/resume")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", user.cookie)
      .attach("file", validPdfBuffer(), { filename: "resume.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    expect(res.body.updatedUser.resume).toBeTruthy();
  });

  it("rejects a non-PDF file", async () => {
    const user = await createLoggedInRecruiter(uniqueEmail("upload-badtype"));

    const res = await request(GATEWAY_URL)
      .put("/api/user/update/resume")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", user.cookie)
      .attach("file", plainTextBuffer(), { filename: "resume.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
  });

  it("rejects an oversized PDF", async () => {
    const user = await createLoggedInRecruiter(uniqueEmail("upload-oversized"));

    const res = await request(GATEWAY_URL)
      .put("/api/user/update/resume")
      .set("Origin", FRONTEND_ORIGIN)
      .set("Cookie", user.cookie)
      .attach("file", oversizedPdfBuffer(), { filename: "resume.pdf", contentType: "application/pdf" });

    expect([400, 413]).toContain(res.status);
  });

  it("rejects an unauthenticated upload", async () => {
    const res = await request(GATEWAY_URL)
      .put("/api/user/update/resume")
      .set("Origin", FRONTEND_ORIGIN)
      .attach("file", validPdfBuffer(), { filename: "resume.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(401);
  });

  it("internal upload endpoint still rejects requests without a valid INTERNAL_SERVICE_KEY", async () => {
    // Confirms the audit's finding that this guard itself was always
    // correct — the bug was that nothing ever supplied a real key, not
    // that the guard was missing. This must keep rejecting unauthenticated
    // direct calls even after the key is wired up correctly elsewhere.
    const res = await request(GATEWAY_URL)
      .post("/api/utils/upload")
      .set("Origin", FRONTEND_ORIGIN)
      .send({ buffer: "data:application/pdf;base64,JVBERi0xLjQK" });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/internal service/i);
  });

  it("internal upload endpoint rejects a wrong INTERNAL_SERVICE_KEY", async () => {
    const res = await request(GATEWAY_URL)
      .post("/api/utils/upload")
      .set("Origin", FRONTEND_ORIGIN)
      .set("x-internal-service-key", "definitely-not-the-real-key")
      .send({ buffer: "data:application/pdf;base64,JVBERi0xLjQK" });

    expect(res.status).toBe(403);
  });
});
