import express from "express";
import router from "./routes/auth.js";
import { connectKafka } from "./producer.js";
import cors from "cors";
import cookieParser from "cookie-parser";
import { requestTracker, errorHandler } from "./middleware/observability.js";
import { sql } from "./utils/db.js";
import { redisClient } from "./utils/redis.js";

const app = express();

app.use(requestTracker("auth"));

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.includes(origin)) return callback(null, true); callback(new Error("Origin is not allowed")); }, credentials: true }));
app.use(cookieParser());
app.use(express.json());
connectKafka();

// Health and Readiness
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "auth",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/ready", async (_req, res) => {
  const checks: Record<string, string> = {};
  let isReady = true;

  try {
    await sql`SELECT 1`;
    checks.database = "ok";
  } catch (error) {
    checks.database = "error";
    isReady = false;
  }

  try {
    if (redisClient.isOpen) {
      checks.redis = "ok";
    } else {
      checks.redis = "disconnected";
      isReady = false;
    }
  } catch (error) {
    checks.redis = "error";
    isReady = false;
  }

  res.status(isReady ? 200 : 503).json({
    status: isReady ? "ready" : "unavailable",
    service: "auth",
    checks,
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", router);

// Error handling middleware
app.use(errorHandler);

export default app;
