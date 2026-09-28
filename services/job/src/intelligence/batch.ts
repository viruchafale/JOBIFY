/**
 * Phase 8 — Batch/backfill processing: pages through external_jobs with
 * keyset pagination (never loads the whole table into memory), processing
 * each page with a small bounded-concurrency worker pool. One bad job never
 * stops the batch — each job is wrapped in its own try/catch.
 */

import type { SqlClient } from "../ingestion/repository.js";
import { EXTRACTOR_VERSION } from "./constants.js";
import type { IntelligenceConfig } from "./config.js";
import { listPendingJobIds, loadSkillTaxonomy } from "./repository.js";
import { processJobIntelligence } from "./processor.js";
import { logIntelligenceEvent } from "./logger.js";

export interface IntelligenceBatchOptions {
  batchSize: number;
  maxConcurrency: number;
  /** Reprocess every active job, including ones already up to date. */
  force?: boolean;
  config?: IntelligenceConfig;
}

export interface IntelligenceBatchResult {
  processed: number;
  completed: number;
  retryableFailed: number;
  failed: number;
  skipped: number;
}

async function runWithConcurrency<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const worker = async () => {
    for (;;) {
      const current = index++;
      if (current >= items.length) return;
      await task(items[current]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

export async function runIntelligenceBatch(
  db: SqlClient,
  options: IntelligenceBatchOptions,
): Promise<IntelligenceBatchResult> {
  const taxonomy = await loadSkillTaxonomy(db); // loaded once, reused for every job in this batch
  const result: IntelligenceBatchResult = { processed: 0, completed: 0, retryableFailed: 0, failed: 0, skipped: 0 };

  let lastId = 0;
  for (;;) {
    const ids = await listPendingJobIds(db, lastId, options.batchSize, EXTRACTOR_VERSION, options.force ?? false);
    if (ids.length === 0) break;
    lastId = ids[ids.length - 1];

    await runWithConcurrency(ids, options.maxConcurrency, async (jobId) => {
      try {
        const outcome = await processJobIntelligence(db, jobId, { force: options.force, config: options.config, taxonomy });
        result.processed += 1;
        if (outcome.skipped) result.skipped += 1;
        else if (outcome.status === "completed") result.completed += 1;
        else if (outcome.status === "retryable_failed") result.retryableFailed += 1;
        else result.failed += 1;
      } catch (error) {
        // processJobIntelligence already isolates failures internally and
        // returns a "failed" result rather than throwing in the normal
        // case; this catch is the last line of defense for anything that
        // still escapes (e.g. the job itself doesn't exist).
        result.processed += 1;
        result.failed += 1;
        logIntelligenceEvent("intelligence_failed", { jobId, error: (error as Error).message });
      }
    });
  }

  return result;
}
