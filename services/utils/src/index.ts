import { v2 as cloudinary } from "cloudinary";
import { startSendMailConsumer, stopSendMailConsumer } from "./consumer.js";
import { connectRedis, redisClient } from "./redis.js";

startSendMailConsumer();

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

const port = process.env.PORT || 5005;
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
      console.log(`✅ Utils service is running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start utils service:", err);
    process.exit(1);
  });

async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}, shutting down utils service gracefully...`);
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
    await stopSendMailConsumer();
  } catch (err) {
    console.error("Error during graceful shutdown:", err);
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
