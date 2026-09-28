import app from "./app.js";
import { connectRedis, redisClient } from "./utils/redis.js";

const port = process.env.PORT || 5006;
let server: any;

connectRedis()
  .then(() => {
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
