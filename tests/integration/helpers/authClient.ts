import request from "supertest";
import { FRONTEND_ORIGIN, GATEWAY_URL } from "./config.js";
import { validPdfBuffer, validPngBuffer } from "./fixtures.js";

export interface RegisteredUser {
  user_id: number;
  email: string;
  cookie: string;
}

/** Recruiter registration — no file upload required. */
export async function registerRecruiter(email: string, password = "password123") {
  const res = await request(GATEWAY_URL)
    .post("/api/auth/register")
    .set("Origin", FRONTEND_ORIGIN)
    .field("name", "QA Recruiter")
    .field("email", email)
    .field("password", password)
    .field("phoneNumber", "5550000000")
    .field("role", "recruiter");
  return res;
}

/** Jobseeker registration — always requires a resume file. */
export function registerJobseeker(email: string, resume: Buffer, password = "password123") {
  return request(GATEWAY_URL)
    .post("/api/auth/register")
    .set("Origin", FRONTEND_ORIGIN)
    .field("name", "QA Jobseeker")
    .field("email", email)
    .field("password", password)
    .field("phoneNumber", "5550000001")
    .field("role", "jobseeker")
    .attach("file", resume, { filename: "resume.pdf", contentType: "application/pdf" });
}

export async function login(email: string, password = "password123") {
  const res = await request(GATEWAY_URL)
    .post("/api/auth/login")
    .set("Origin", FRONTEND_ORIGIN)
    .send({ email, password });
  const setCookie = res.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return { res, cookie };
}

/** Register a recruiter and log them in, in one call — the common case for tests that just need *a* valid session. */
export async function createLoggedInRecruiter(email: string, password = "password123"): Promise<RegisteredUser> {
  const registerRes = await registerRecruiter(email, password);
  if (registerRes.status !== 200 && registerRes.status !== 201) {
    throw new Error(`Failed to create test recruiter: ${registerRes.status} ${JSON.stringify(registerRes.body)}`);
  }
  const { res: loginRes, cookie } = await login(email, password);
  if (!cookie) {
    throw new Error(`Failed to log in test recruiter: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  return { user_id: registerRes.body.user.user_id, email, cookie };
}

/** Register a jobseeker (with a valid resume PDF) and log them in. */
export async function createLoggedInJobseeker(email: string, password = "password123"): Promise<RegisteredUser> {
  const registerRes = await registerJobseeker(email, validPdfBuffer(), password);
  if (registerRes.status !== 200 && registerRes.status !== 201) {
    throw new Error(`Failed to create test jobseeker: ${registerRes.status} ${JSON.stringify(registerRes.body)}`);
  }
  const { res: loginRes, cookie } = await login(email, password);
  if (!cookie) {
    throw new Error(`Failed to log in test jobseeker: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  return { user_id: registerRes.body.user.user_id, email, cookie };
}

export interface CreatedCompany {
  company_id: number;
}

/** Creates a company owned by the given recruiter session — requires the Cloudinary stub to be running (see helpers/cloudinaryStub.ts). */
export async function createCompany(cookie: string, name: string): Promise<CreatedCompany> {
  const res = await request(GATEWAY_URL)
    .post("/api/job/company/new")
    .set("Origin", FRONTEND_ORIGIN)
    .set("Cookie", cookie)
    .field("name", name)
    .field("description", "A QA test company")
    .field("website", "https://example.test")
    .attach("file", validPngBuffer(), { filename: "logo.png", contentType: "image/png" });
  if (res.status !== 200) {
    throw new Error(`Failed to create test company: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.company as CreatedCompany;
}

export interface CreatedJob {
  job_id: number;
}

/** Creates a job owned by the given recruiter session, under the given company. */
export async function createJob(cookie: string, companyId: number, title: string): Promise<CreatedJob> {
  const res = await request(GATEWAY_URL)
    .post("/api/job/new")
    .set("Origin", FRONTEND_ORIGIN)
    .set("Cookie", cookie)
    .send({
      title,
      description: "A QA test job",
      salary: "100000",
      location: "Remote",
      role: "Engineering",
      job_type: "Full-time",
      work_location: "Remote",
      company_id: companyId,
      openings: 1,
    });
  if (res.status !== 200) {
    throw new Error(`Failed to create test job: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.newJob as CreatedJob;
}
