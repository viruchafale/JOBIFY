import { connectRedis, redisClient } from "./utils/redis.js";

const port = process.env.PORT || 5006;
let server: any;

// `app.js` is imported dynamically, only after Redis is connected: it
// transitively imports rateLimit.ts, whose RedisStore constructs eagerly and
// sends a command as soon as the module loads. A static top-level import
// would evaluate that before connectRedis() below ever runs, crashing the
// process with "ClientClosedError" the instant a real Redis is present.
connectRedis()
  .then(async () => {
    const { default: app } = await import("./app.js");
    server = app.listen(port, () => {
      console.log(`User service is running on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start user service:", err);
    process.exit(1);
  });

async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}, shutting down user service gracefully...`);
  if (server) {
    server.close(() => {
      console.log("HTTP server closed.");
    });
  }
  try {
    if (redisClient.isOpen) {
      await redisClient.quit();
      console.log("Redis client disconnected.");
    }
  } catch (err) {
    console.error("Error during graceful shutdown:", err);
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
