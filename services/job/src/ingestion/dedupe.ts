/**
 * Phase 3 — Deterministic in-batch deduplication.
 *
 * Hierarchy (no fuzzy matching, no AI):
 *   Level 1: source + sourceJobId   (strongest identity)
 *   Level 2: canonical URL
 *   Level 3: content fingerprint (SHA-256)
 *
 * First occurrence wins; later duplicates are dropped and counted.
 * Cross-batch (DB-level) dedupe happens in the repository layer.
 */

import type { NormalizedExternalJob } from "./types.js";

export interface DedupeResult {
  unique: NormalizedExternalJob[];
  /** Original indexes (into the input array) of the surviving records. */
  uniqueIndexes: number[];
  /** Original indexes of the dropped duplicates. */
  duplicateIndexes: number[];
  duplicateCount: number;
}

export function dedupeNormalizedJobs(
  jobs: NormalizedExternalJob[],
): DedupeResult {
  const seenIdentities = new Set<string>();
  const seenUrls = new Set<string>();
  const seenFingerprints = new Set<string>();

  const unique: NormalizedExternalJob[] = [];
  const uniqueIndexes: number[] = [];
  const duplicateIndexes: number[] = [];

  jobs.forEach((job, index) => {
    const identityKey = `${job.source}${job.sourceJobId}`.toLowerCase();
    const urlKey = job.canonicalUrl ? job.canonicalUrl.toLowerCase() : null;

    const isDuplicate =
      seenIdentities.has(identityKey) ||
      (urlKey !== null && seenUrls.has(urlKey)) ||
      seenFingerprints.has(job.contentFingerprint);

    if (isDuplicate) {
      duplicateIndexes.push(index);
      return;
    }

    seenIdentities.add(identityKey);
    if (urlKey !== null) seenUrls.add(urlKey);
    seenFingerprints.add(job.contentFingerprint);
    unique.push(job);
    uniqueIndexes.push(index);
  });

  return {
    unique,
    uniqueIndexes,
    duplicateIndexes,
    duplicateCount: duplicateIndexes.length,
  };
}
