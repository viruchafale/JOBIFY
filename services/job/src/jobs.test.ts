/**
 * Job service — Phase 1 security tests
 *
 * Tests cover:
 * - Application ownership (jobseeker can only apply/view their own)
 * - Recruiter ownership (recruiter only sees/updates applications for their jobs)
 * - Duplicate application prevention
 * - Invalid / unauthorized status transitions
 * - Role authorization
 * - CORS origin enforcement
 *
 * All external dependencies are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Mock external dependencies BEFORE importing app
// ---------------------------------------------------------------------------

const {
  mockRedisGet,
  mockRedisSet,
  mockRedisDel,
  mockRedisSendCommand,
  mockSql,
} = vi.hoisted(() => {
  const mockRedisGet = vi.fn();
  const mockRedisSet = vi.fn().mockResolvedValue("OK");
  const mockRedisDel = vi.fn().mockResolvedValue(1);
  const mockRedisSendCommand = vi.fn().mockImplementation(async (args: any) => {
    const flat = Array.isArray(args) ? (Array.isArray(args[0]) ? args[0] : args) : [args];
    const cmd = String(flat[0]).toUpperCase();
    if (cmd === "SCRIPT") return "mock_sha_123";
    return [1, 60000];
  });
  const mockSql = vi.fn() as any;
  mockSql.query = vi.fn();
  return {
    mockRedisGet,
    mockRedisSet,
    mockRedisDel,
    mockRedisSendCommand,
    mockSql,
  };
});

vi.mock("./utils/redis.js", () => ({
  redisClient: {
    isOpen: true,
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
    sendCommand: mockRedisSendCommand,
  },
  connectRedis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./utils/db.js", () => ({ sql: mockSql }));

vi.mock("./producer.js", () => ({
  connectKafka: vi.fn(),
  publishToTopic: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("axios", () => ({
  default: {
    post: vi.fn().mockResolvedValue({
      data: { url: "https://cdn.example.com/resume.pdf", public_id: "res_001" },
    }),
  },
}));

import app from "./app.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "test-secret";
process.env.SECRET_KEY = SECRET;
process.env.NODE_ENV = "test";
process.env.UPLOAD_SERVICE = "http://localhost:5005";
process.env.INTERNAL_SERVICE_KEY = "internal-key";

function makeToken(userId: number, role: "jobseeker" | "recruiter", jti?: string) {
  const id = jti ?? randomUUID();
  return { token: jwt.sign({ sub: String(userId), jti: id, type: "session" }, SECRET, { expiresIn: "8h" }), jti: id };
}

function makeExpiredToken(userId: number) {
  return jwt.sign({ sub: String(userId), jti: randomUUID(), type: "session" }, SECRET, { expiresIn: -1 });
}

const JOBSEEKER_USER = {
  user_id: 10, name: "Alice", email: "alice@example.com",
  phone_number: "555-0001", role: "jobseeker" as const,
  bio: null, resume: "https://cdn.example.com/resume.pdf",
  resume_public_id: "res_001", profile_pic: null,
  profile_pic_public_id: null, skills: [], subscription: null,
};

const RECRUITER_USER = {
  user_id: 20, name: "Bob", email: "bob@example.com",
  phone_number: "555-0002", role: "recruiter" as const,
  bio: null, resume: null, resume_public_id: null,
  profile_pic: null, profile_pic_public_id: null, skills: [], subscription: null,
};

const OTHER_RECRUITER = { ...RECRUITER_USER, user_id: 30, email: "charlie@example.com" };

// Setup Redis mock: return userId for valid session
function setupValidSession(userId: number, jti: string) {
  mockRedisGet.mockImplementation(async (key: string) => {
    if (key === `session:${jti}`) return String(userId);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Authentication middleware tests
// ---------------------------------------------------------------------------

describe("isAuth middleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when no cookie is present", async () => {
    const res = await request(app).post("/api/job/apply/1");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid token (bad signature)", async () => {
    const res = await request(app)
      .post("/api/job/apply/1")
      .set("Cookie", "jobify_session=definitely.not.a.valid.jwt");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an expired token", async () => {
    const expired = makeExpiredToken(10);
    const res = await request(app)
      .post("/api/job/apply/1")
      .set("Cookie", `jobify_session=${expired}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 for a revoked session (not in Redis)", async () => {
    const { token, jti } = makeToken(10, "jobseeker");
    mockRedisGet.mockResolvedValue(null); // session not in Redis → revoked
    const res = await request(app)
      .post("/api/job/apply/1")
      .set("Cookie", `jobify_session=${token}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 when user_id in Redis doesn't match token sub", async () => {
    const { token, jti } = makeToken(10, "jobseeker");
    mockRedisGet.mockResolvedValue("99"); // different user
    const res = await request(app)
      .post("/api/job/apply/1")
      .set("Cookie", `jobify_session=${token}`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Role authorization
// ---------------------------------------------------------------------------

describe("Role authorization — application endpoints", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recruiter cannot apply for a job (403)", async () => {
    const { token, jti } = makeToken(RECRUITER_USER.user_id, "recruiter");
    setupValidSession(RECRUITER_USER.user_id, jti);
    mockSql.mockResolvedValue([RECRUITER_USER]);

    const res = await request(app)
      .post("/api/job/apply/1")
      .set("Cookie", `jobify_session=${token}`);
    expect(res.status).toBe(403);
  });

  it("jobseeker cannot view applications for a job (403)", async () => {
    const { token, jti } = makeToken(JOBSEEKER_USER.user_id, "jobseeker");
    setupValidSession(JOBSEEKER_USER.user_id, jti);
    mockSql.mockResolvedValue([JOBSEEKER_USER]);

    const res = await request(app)
      .get("/api/job/application/42")
      .set("Cookie", `jobify_session=${token}`);
    expect(res.status).toBe(403);
  });

  it("jobseeker cannot update application status (403)", async () => {
    const { token, jti } = makeToken(JOBSEEKER_USER.user_id, "jobseeker");
    setupValidSession(JOBSEEKER_USER.user_id, jti);
    mockSql.mockResolvedValue([JOBSEEKER_USER]);

    const res = await request(app)
      .put("/api/job/application/update/1")
      .set("Cookie", `jobify_session=${token}`)
      .send({ status: "Hired" });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Application creation
// ---------------------------------------------------------------------------

describe("POST /api/job/apply/:jobId — application ownership", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates application for authenticated jobseeker", async () => {
    const { token, jti } = makeToken(JOBSEEKER_USER.user_id, "jobseeker");
    setupValidSession(JOBSEEKER_USER.user_id, jti);
    // isAuth user query
    mockSql.mockResolvedValueOnce([JOBSEEKER_USER]);
    // job lookup
    mockSql.mockResolvedValueOnce([{ job_id: 1, title: "Engineer", is_active: true }]);
    // duplicate check
    mockSql.mockResolvedValueOnce([]); // no existing application
    // insert application
    mockSql.mockResolvedValueOnce([{
      application_id: 100, job_id: 1,
      applicant_user_id: JOBSEEKER_USER.user_id,
      applicant_email: JOBSEEKER_USER.email,
      status: "Submitted", applied_at: new Date().toISOString(),
      resume: JOBSEEKER_USER.resume,
    }]);

    const res = await request(app)
      .post("/api/job/apply/1")
      .set("Cookie", `jobify_session=${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.application.applicant_user_id).toBe(JOBSEEKER_USER.user_id);
  });

  it("returns 409 for duplicate application", async () => {
    const { token, jti } = makeToken(JOBSEEKER_USER.user_id, "jobseeker");
    setupValidSession(JOBSEEKER_USER.user_id, jti);
    // isAuth
    mockSql.mockResolvedValueOnce([JOBSEEKER_USER]);
    // job lookup
    mockSql.mockResolvedValueOnce([{ job_id: 1, title: "Engineer", is_active: true }]);
    // duplicate check — already applied
    mockSql.mockResolvedValueOnce([{ application_id: 99 }]);

    const res = await request(app)
      .post("/api/job/apply/1")
      .set("Cookie", `jobify_session=${token}`)
      .send({});

    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Recruiter application management (ownership)
// ---------------------------------------------------------------------------

describe("GET /api/job/application/:jobId — recruiter ownership", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recruiter can view applications for their own job", async () => {
    const { token, jti } = makeToken(RECRUITER_USER.user_id, "recruiter");
    setupValidSession(RECRUITER_USER.user_id, jti);
    // isAuth
    mockSql.mockResolvedValueOnce([RECRUITER_USER]);
    // job ownership check
    mockSql.mockResolvedValueOnce([{ posted_by_recruiter_id: RECRUITER_USER.user_id }]);
    // applications
    mockSql.mockResolvedValueOnce([{ application_id: 1, job_id: 5, status: "Submitted" }]);

    const res = await request(app)
      .get("/api/job/application/5")
      .set("Cookie", `jobify_session=${token}`);

    expect(res.status).toBe(200);
  });

  it("recruiter cannot view applications for another recruiter's job (403)", async () => {
    const { token, jti } = makeToken(OTHER_RECRUITER.user_id, "recruiter");
    setupValidSession(OTHER_RECRUITER.user_id, jti);
    // isAuth — returns other recruiter
    mockSql.mockResolvedValueOnce([OTHER_RECRUITER]);
    // job ownership: owned by RECRUITER_USER (20), not OTHER_RECRUITER (30)
    mockSql.mockResolvedValueOnce([{ posted_by_recruiter_id: RECRUITER_USER.user_id }]);

    const res = await request(app)
      .get("/api/job/application/5")
      .set("Cookie", `jobify_session=${token}`);

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Application status update
// ---------------------------------------------------------------------------

describe("PUT /api/job/application/update/:id — status contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 for invalid status value", async () => {
    const { token, jti } = makeToken(RECRUITER_USER.user_id, "recruiter");
    setupValidSession(RECRUITER_USER.user_id, jti);
    mockSql.mockResolvedValueOnce([RECRUITER_USER]);
    // fetch application
    mockSql.mockResolvedValueOnce([{ application_id: 1, job_id: 5, status: "Submitted", applicant_email: "a@b.com" }]);
    // fetch job
    mockSql.mockResolvedValueOnce([{ posted_by_recruiter_id: RECRUITER_USER.user_id, title: "Dev" }]);

    const res = await request(app)
      .put("/api/job/application/update/1")
      .set("Cookie", `jobify_session=${token}`)
      .send({ status: "INVALID_STATUS" });

    expect(res.status).toBe(400);
  });

  it("returns 409 for invalid status transition (Hired → Rejected)", async () => {
    const { token, jti } = makeToken(RECRUITER_USER.user_id, "recruiter");
    setupValidSession(RECRUITER_USER.user_id, jti);
    mockSql.mockResolvedValueOnce([RECRUITER_USER]);
    mockSql.mockResolvedValueOnce([{ application_id: 1, job_id: 5, status: "Hired", applicant_email: "a@b.com" }]);
    mockSql.mockResolvedValueOnce([{ posted_by_recruiter_id: RECRUITER_USER.user_id, title: "Dev" }]);

    const res = await request(app)
      .put("/api/job/application/update/1")
      .set("Cookie", `jobify_session=${token}`)
      .send({ status: "Rejected" });

    expect(res.status).toBe(409);
  });

  it("recruiter from another company cannot update application (403)", async () => {
    const { token, jti } = makeToken(OTHER_RECRUITER.user_id, "recruiter");
    setupValidSession(OTHER_RECRUITER.user_id, jti);
    mockSql.mockResolvedValueOnce([OTHER_RECRUITER]);
    // application belongs to a job posted by RECRUITER_USER
    mockSql.mockResolvedValueOnce([{ application_id: 1, job_id: 5, status: "Submitted", applicant_email: "a@b.com" }]);
    mockSql.mockResolvedValueOnce([{ posted_by_recruiter_id: RECRUITER_USER.user_id, title: "Dev" }]);

    const res = await request(app)
      .put("/api/job/application/update/1")
      .set("Cookie", `jobify_session=${token}`)
      .send({ status: "Rejected" });

    // Ownership check: job.posted_by_recruiter_id (20) !== other recruiter (30)
    expect([403, 404]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

describe("CORS enforcement", () => {
  beforeEach(() => {
    process.env.CORS_ORIGINS = "http://localhost:3000";
    vi.clearAllMocks();
  });

  it("allows requests from configured origin", async () => {
    const res = await request(app)
      .options("/api/job/all")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET");
    // 204 or 200 is correct for preflight; not a CORS error
    expect([200, 204]).toContain(res.status);
  });

  it("rejects requests from disallowed origin", async () => {
    const res = await request(app)
      .options("/api/job/all")
      .set("Origin", "http://evil.example.com")
      .set("Access-Control-Request-Method", "GET");
    // Express CORS middleware returns 500 with an error for disallowed origins
    expect(res.status).not.toBe(200);
    expect(res.headers["access-control-allow-origin"]).not.toBe("http://evil.example.com");
  });
});
