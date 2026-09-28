/**
 * Phase 4 — `npm run ingest:lever`
 *
 * Runs the same `runIngestion()` pipeline used by `ingest:fixture`, against
 * the Lever companies configured in `LEVER_COMPANIES`. No Lever-specific
 * persistence/normalization/dedupe logic lives here — only wiring.
 */

import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";
import { runIngestion } from "../runner.js";
import { sourceRegistry } from "../registry.js";
import "../sources/index.js";

dotenv.config();

const connectionString = process.env.DATABASE_URL ?? process.env.DB_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL (or DB_URL) environment variable.");
  process.exit(1);
}

if (!process.env.LEVER_COMPANIES || process.env.LEVER_COMPANIES.trim() === "") {
  console.error(
    "Missing LEVER_COMPANIES environment variable (comma-separated Lever company slugs, e.g. LEVER_COMPANIES=palantir).",
  );
  process.exit(1);
}

const db = neon(connectionString) as unknown as import("../repository.js").SqlClient;

const adapter = sourceRegistry.createAdapter("lever");
const summary = await runIngestion({ source: "lever", adapter, db });

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
