import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "./app.js";

describe("API Gateway Tests", () => {
  it("GET /health returns 200 and gateway status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("gateway");
    expect(res.body.uptime).toBeTypeOf("number");
  });

  it("GET /ready returns 200 ready status", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.service).toBe("gateway");
  });

  it("injects and returns x-request-id header", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toBeDefined();
    expect(typeof res.headers["x-request-id"]).toBe("string");
  });

  it("propagates provided x-request-id", async () => {
    const customId = "custom-uuid-12345";
    const res = await request(app)
      .get("/health")
      .set("x-request-id", customId);
    expect(res.headers["x-request-id"]).toBe(customId);
  });

  it("sets security headers via Helmet", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("returns structured 404 error envelope for unknown routes", async () => {
    const res = await request(app).get("/api/unknown-endpoint");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
    expect(res.body.message).toContain("Route not found");
    expect(res.body.requestId).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
  });
});
