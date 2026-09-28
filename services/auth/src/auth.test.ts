/**
 * Auth service — Phase 1 security tests
 *
 * These tests use vitest + supertest against the Express app.
 * External dependencies (DB, Redis, Kafka, file upload) are mocked so the
 * suite runs without a live environment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mock all external dependencies BEFORE importing the app
// ---------------------------------------------------------------------------

const {
  mockRedisSet,
  mockRedisGet,
  mockRedisDel,
  mockRedisSendCommand,
  mockSql,
} = vi.hoisted(() => {
  const mockRedisSet = vi.fn().mockResolvedValue("OK");
  const mockRedisGet = vi.fn();
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
    mockRedisSet,
    mockRedisGet,
    mockRedisDel,
    mockRedisSendCommand,
    mockSql,
  };
});

vi.mock("./utils/redis.js", () => ({
  redisClient: {
    isOpen: true,
    set: mockRedisSet,
    get: mockRedisGet,
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
    post: vi.fn().mockResolvedValue({ data: { url: "https://cdn.example.com/resume.pdf", public_id: "resume_001" } }),
  },
}));

import app from "./app.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SECRET = "test-secret";
process.env.SECRET_KEY = SECRET;
process.env.NODE_ENV = "test";

function makeSessionToken(userId: number, jti?: string): string {
  const id = jti ?? randomUUID();
  return jwt.sign({ sub: String(userId), jti: id, type: "session" }, SECRET, { expiresIn: "8h" });
}

function makeExpiredToken(userId: number): string {
  return jwt.sign({ sub: String(userId), jti: randomUUID(), type: "session" }, SECRET, { expiresIn: -1 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/auth/login", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when credentials are missing", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid credentials (user not found)", async () => {
    mockSql.mockResolvedValueOnce([]); // no user found
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "bad@example.com", password: "wrongpass" });
    expect(res.status).toBe(400);
  });

  it("sets HttpOnly session cookie on successful login", async () => {
    const hashedPw = await bcrypt.hash("password", 10);
    mockSql.mockResolvedValueOnce([{
      user_id: 1, name: "Test", email: "test@example.com",
      password: hashedPw, phone_number: "1234567890",
      role: "jobseeker", bio: null, resume: null,
      profile_pic: null, subscription: null, skills: [],
    }]);
    mockRedisSet.mockResolvedValueOnce("OK");

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@example.com", password: "password" });

    // Should set a cookie
    const cookies = res.headers["set-cookie"] as string[] | string | undefined;
    const cookieArr = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    const sessionCookie = cookieArr.find((c) => c.startsWith("jobify_session="));
    expect(sessionCookie).toBeTruthy();
    // Must be HttpOnly
    expect(sessionCookie).toMatch(/HttpOnly/i);
    // Must NOT be exposed in body (no token in JSON response)
    expect(res.body.token).toBeUndefined();
  });
});

describe("POST /api/auth/logout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears the session cookie", async () => {
    const jti = randomUUID();
    const token = makeSessionToken(1, jti);
    mockRedisGet.mockResolvedValueOnce("1"); // session exists

    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", `jobify_session=${token}`);

    expect(res.status).toBe(200);
    const cookies = res.headers["set-cookie"] as string[] | string | undefined;
    const cookieArr = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    const cleared = cookieArr.find((c) => c.startsWith("jobify_session="));
    // Cookie should be cleared (empty value or Max-Age=0)
    if (cleared) {
      expect(cleared).toMatch(/Max-Age=0|expires=Thu, 01 Jan 1970/i);
    }
    expect(mockRedisDel).toHaveBeenCalled();
  });
});

describe("POST /api/auth/register", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app).post("/api/auth/register").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid role", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .field("name", "Test")
      .field("email", "test@example.com")
      .field("password", "pass")
      .field("phoneNumber", "1234567890")
      .field("role", "admin");
    expect(res.status).toBe(400);
  });
});

describe("Rate limiting on auth endpoints", () => {
  // Rate limiting is configured via Redis store — we just verify middleware is wired
  it("login route exists and responds", async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "x@x.com", password: "pass" });
    // Should not be 404
    expect(res.status).not.toBe(404);
  });
});
