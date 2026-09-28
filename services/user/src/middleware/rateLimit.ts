import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redisClient } from "../utils/redis.js";
import type { AuthenticatedRequest } from "./auth.js";

export const uploadLimit = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  store: new RedisStore({ prefix: "rl:user-upload:", sendCommand: (...args: string[]) => redisClient.sendCommand(args) }),
  keyGenerator: (req) => String((req as AuthenticatedRequest).user?.user_id || req.ip),
  message: { message: "Too many uploads, please try again later" },
});
