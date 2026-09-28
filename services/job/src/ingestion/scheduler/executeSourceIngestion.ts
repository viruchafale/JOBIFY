/**
 * Phase 6 — Per-source execution: lock -> (retry loop around the unchanged
 * runIngestion()) -> health update -> stale-job detection -> unlock.
 *
 * This is the ONLY place Phase 6 wraps runIngestion(); it contains no
 * normalization, validation, deduplication or persistence logic of its
 * own — that all still lives in normalize.ts/validate.ts/dedupe.ts/
 * repository.ts, called exactly as before from inside runIngestion().
 */

import { sourceRegistry } from "../sources/index.js";
import { runIngestion } from "../runner.js";
import type { JobSourceAdapter } from "../adapter.js";
import type { SqlClient } from "../repository.js";
import type { IngestionSummary, IngestionTriggerType } from "../types.js";
import { acquireLock, releaseLock } from "./lock.js";
import { upsertSourceHealthAfterRun } from "./health.js";
import { deactivateStaleJobs } from "./staleJobs.js";
import { classifyIngestionError, computeBackoffDelayMs, isRetryableClass } from "./retry.js";
import { logSchedulerEvent } from "./logger.js";

export interface ExecuteSourceIngestionOptions {
  source: string;
  db: SqlClient;
  ownerId: string;
  trigger: IngestionTriggerType;
  scheduledFor?: string | Date | null;
  lockTtlSeconds: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  staleAfterRuns: number;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; defaults to the real source registry. */
  createAdapter?: (source: string) => JobSourceAdapter;
}

export interface ExecuteSourceIngestionResult {
  locked: boolean;
  /** One entry per attempt (only ever >1 for a retried "failed" run). */
  summaries: IngestionSummary[];
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function executeSourceIngestion(
  options: ExecuteSourceIngestionOptions,
): Promise<ExecuteSourceIngestionResult> {
  const {
    source,
    db,
    ownerId,
    trigger,
    scheduledFor = null,
    lockTtlSeconds,
    retryMaxAttempts,
    retryBaseDelayMs,
    retryMaxDelayMs,
    staleAfterRuns,
  } = options;
  const sleep = options.sleep ?? defaultSleep;
  const createAdapter = options.createAdapter ?? ((s: string) => sourceRegistry.createAdapter(s));

  const acquired = await acquireLock(db, source, ownerId, lockTtlSeconds);
  if (!acquired) {
    logSchedulerEvent("ingestion_lock_skipped", { source });
    return { locked: false, summaries: [] };
  }

  const summaries: IngestionSummary[] = [];
  try {
    let attempt = 1;
    let currentTrigger = trigger;

    for (;;) {
      const adapter = createAdapter(source);
      logSchedulerEvent("ingestion_started", { source, trigger: currentTrigger, attempt });

      const summary = await runIngestion({
        source,
        adapter,
        db,
        triggerType: currentTrigger,
        attempt,
        scheduledFor,
      });
      summaries.push(summary);

      logSchedulerEvent("ingestion_completed", {
        source,
        status: summary.status,
        trigger: currentTrigger,
        attempt,
        fetched: summary.fetchedCount,
        accepted: summary.acceptedCount,
        rejected: summary.rejectedCount,
        inserted: summary.insertedCount,
        updated: summary.updatedCount,
        duplicates: summary.duplicateCount,
        errors: summary.errorCount,
        durationMs: summary.durationMs,
      });

      await upsertSourceHealthAfterRun(db, source, summary.status, summary.durationMs, summary.errorMessage ?? null);

      if (summary.status === "completed") {
        const deactivated = await deactivateStaleJobs(db, source, staleAfterRuns);
        if (deactivated > 0) {
          logSchedulerEvent("stale_jobs_deactivated", { source, count: deactivated });
        }
        break;
      }

      // Partial: some companies/boards succeeded. Do not retry — that would
      // needlessly re-fetch already-succeeded companies too, and the
      // adapter contract has no per-company retry hook (Phase 6 scope).
      if (summary.status === "partial") {
        break;
      }

      // status === "failed": decide whether a retry can help.
      const errorClass = classifyIngestionError(summary.errorMessage);
      if (!isRetryableClass(errorClass) || attempt >= retryMaxAttempts) {
        break;
      }

      const delayMs = computeBackoffDelayMs(attempt, retryBaseDelayMs, retryMaxDelayMs);
      logSchedulerEvent("ingestion_retry", {
        source,
        attempt: attempt + 1,
        delayMs,
        reason: summary.errorMessage,
      });
      await sleep(delayMs);
      attempt += 1;
      currentTrigger = "retry";
    }

    return { locked: true, summaries };
  } finally {
    await releaseLock(db, source, ownerId);
  }
}
