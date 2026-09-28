import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { createServiceProxy } from "./proxy.js";

dotenv.config();

const app = express();

// 1. Security Headers via Helmet
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// 2. Request Tracker & Structured Logging
app.use((req: any, res, next) => {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  req.id = requestId;
  req.startTime = Date.now();
  res.setHeader("x-request-id", requestId);

  res.on("finish", () => {
    const durationMs = req.startTime ? Date.now() - req.startTime : 0;
    if (req.path !== "/health" && req.path !== "/ready") {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
          service: "gateway",
          requestId,
          method: req.method,
          path: req.originalUrl || req.url,
          status: res.statusCode,
          durationMs,
        })
      );
    }
  });

  next();
});

// 3. Centralized CORS
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error("Origin is not allowed"));
    },
    credentials: true,
  })
);

app.use(cookieParser());

// 4. Gateway Health and Readiness
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "gateway",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/ready", async (_req, res) => {
  res.json({
    status: "ready",
    service: "gateway",
    timestamp: new Date().toISOString(),
  });
});

// 5. Upstream Service Proxies
const AUTH_URL = process.env.AUTH_SERVICE_URL || "http://localhost:5002";
const USER_URL = process.env.USER_SERVICE_URL || "http://localhost:5006";
const JOB_URL = process.env.JOB_SERVICE_URL || "http://localhost:5007";
const UTILS_URL = process.env.UTILS_SERVICE_URL || "http://localhost:5005";

app.use("/api/auth", createServiceProxy(AUTH_URL, "/api/auth"));
app.use("/api/user", createServiceProxy(USER_URL, "/api/user"));
app.use("/api/job", createServiceProxy(JOB_URL, "/api/job"));
app.use("/api/utils", createServiceProxy(UTILS_URL, "/api/utils"));

// 6. 404 Fallback
app.use((req: any, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl || req.url}`,
    code: "NOT_FOUND",
    requestId: req.id,
    timestamp: new Date().toISOString(),
  });
});

// 7. Gateway Error Handler
app.use((err: any, req: any, res: any, _next: any) => {
  const status = Number(err.statusCode || err.status) || 500;
  res.status(status).json({
    message: err.message || "Gateway error",
    code: err.code || "GATEWAY_ERROR",
    requestId: req.id,
    timestamp: new Date().toISOString(),
  });
});

export default app;
