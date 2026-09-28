/**
 * Phase 6 — `npm run ingest:health`
 *
 * Read-only operational CLI over `ingestion_source_health`. No frontend
 * dashboard is built for this (deferred to a later phase per the Phase 6
 * scope) — this is the intended day-to-day operator tool.
 */

import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";
import { listSourceHealth, deriveHealthLabel } from "../scheduler/health.js";
import type { SqlClient } from "../repository.js";

dotenv.config();

const connectionString = process.env.DATABASE_URL ?? process.env.DB_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL (or DB_URL) environment variable.");
  process.exit(1);
}

const db = neon(connectionString) as unknown as SqlClient;
const rows = await listSourceHealth(db);

if (rows.length === 0) {
  console.log("No ingestion runs recorded yet.");
  process.exit(0);
}

function formatTimestamp(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

const header = ["SOURCE", "HEALTH", "LAST STATUS", "LAST RUN", "CONSEC. FAILURES", "TOTAL RUNS"];
const lines = rows.map((row) => [
  row.source,
  deriveHealthLabel(row),
  row.last_status ?? "-",
  formatTimestamp(row.last_run_at),
  String(row.consecutive_failures),
  String(row.total_runs),
]);

const widths = header.map((label, i) => Math.max(label.length, ...lines.map((line) => line[i].length)));
const formatRow = (columns: string[]) => columns.map((c, i) => c.padEnd(widths[i])).join("   ");

console.log(formatRow(header));
for (const line of lines) console.log(formatRow(line));

const unhealthy = rows.filter((row) => deriveHealthLabel(row) === "unhealthy");
process.exit(unhealthy.length > 0 ? 1 : 0);
