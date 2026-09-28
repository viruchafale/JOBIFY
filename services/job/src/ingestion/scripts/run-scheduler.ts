/**
 * Phase 6 — `npm run ingest:scheduler` (long-running) and
 * `npm run ingest:scheduler -- --once` (one-shot: run every configured
 * source immediately, ignoring cron timing, then exit — for verifying the
 * scheduler without waiting for a real interval).
 *
 * This process only decides which source is due and delegates to
 * executeSourceIngestion() -> runIngestion(); it contains no pipeline logic
 * of its own. It is intentionally a separate entrypoint from index.ts (the
 * API server) so the API process never accidentally spawns a scheduler.
 */

import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";
import { loadReliabilityConfig } from "../scheduler/config.js";
import { Scheduler } from "../scheduler/scheduler.js";
import { sourceRegistry } from "../sources/index.js";
import type { SqlClient } from "../repository.js";

dotenv.config();

const connectionString = process.env.DATABASE_URL ?? process.env.DB_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL (or DB_URL) environment variable.");
  process.exit(1);
}

const once = process.argv.includes("--once");

let config;
try {
  config = loadReliabilityConfig(
    process.env,
    sourceRegistry.list().map((definition) => definition.source),
  );
} catch (error) {
  console.error(`Invalid scheduler configuration: ${(error as Error).message}`);
  process.exit(1);
}

if (!once && !config.enabled) {
  console.error(
    "INGESTION_SCHEDULER_ENABLED is not \"true\" — refusing to start the long-running scheduler. " +
      "Set INGESTION_SCHEDULER_ENABLED=true, or pass --once to run configured sources one time regardless.",
  );
  process.exit(1);
}

if (config.schedules.length === 0) {
  console.error("No schedules configured (INGESTION_SCHEDULES is empty). Nothing to do.");
  process.exit(1);
}

const db = neon(connectionString) as unknown as SqlClient;
const scheduler = new Scheduler({ db, config });

if (once) {
  console.log("Scheduler started (one-shot mode)");
  console.log(`Configured sources: ${config.schedules.map((s) => s.source).join(", ")}`);
  console.log("");

  const results = await scheduler.runOnce();
  let anyFailed = false;
  for (const entry of config.schedules) {
    const result = results.get(entry.source);
    if (!result) continue;
    if (!result.locked) {
      console.log(`${entry.source}: lock not acquired (already running elsewhere) — skipped`);
      continue;
    }
    for (const summary of result.summaries) {
      console.log(
        `${entry.source} [attempt ${summary.attempt}, trigger=${summary.triggerType}]: ` +
          `status=${summary.status} fetched=${summary.fetchedCount} accepted=${summary.acceptedCount} ` +
          `rejected=${summary.rejectedCount} inserted=${summary.insertedCount} updated=${summary.updatedCount} ` +
          `duplicates=${summary.duplicateCount} errors=${summary.errorCount}`,
      );
      if (summary.errorMessage) console.log(`  error: ${summary.errorMessage}`);
      if (summary.status === "failed") anyFailed = true;
    }
  }
  process.exit(anyFailed ? 1 : 0);
} else {
  console.log("Scheduler started");
  console.log(
    `Configured sources: ${config.schedules.map((s) => `${s.source} (${s.cronExpression})`).join(", ")}`,
  );
  console.log(`Timezone: ${config.timezone}, max concurrency: ${config.maxConcurrency}`);
  scheduler.start();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down scheduler gracefully...`);
    await scheduler.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
