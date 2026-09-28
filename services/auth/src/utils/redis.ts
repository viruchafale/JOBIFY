import { createClient } from "redis";

export const redisClient = createClient({ url: process.env.REDIS_URL });

export async function connectRedis() {
  if (!redisClient.isOpen) await redisClient.connect();
}
