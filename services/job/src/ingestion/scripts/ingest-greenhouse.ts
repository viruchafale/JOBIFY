/**
 * Phase 5 — `npm run ingest:greenhouse`
 *
 * Runs the same `runIngestion()` pipeline used by `ingest:fixture` and
 * `ingest:lever`, against the Greenhouse boards configured in
 * `GREENHOUSE_COMPANIES`. No Greenhouse-specific persistence/normalization/
 * dedupe logic lives here — only wiring.
 */

import dotenv from "dotenv";
import postgres from "postgres";
import { runIngestion } from "../runner.js";
import { sourceRegistry } from "../registry.js";
import "../sources/index.js";

dotenv.config();

const connectionString = process.env.DATABASE_URL ?? process.env.DB_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL (or DB_URL) environment variable.");
  process.exit(1);
}

if (!process.env.GREENHOUSE_COMPANIES || process.env.GREENHOUSE_COMPANIES.trim() === "") {
  console.error(
    "Missing GREENHOUSE_COMPANIES environment variable (comma-separated Greenhouse board tokens, e.g. GREENHOUSE_COMPANIES=gitlab).",
  );
  process.exit(1);
}

const pg = postgres(connectionString);
const db: import("../repository.js").SqlClient = {
  query: (text, params) => pg.unsafe(text, (params ?? []) as any),
};

const adapter = sourceRegistry.createAdapter("greenhouse");
const summary = await runIngestion({ source: "greenhouse", adapter, db });

console.log("");
console.log("JobiFy Ingestion");
console.log(`Source: ${summary.source}`);
console.log("");
console.log(`Fetched:   ${summary.fetchedCount}`);
console.log(`Accepted:  ${summary.acceptedCount}`);
console.log(`Rejected:  ${summary.rejectedCount}`);
console.log(`Inserted:  ${summary.insertedCount}`);
console.log(`Updated:   ${summary.updatedCount}`);
console.log(`Duplicates: ${summary.duplicateCount}`);
console.log(`Errors:    ${summary.errorCount}`);
if (summary.errorMessage) {
  console.log(`Error:     ${summary.errorMessage}`);
}
console.log("");
console.log(`Status: ${summary.status}`);

process.exit(summary.status === "failed" ? 1 : 0);
