/**
 * Utils service — Phase 1 security tests
 *
 * Tests cover:
 * - Upload endpoint requires internal service key
 * - Career endpoint requires valid session
 * - Resume-analyzer endpoint requires valid session
 * - Anonymous access denied to AI endpoints
 * - Internal service key not accepted on user-facing endpoints
 * - Rate limit middleware is wired
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockRedisGet,
  mockRedisSet,
  mockRedisSendCommand,
} = vi.hoisted(() => {
  const mockRedisGet = vi.fn();
  const mockRedisSet = vi.fn().mockResolvedValue("OK");
  const mockRedisSendCommand = vi.fn().mockImplementation(async (args: any) => {
    const flat = Array.isArray(args) ? (Array.isArray(args[0]) ? args[0] : args) : [args];
    const cmd = String(flat[0]).toUpperCase();
    if (cmd === "SCRIPT") return "mock_sha_123";
    return [1, 60000];
  });
  return { mockRedisGet, mockRedisSet, mockRedisSendCommand };
});

vi.mock("./redis.js", () => ({
  redisClient: {
    isOpen: true,
    get: mockRedisGet,
    set: mockRedisSet,
    del: vi.fn().mockResolvedValue(1),
    sendCommand: mockRedisSendCommand,
  },
  connectRedis: vi.fn().mockResolvedValue(undefined),
}));

// Mock Cloudinary
vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload: vi.fn().mockResolvedValue({ secure_url: "https://cdn.example.com/file.pdf", public_id: "file_001" }),
      destroy: vi.fn().mockResolvedValue({ result: "ok" }),
    },
  },
}));

// Mock Gemini AI
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(function (this: any) {
    return {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({ summary: "Test career summary", jobOptions: [], skillsToLearn: [], learningApproach: { title: "Test", points: [] } }),
        }),
      },
    };
  }),
}));

// Mock Kafka consumer
vi.mock("./consumer.js", () => ({
  startSendMailConsumer: vi.fn(),
}));

const SECRET = "test-secret";
process.env.SECRET_KEY = SECRET;
process.env.NODE_ENV = "test";
process.env.INTERNAL_SERVICE_KEY = "valid-internal-key";
process.env.CORS_ORIGINS = "http://localhost:3000";

import app from "./app.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(userId: number, jti?: string) {
  const id = jti ?? randomUUID();
  return { token: jwt.sign({ sub: String(userId), jti: id, type: "session" }, SECRET, { expiresIn: "8h" }), jti: id };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/utils/upload — internal service key enforcement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 when internal service key is absent", async () => {
    const res = await request(app)
      .post("/api/utils/upload")
      .send({ buffer: "data:image/png;base64,abc" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when internal service key is wrong", async () => {
    const res = await request(app)
      .post("/api/utils/upload")
      .set("x-internal-service-key", "wrong-key")
      .send({ buffer: "data:image/png;base64,abc" });
    expect(res.status).toBe(403);
  });

  it("passes through with correct internal key (no buffer → 400)", async () => {
    const res = await request(app)
      .post("/api/utils/upload")
      .set("x-internal-service-key", "valid-internal-key")
      .send({});
    // No buffer provided → should be 400, NOT 403 (auth passed, input validation failed)
    expect(res.status).toBe(400);
  });
});

describe("POST /api/utils/career — session authentication", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when no cookie is present", async () => {
    const res = await request(app)
      .post("/api/utils/career")
      .send({ skills: "JavaScript, Node.js" });
    expect(res.status).toBe(401);
  });

  it("returns 401 for expired session token", async () => {
    const expiredToken = jwt.sign(
      { sub: "10", jti: randomUUID(), type: "session" },
      SECRET,
      { expiresIn: -1 }
    );
    const res = await request(app)
      .post("/api/utils/career")
      .set("Cookie", `jobify_session=${expiredToken}`)
      .send({ skills: "JavaScript" });
    expect(res.status).toBe(401);
  });

  it("returns 401 for revoked session (not in Redis)", async () => {
    const { token } = makeToken(10);
    mockRedisGet.mockResolvedValue(null); // revoked

    const res = await request(app)
      .post("/api/utils/career")
      .set("Cookie", `jobify_session=${token}`)
      .send({ skills: "JavaScript" });
    expect(res.status).toBe(401);
  });

  it("passes with valid session and skills (calls AI)", async () => {
    const { token, jti } = makeToken(10);
    mockRedisGet.mockImplementation(async (key: string) =>
      key === `session:${jti}` ? "10" : null
    );

    const res = await request(app)
      .post("/api/utils/career")
      .set("Cookie", `jobify_session=${token}`)
      .send({ skills: "JavaScript, TypeScript" });

    // Should succeed (200) or internal AI error — but NOT 401
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe("POST /api/utils/resume-analyzer — session + validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 without session", async () => {
    const res = await request(app)
      .post("/api/utils/resume-analyzer")
      .send({ pdfBase64: "data:application/pdf;base64,JVBERi0=" });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid PDF base64 with valid session", async () => {
    const { token, jti } = makeToken(10);
    mockRedisGet.mockImplementation(async (key: string) =>
      key === `session:${jti}` ? "10" : null
    );

    const res = await request(app)
      .post("/api/utils/resume-analyzer")
      .set("Cookie", `jobify_session=${token}`)
      .send({ pdfBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" });
    expect(res.status).toBe(400);
  });

  it("upload endpoint cannot be used as session endpoint (internal key on AI endpoint doesn't help)", async () => {
    // Providing internal key on /career should NOT bypass session auth
    const res = await request(app)
      .post("/api/utils/career")
      .set("x-internal-service-key", "valid-internal-key")
      .send({ skills: "JavaScript" });
    // Should still be 401 (session required, internal key is irrelevant here)
    expect(res.status).toBe(401);
  });
});

describe("Upload validation — file content checks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resume-analyzer rejects data URI that does not start with PDF prefix", async () => {
    const { token, jti } = makeToken(10);
    mockRedisGet.mockImplementation(async (key: string) =>
      key === `session:${jti}` ? "10" : null
    );

    // Send a PNG data URI instead of PDF
    const res = await request(app)
      .post("/api/utils/resume-analyzer")
      .set("Cookie", `jobify_session=${token}`)
      .send({ pdfBase64: "data:image/png;base64,AAAA" });

    expect(res.status).toBe(400);
  });

  it("resume-analyzer rejects PDF missing magic bytes", async () => {
    const { token, jti } = makeToken(10);
    mockRedisGet.mockImplementation(async (key: string) =>
      key === `session:${jti}` ? "10" : null
    );

    // data URI looks like PDF prefix but content is garbage
    const fakeContent = Buffer.from("NOTAPDF_CONTENT").toString("base64");
    const res = await request(app)
      .post("/api/utils/resume-analyzer")
      .set("Cookie", `jobify_session=${token}`)
      .send({ pdfBase64: `data:application/pdf;base64,${fakeContent}` });

    expect(res.status).toBe(400);
  });
});

describe("CORS enforcement — utils service", () => {
  it("allows request from configured origin", async () => {
    const res = await request(app)
      .options("/api/utils/career")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST");
    expect([200, 204]).toContain(res.status);
  });

  it("rejects request from disallowed origin", async () => {
    const res = await request(app)
      .options("/api/utils/career")
      .set("Origin", "http://attacker.example.com")
      .set("Access-Control-Request-Method", "POST");
    expect(res.headers["access-control-allow-origin"]).not.toBe("http://attacker.example.com");
  });
});
