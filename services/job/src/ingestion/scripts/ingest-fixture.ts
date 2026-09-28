/**
 * Phase 3 — `npm run ingest:fixture`
 *
 * Runs the full ingestion pipeline against the local fixture source
 * (no internet access required) and prints a concise summary.
 * Safe to re-run: repeated executions update `last_seen_at` without
 * creating duplicate rows.
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

const db = neon(connectionString) as unknown as import("../repository.js").SqlClient;

const adapter = sourceRegistry.createAdapter("fixture");
const summary = await runIngestion({ source: "fixture", adapter, db });

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
console.log("");
console.log(`Status: ${summary.status}`);

process.exit(summary.status === "failed" ? 1 : 0);
