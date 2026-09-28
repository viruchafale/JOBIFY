import dotenv from "dotenv";
import app from "./app.js";
import { connectKafka, disconnectKafka } from "./producer.js";
import { connectRedis, redisClient } from "./utils/redis.js";

dotenv.config();
const PORT = process.env.PORT || 5007;

let server: any;

connectKafka();

connectRedis()
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`Job service is running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Job service startup failed", err);
    process.exit(1);
  });

async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}, shutting down job service gracefully...`);
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
    await disconnectKafka();
    console.log("Kafka disconnected.");
  } catch (err) {
    console.error("Error during graceful shutdown:", err);
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
