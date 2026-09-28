/**
 * Phase 3 — External jobs read API tests.
 *
 * Covers: listing, title/location/source filters, invalid input handling,
 * single-job fetch and 404s. DB access is mocked; existing Phase 1/2 tests
 * are untouched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockQuery, mockRedisGet, mockRedisSendCommand } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockRedisGet = vi.fn();
  const mockRedisSendCommand = vi.fn().mockImplementation(async (args: any) => {
    const flat = Array.isArray(args) ? (Array.isArray(args[0]) ? args[0] : args) : [args];
    const cmd = String(flat[0]).toUpperCase();
    if (cmd === "SCRIPT") return "mock_sha_123";
    return [1, 60000];
  });
  return { mockQuery, mockRedisGet, mockRedisSendCommand };
});

vi.mock("../utils/redis.js", () => ({
  redisClient: {
    isOpen: true,
    get: mockRedisGet,
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    sendCommand: mockRedisSendCommand,
  },
  connectRedis: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/db.js", () => ({
  sql: { query: mockQuery },
}));

vi.mock("../producer.js", () => ({
  connectKafka: vi.fn(),
  publishToTopic: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("axios", () => ({
  default: { post: vi.fn() },
}));

import app from "../app.js";

const SAMPLE_ROW = {
  id: 1,
  source: "fixture",
  source_job_id: "fx-001",
  canonical_url: "https://acme.example.com/careers/fx-001",
  apply_url: "https://acme.example.com/careers/fx-001/apply",
  company_name: "Acme Corp",
  title: "Senior Software Engineer",
  description: "Build distributed systems.",
  location: "San Francisco, CA",
  job_type: "Full-time",
  work_location: "Remote",
  role: "Engineering",
  salary_min: 150000,
  salary_max: 190000,
  salary_currency: "USD",
  posted_at: "2026-09-01T10:00:00.000Z",
  first_seen_at: "2026-09-17T00:00:00.000Z",
  last_seen_at: "2026-09-17T00:00:00.000Z",
  is_active: true,
  content_fingerprint: "abc123",
  created_at: "2026-09-17T00:00:00.000Z",
  updated_at: "2026-09-17T00:00:00.000Z",
};

describe("GET /api/job/external", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns normalized external jobs", async () => {
    mockQuery.mockResolvedValue([SAMPLE_ROW]);
    const res = await request(app).get("/api/job/external");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([SAMPLE_ROW]);
  });

  it("forwards title/location/source filters to the query", async () => {
    mockQuery.mockResolvedValue([]);
    const res = await request(app).get(
      "/api/job/external?title=engineer&location=francisco&source=fixture",
    );
    expect(res.status).toBe(200);
    const [text, params] = mockQuery.mock.calls[0];
    expect(text).toContain("ILIKE");
    expect(text).toContain("source =");
    expect(params).toEqual(
      expect.arrayContaining(["%engineer%", "%francisco%", "fixture"]),
    );
  });

  it("rejects an invalid limit consistently (400 envelope)", async () => {
    const res = await request(app).get("/api/job/external?limit=9999");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/limit/i);
  });

  it("propagates x-request-id", async () => {
    mockQuery.mockResolvedValue([]);
    const res = await request(app)
      .get("/api/job/external")
      .set("x-request-id", "test-id-123");
    expect(res.headers["x-request-id"]).toBe("test-id-123");
  });
});

describe("GET /api/job/external/search", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockSearchDb(rows: Record<string, any>[]) {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes("search:count")) return [{ total: rows.length }];
      if (text.includes("search:select")) return rows;
      throw new Error(`unexpected query in test: ${text}`);
    });
  }

  it("returns the {data:{items,pagination}} envelope", async () => {
    mockSearchDb([SAMPLE_ROW]);
    const res = await request(app).get("/api/job/external/search?q=engineer");
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([SAMPLE_ROW]);
    expect(res.body.data.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it("is matched before /external/:id (route ordering)", async () => {
    mockSearchDb([]);
    const res = await request(app).get("/api/job/external/search");
    // If "/external/:id" had matched instead, this would 400 with "Invalid external job id."
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });

  it("returns an empty page without querying SELECT when count is 0", async () => {
    mockSearchDb([]);
    const res = await request(app).get("/api/job/external/search?q=nonexistent-xyz");
    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(0);
    expect(res.body.data.pagination.totalPages).toBe(0);
  });

  it("rejects an invalid limit (400 envelope, same shape as /external)", async () => {
    const res = await request(app).get("/api/job/external/search?limit=9999");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/limit/i);
  });

  it("rejects an unknown source", async () => {
    const res = await request(app).get("/api/job/external/search?source=not-a-real-source");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unknown source/i);
  });

  it("rejects an invalid jobType enum", async () => {
    const res = await request(app).get("/api/job/external/search?jobType=banana");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/jobType/i);
  });

  it("rejects an oversized query string", async () => {
    const res = await request(app).get(`/api/job/external/search?q=${"a".repeat(300)}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/200 characters/i);
  });

  it("applies multiple filters with AND semantics", async () => {
    mockSearchDb([SAMPLE_ROW]);
    const res = await request(app).get(
      "/api/job/external/search?q=backend&location=India&workLocation=remote&source=lever",
    );
    expect(res.status).toBe(200);
    const countCall = mockQuery.mock.calls.find(([text]) => text.includes("search:count"))!;
    const [text, params] = countCall;
    expect(text).toContain("is_active = $1");
    expect(text).toContain("search_vector @@ websearch_to_tsquery");
    expect(text).toContain("location ILIKE");
    expect(text).toContain("source = ANY(");
    expect(text).toContain("work_location =");
    expect(params).toContain("%India%");
    expect(params).toContain("Remote");
  });

  it("does not crash on SQL-injection-style / malicious query payloads (validation + parameterization only)", async () => {
    mockSearchDb([]);
    const payloads = [
      "'; DROP TABLE external_jobs; --",
      "\" OR 1=1 --",
      "<script>alert(1)</script>",
      "% ' \" ; -- /*",
    ];
    for (const payload of payloads) {
      const res = await request(app).get(`/api/job/external/search?q=${encodeURIComponent(payload)}`);
      expect(res.status).toBe(200);
      const countCall = mockQuery.mock.calls.find(([text]) => text.includes("search:count"))!;
      expect(countCall[1]).toContain(payload); // passed as a bound parameter, never concatenated into SQL text
      mockQuery.mockClear();
      mockSearchDb([]);
    }
  });

  it("propagates x-request-id", async () => {
    mockSearchDb([]);
    const res = await request(app)
      .get("/api/job/external/search")
      .set("x-request-id", "test-id-456");
    expect(res.headers["x-request-id"]).toBe("test-id-456");
  });
});

describe("GET /api/job/external/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a single external job", async () => {
    mockQuery.mockResolvedValue([SAMPLE_ROW]);
    const res = await request(app).get("/api/job/external/1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it("returns 404 for unknown ids", async () => {
    mockQuery.mockResolvedValue([]);
    const res = await request(app).get("/api/job/external/999");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid ids", async () => {
    const res = await request(app).get("/api/job/external/abc");
    expect(res.status).toBe(400);
  });
});
