/**
 * Phase 6 — Persistent source health, updated after every ingestion attempt.
 *
 * Semantics (see docs/architecture/PHASE-6-SCHEDULING-RELIABILITY.md §Health):
 *   completed -> success:            consecutive_failures resets to 0
 *   partial   -> degraded, NOT a failure and NOT a success:
 *                consecutive_failures is left untouched (neither reset nor incremented)
 *   failed    -> failure:            consecutive_failures increments
 *
 * `total_runs` counts every attempt (completed + partial + failed).
 * `total_successes` counts only `completed`. `total_failures` counts only
 * `failed`. A `partial` run is recorded (via total_runs and last_status)
 * without being called a success or a failure.
 */

import type { SqlClient } from "../repository.js";
import type { IngestionRunStatus } from "../types.js";

export interface SourceHealthRow {
  source: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_status: IngestionRunStatus | null;
  consecutive_failures: number;
  total_runs: number;
  total_successes: number;
  total_failures: number;
  last_duration_ms: number | null;
  last_error: string | null;
  updated_at: string;
}

export async function upsertSourceHealthAfterRun(
  db: SqlClient,
  source: string,
  /** In practice always a terminal status — runIngestion() never returns "running". */
  status: IngestionRunStatus,
  durationMs: number,
  errorMessage: string | null,
): Promise<void> {
  await db.query(
    `/* scheduler:upsertHealth */ INSERT INTO ingestion_source_health (
       source, last_run_at, last_success_at, last_failure_at, last_status,
       consecutive_failures, total_runs, total_successes, total_failures,
       last_duration_ms, last_error, updated_at
     ) VALUES (
       $1, NOW(),
       CASE WHEN $2 = 'completed' THEN NOW() ELSE NULL END,
       CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END,
       $2::ingestion_run_status,
       CASE WHEN $2 = 'failed' THEN 1 ELSE 0 END,
       1,
       CASE WHEN $2 = 'completed' THEN 1 ELSE 0 END,
       CASE WHEN $2 = 'failed' THEN 1 ELSE 0 END,
       $3, $4, NOW()
     )
     ON CONFLICT (source) DO UPDATE SET
       last_run_at = NOW(),
       last_success_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE ingestion_source_health.last_success_at END,
       last_failure_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE ingestion_source_health.last_failure_at END,
       last_status = $2::ingestion_run_status,
       consecutive_failures = CASE
         WHEN $2 = 'completed' THEN 0
         WHEN $2 = 'failed' THEN ingestion_source_health.consecutive_failures + 1
         ELSE ingestion_source_health.consecutive_failures
       END,
       total_runs = ingestion_source_health.total_runs + 1,
       total_successes = ingestion_source_health.total_successes + CASE WHEN $2 = 'completed' THEN 1 ELSE 0 END,
       total_failures = ingestion_source_health.total_failures + CASE WHEN $2 = 'failed' THEN 1 ELSE 0 END,
       last_duration_ms = $3,
       last_error = $4,
       updated_at = NOW()`,
    [source, status, durationMs, errorMessage],
  );
}

export async function listSourceHealth(db: SqlClient): Promise<SourceHealthRow[]> {
  const rows = await db.query(
    `/* scheduler:listHealth */ SELECT source, last_run_at, last_success_at, last_failure_at,
       last_status, consecutive_failures, total_runs, total_successes, total_failures,
       last_duration_ms, last_error, updated_at
     FROM ingestion_source_health
     ORDER BY source`,
  );
  return rows as unknown as SourceHealthRow[];
}

/** Derived display label — not stored. See docs for the exact thresholds. */
export type HealthLabel = "healthy" | "degraded" | "unhealthy" | "unknown";

/** A source is "unhealthy" once it has failed this many times in a row. */
export const UNHEALTHY_CONSECUTIVE_FAILURE_THRESHOLD = 3;

export function deriveHealthLabel(row: Pick<SourceHealthRow, "last_status" | "consecutive_failures"> | null): HealthLabel {
  if (!row || !row.last_status) return "unknown";
  if (row.last_status === "completed") return "healthy";
  if (row.last_status === "partial") return "degraded";
  if (row.last_status === "failed") {
    return row.consecutive_failures >= UNHEALTHY_CONSECUTIVE_FAILURE_THRESHOLD ? "unhealthy" : "degraded";
  }
  return "unknown";
}
