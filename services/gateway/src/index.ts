import app from "./app.js";

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Jobify API Gateway running on port ${PORT}`);
});

async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}, shutting down Gateway gracefully...`);
  if (server) {
    server.close(() => {
      console.log("Gateway HTTP server closed.");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
