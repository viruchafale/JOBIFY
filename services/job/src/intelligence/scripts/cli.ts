/**
 * Phase 8 — Single flexible CLI backing three npm scripts:
 *
 *   npm run intelligence:process -- --job-id=<id> [--force]   (single job)
 *   npm run intelligence:backfill                             (= --all)
 *   npm run intelligence:reprocess                             (= --all --force)
 *
 * One implementation, three entrypoints — avoids duplicating the
 * batch/single-job logic across separate scripts.
 */

import dotenv from "dotenv";
import postgres from "postgres";
import { loadIntelligenceConfig } from "../config.js";
import { processJobIntelligence } from "../processor.js";
import { runIntelligenceBatch } from "../batch.js";
import type { SqlClient } from "../../ingestion/repository.js";

dotenv.config();

const connectionString = process.env.DATABASE_URL ?? process.env.DB_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL (or DB_URL) environment variable.");
  process.exit(1);
}

let config;
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

const args = process.argv.slice(2);
const all = args.includes("--all");
const force = args.includes("--force");
const jobIdArg = args.find((a) => a.startsWith("--job-id="));

if (all) {
  console.log(
    `Running intelligence batch (batchSize=${config.batchSize}, maxConcurrency=${config.maxConcurrency}, force=${force}, aiEnabled=${config.aiEnabled})...`,
  );
  const result = await runIntelligenceBatch(db, {
    batchSize: config.batchSize,
    maxConcurrency: config.maxConcurrency,
    force,
    config,
  });
  console.log("");
  console.log(`Processed:        ${result.processed}`);
  console.log(`Completed:        ${result.completed}`);
  console.log(`Retryable failed: ${result.retryableFailed}`);
  console.log(`Failed:           ${result.failed}`);
  console.log(`Skipped:          ${result.skipped}`);
  process.exit(0);
} else if (jobIdArg) {
  const jobId = Number(jobIdArg.split("=")[1]);
  if (!Number.isInteger(jobId) || jobId < 1) {
    console.error(`Invalid --job-id: "${jobIdArg}"`);
    process.exit(1);
  }
  const result = await processJobIntelligence(db, jobId, { force, config });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "failed" ? 1 : 0);
} else {
  console.error(
    "Usage:\n" +
      "  npm run intelligence:process -- --job-id=<id> [--force]\n" +
      "  npm run intelligence:backfill\n" +
      "  npm run intelligence:reprocess",
  );
  process.exit(1);
}
