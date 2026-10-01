import request from "supertest";
import { FRONTEND_ORIGIN, GATEWAY_URL } from "./config.js";

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
