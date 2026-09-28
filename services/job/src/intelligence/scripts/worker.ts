/**
 * Phase 8 — `npm run intelligence:worker`: a small long-running process
 * that periodically processes pending intelligence work, so newly ingested
 * jobs "eventually" get intelligence without polling from the API.
 *
 * This is intentionally NOT the Phase 6 Scheduler: it needs no per-source
 * cron config, no lock table (each tick's DB query only ever selects jobs
 * that still need work, so overlapping ticks — even from two worker
 * processes — simply do some redundant no-op skip-checks, never duplicate
 * writes), and no retry/backoff (a job that fails is naturally retried on
 * the next tick, or reprocessed manually). Reusing the actual Scheduler
 * class here would mean bolting on cron parsing and a lock table this
 * task doesn't need — a plain interval loop is the smaller, correct fit.
 *
 * Deployed as its own container (`job-intelligence-worker` in
 * docker-compose.yml) sharing the same job-service image, same as
 * `job-scheduler` shares it with `job-service`.
 */

import dotenv from "dotenv";
import postgres from "postgres";
import { loadIntelligenceConfig, type IntelligenceConfig } from "../config.js";
import { runIntelligenceBatch } from "../batch.js";
import { logIntelligenceEvent } from "../logger.js";
import type { SqlClient } from "../../ingestion/repository.js";

dotenv.config();

const connectionString = process.env.DATABASE_URL ?? process.env.DB_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL (or DB_URL) environment variable.");
  process.exit(1);
}

let config: IntelligenceConfig;
try {
  config = loadIntelligenceConfig(process.env);
} catch (error) {
  console.error(`Invalid intelligence configuration: ${(error as Error).message}`);
  process.exit(1);
}

const pg = postgres(connectionString);
const db: SqlClient = {
  query: (text, params) => pg.unsafe(text, (params ?? []) as any),
};

let stopped = false;
let running = false;

async function tick(): Promise<void> {
  if (stopped || running) return;
  running = true;
  try {
    const result = await runIntelligenceBatch(db, {
      batchSize: config.batchSize,
      maxConcurrency: config.maxConcurrency,
      config,
    });
    logIntelligenceEvent("intelligence_worker_tick", result as unknown as Record<string, unknown>);
  } catch (error) {
    logIntelligenceEvent("intelligence_failed", { error: (error as Error).message });
  } finally {
    running = false;
  }
}

console.log(`Intelligence worker started (interval=${config.workerIntervalMs}ms, aiEnabled=${config.aiEnabled})`);
await tick();
const timer = setInterval(() => void tick(), config.workerIntervalMs);

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, stopping intelligence worker...`);
  stopped = true;
  clearInterval(timer);
  const start = Date.now();
  while (running && Date.now() - start < 30_000) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
