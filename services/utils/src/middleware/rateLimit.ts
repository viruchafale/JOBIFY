import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redisClient } from "../redis.js";
import type { SessionRequest } from "./auth.js";

const perUser = (windowMs: number, limit: number, prefix: string) => rateLimit({
  windowMs, limit, standardHeaders: "draft-8", legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  store: new RedisStore({ prefix, sendCommand: (...args: string[]) => redisClient.sendCommand(args) }),
  keyGenerator: (req) => String((req as SessionRequest).sessionUserId || req.ip),
  message: { message: "Rate limit exceeded, please try again later" },
});

export const careerLimit = perUser(60 * 60 * 1000, 20, "rl:career:");
export const resumeHourlyLimit = perUser(60 * 60 * 1000, 5, "rl:resume-hour:");
export const resumeDailyLimit = perUser(24 * 60 * 60 * 1000, 20, "rl:resume-day:");
