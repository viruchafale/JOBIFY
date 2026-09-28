/**
 * Phase 3 — Ingestion runner (orchestration).
 *
 * Pipeline: adapter → raw → normalize → validate → dedupe → persist.
 *
 * Guarantees:
 * - A single bad record never terminates the run (per-record isolation).
 * - Re-runs are idempotent: existing rows get `last_seen_at` refreshed,
 *   `first_seen_at` is preserved, no duplicate rows are created.
 * - Every run is recorded in `ingestion_runs` with full counters.
 * - Structured JSON logs carry source, run id, counters, duration, status.
 */

import type { JobSourceAdapter } from "./adapter.js";
import { dedupeNormalizedJobs } from "./dedupe.js";
import { normalizeRawJob } from "./normalize.js";
import {
  createIngestionRun,
  findExistingExternalJobs,
  finishIngestionRun,
  insertExternalJob,
  insertRawJob,
  updateExternalJobSeen,
  type SqlClient,
} from "./repository.js";
import type {
  IngestionRunStatus,
  IngestionSummary,
  IngestionTriggerType,
  NormalizedExternalJob,
  RejectionRecord,
} from "./types.js";
import { validateNormalizedJob } from "./validate.js";

export interface RunIngestionOptions {
  source: string;
  adapter: JobSourceAdapter;
  db: SqlClient;
  /** Phase 6: audit metadata. Defaults preserve pre-Phase-6 manual-run behavior. */
  triggerType?: IngestionTriggerType;
  attempt?: number;
  scheduledFor?: string | Date | null;
}

function logIngestion(event: string, fields: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: event === "ingestion_finished" && fields.status === "failed" ? "error" : "info",
      service: "job",
      component: "ingestion",
      event,
      ...fields,
    }),
  );
}

export async function runIngestion(
  options: RunIngestionOptions,
): Promise<IngestionSummary> {
  const { source, adapter, db } = options;
  const triggerType = options.triggerType ?? "manual";
  const attempt = options.attempt ?? 1;
  const scheduledFor = options.scheduledFor ?? null;
  const startedAt = Date.now();
  const runId = await createIngestionRun(db, source, { triggerType, attempt, scheduledFor });
  logIngestion("ingestion_started", { source, ingestionRunId: runId, trigger: triggerType, attempt });

  let fetchedCount = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;
  let insertedCount = 0;
  let updatedCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;
  let errorMessage: string | null = null;
  const rejections: RejectionRecord[] = [];

  const recordError = (message: string) => {
    errorCount += 1;
    if (!errorMessage) errorMessage = message;
  };

  // 1. Fetch (a fetch failure fails the run, but is still recorded).
  let rawJobs: Awaited<ReturnType<JobSourceAdapter["fetchJobs"]>> = [];
  try {
    rawJobs = await adapter.fetchJobs();
  } catch (error) {
    errorMessage = `fetch_failed: ${(error as Error).message}`;
    const summary = await finishRun("failed");
    return summary;
  }
  fetchedCount = rawJobs.length;

  // Multi-target adapters (e.g. Lever across several companies) may have
  // partially failed without throwing, so a single failing target doesn't
  // discard the others' results. Surface those failures as run errors.
  if (typeof adapter.getLastFetchErrors === "function") {
    for (const message of adapter.getLastFetchErrors()) {
      recordError(message);
    }
  }

  // 2–3. Normalize + validate with per-record isolation; persist raw payloads.
  const accepted: { normalized: NormalizedExternalJob; rawJobId: number | null }[] = [];
  for (let index = 0; index < rawJobs.length; index += 1) {
    const raw = rawJobs[index];
    try {
      const normalized = normalizeRawJob(raw);

      let rawJobId: number | null = null;
      try {
        rawJobId = await insertRawJob(db, {
          source: normalized.source || source,
          sourceJobId: normalized.sourceJobId,
          rawPayload: raw.rawPayload ?? raw,
          ingestionRunId: runId,
        });
      } catch (error) {
        recordError(`raw_persist_failed[index=${index}]: ${(error as Error).message}`);
      }

      const validation = validateNormalizedJob(normalized);
      if (!validation.valid) {
        rejectedCount += 1;
        rejections.push({ index, reasons: validation.reasons });
        continue;
      }

      acceptedCount += 1;
      accepted.push({ normalized, rawJobId });
    } catch (error) {
      errorCount += 1;
      recordError(`record_failed[index=${index}]: ${(error as Error).message}`);
    }
  }

  // 4. In-batch dedupe (Level 1 → Level 2 → Level 3).
  const deduped = dedupeNormalizedJobs(accepted.map((entry) => entry.normalized));
  duplicateCount = deduped.duplicateCount;
  const uniqueEntries = deduped.uniqueIndexes.map((acceptedIndex) => accepted[acceptedIndex]);

  // 5. Persist: batched existence check, then insert-or-refresh per job.
  try {
    const existing = await findExistingExternalJobs(
      db,
      uniqueEntries.map((entry) => entry.normalized),
    );

    for (let i = 0; i < uniqueEntries.length; i += 1) {
      const { normalized, rawJobId } = uniqueEntries[i];
      try {
        const match = existing.get(i);
        if (match) {
          await updateExternalJobSeen(db, match.id, normalized, rawJobId);
          updatedCount += 1;
        } else {
          await insertExternalJob(db, normalized, rawJobId);
          insertedCount += 1;
        }
      } catch (error) {
        recordError(`persist_failed[sourceJobId=${normalized.sourceJobId}]: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    recordError(`persistence_lookup_failed: ${(error as Error).message}`);
  }

  const status: IngestionRunStatus =
    errorCount > 0 && insertedCount + updatedCount === 0 ? "failed"
    : errorCount > 0 ? "partial"
    : "completed";

  return finishRun(status);

  async function finishRun(finalStatus: IngestionRunStatus): Promise<IngestionSummary> {
    const durationMs = Date.now() - startedAt;
    await finishIngestionRun(
      db,
      runId,
      finalStatus,
      {
        fetchedCount,
        acceptedCount,
        rejectedCount,
        insertedCount,
        updatedCount,
        duplicateCount,
        errorCount,
      },
      errorMessage,
      durationMs,
    );
    logIngestion("ingestion_finished", {
      source,
      ingestionRunId: runId,
      trigger: triggerType,
      attempt,
      fetchedCount,
      acceptedCount,
      rejectedCount,
      insertedCount,
      updatedCount,
      duplicateCount,
      errorCount,
      durationMs,
      status: finalStatus,
    });
    return {
      ingestionRunId: runId,
      source,
      status: finalStatus,
      durationMs,
      fetchedCount,
      acceptedCount,
      rejectedCount,
      insertedCount,
      updatedCount,
      duplicateCount,
      errorCount,
      errorMessage,
      rejections,
      triggerType,
      attempt,
    };
  }
}
