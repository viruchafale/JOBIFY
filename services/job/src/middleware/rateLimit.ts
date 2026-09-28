import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redisClient } from "../utils/redis.js";
import type { AuthenticatedRequest } from "./auth.js";

export const applicationSubmissionLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  store: new RedisStore({ prefix: "rl:apply:", sendCommand: (...args: string[]) => redisClient.sendCommand(args) }),
  keyGenerator: (req) => String((req as AuthenticatedRequest).user?.user_id || req.ip),
  message: { message: "Too many application submissions, please try again later" },
});

export const uploadLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  store: new RedisStore({ prefix: "rl:job-upload:", sendCommand: (...args: string[]) => redisClient.sendCommand(args) }),
  keyGenerator: (req) => String((req as AuthenticatedRequest).user?.user_id || req.ip),
  message: { message: "Too many uploads, please try again later" },
});

// Phase 7 — search is public (no isAuth) and expected to be much
// higher-volume than the authenticated limits above, so it's keyed by IP
// rather than user id. 120 requests/minute per IP is generous for a real
// user (typing + filter changes, even without debouncing) while still
// bounding scripted/abusive traffic; reuses the exact same
// rate-limit/Redis-store pattern as every other limiter in this file.
export const searchLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: new RedisStore({ prefix: "rl:job-search:", sendCommand: (...args: string[]) => redisClient.sendCommand(args) }),
  message: { message: "Too many search requests, please slow down" },
});
