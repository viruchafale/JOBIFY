import express from "express";
import dotenv from "dotenv";
import jobRoutes from "./routes/job.js";
import cors from "cors";
import cookieParser from "cookie-parser";
import { requestTracker, errorHandler } from "./middleware/observability.js";
import { sql } from "./utils/db.js";
import { redisClient } from "./utils/redis.js";

dotenv.config();

const app = express();

app.use(requestTracker("job"));

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.includes(origin)) return callback(null, true); callback(new Error("Origin is not allowed")); }, credentials: true }));
app.use(cookieParser());
app.use(express.json());

// Health and Readiness
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "job",
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
    service: "job",
    checks,
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/job", jobRoutes);

// Error handling middleware
app.use(errorHandler);

export default app;
