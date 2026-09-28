/**
 * Phase 6 — Conservative stale-job detection.
 *
 * Deliberately deferred in Phase 3. The rule, per the Phase 6 spec:
 *   - A job may only be deactivated after evidence from *successful, full*
 *     ingestion runs — never after a failed or partial run, never after a
 *     scheduler crash, never after a network/rate-limit blip.
 *   - The threshold is a number of *completed* runs during which the job
 *     was not re-observed (INGESTION_STALE_AFTER_RUNS), not simple elapsed
 *     time.
 *
 * Implementation: derived entirely from existing data — no schema change,
 * no new column on external_jobs. A job is stale once the number of
 * `ingestion_runs` rows for its source with status='completed' and
 * `started_at` after the job's `last_seen_at` reaches the configured
 * threshold. Runs with status 'failed' or 'partial' in between simply don't
 * count toward the threshold — they neither advance nor reset it — so a
 * temporary source/API problem (even several in a row) can never trigger a
 * deactivation on its own; only genuinely successful runs that keep missing
 * the job do.
 *
 * This function is only ever called immediately after a run finishes with
 * status 'completed' (see scheduler/executeSourceIngestion.ts) — by that
 * point the current run's own row already has status='completed' in the
 * database, so it correctly counts as one of the qualifying runs.
 *
 * Jobs are never deleted — only `is_active` is flipped to false. A job
 * that reappears in a later run is reactivated automatically by the
 * existing Phase 3 `updateExternalJobSeen()` (which always sets
 * `is_active = true` on any re-observed job).
 */

import type { SqlClient } from "../repository.js";

export async function deactivateStaleJobs(
  db: SqlClient,
  source: string,
  staleAfterRuns: number,
): Promise<number> {
  if (!Number.isInteger(staleAfterRuns) || staleAfterRuns < 1) {
    throw new Error(`invalid staleAfterRuns: ${staleAfterRuns} (must be an integer >= 1)`);
  }

  const rows = await db.query(
    `/* scheduler:deactivateStale */ UPDATE external_jobs
     SET is_active = false, updated_at = NOW()
     WHERE source = $1
       AND is_active = true
       AND (
         SELECT COUNT(*) FROM ingestion_runs ir
         WHERE ir.source = $1
           AND ir.status = 'completed'
           AND ir.started_at > external_jobs.last_seen_at
       ) >= $2
     RETURNING id`,
    [source, staleAfterRuns],
  );
  return rows.length;
}
