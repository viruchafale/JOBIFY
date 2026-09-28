import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redisClient } from "../utils/redis.js";

const store = (prefix: string) => new RedisStore({ prefix, sendCommand: (...args: string[]) => redisClient.sendCommand(args) });
const create = (windowMs: number, limit: number, prefix: string) => rateLimit({ windowMs, limit, standardHeaders: "draft-8", legacyHeaders: false, store: store(prefix), message: { message: "Too many requests, please try again later" } });

export const authRateLimits = {
  register: create(60 * 60 * 1000, 5, "rl:register:"),
  login: create(15 * 60 * 1000, 10, "rl:login:"),
  forgot: create(60 * 60 * 1000, 3, "rl:forgot:"),
  reset: create(15 * 60 * 1000, 5, "rl:reset:"),
};
