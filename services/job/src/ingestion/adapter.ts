/**
 * Phase 3 — Source adapter contract.
 *
 * Every future source (Lever, Greenhouse, Ashby, ...) implements this
 * interface and NOTHING else. Adapters must NOT:
 * - write to PostgreSQL
 * - perform deduplication
 * - perform scheduling
 * - contain business persistence logic
 *
 * They only fetch + shape source data into RawExternalJob records.
 */

import type { RawExternalJob } from "./types.js";

export interface JobSourceAdapter {
  /** Stable source identifier, e.g. "lever", "greenhouse", "fixture". */
  readonly source: string;

  /** Fetch raw jobs from the source. Must never throw on a single bad record. */
  fetchJobs(): Promise<RawExternalJob[]>;

  /**
   * Optional: adapters that fan out across multiple upstream targets (e.g.
   * one Lever company per configured slug) can implement this to surface
   * per-target failures without discarding the other targets' successful
   * results. Called once, immediately after `fetchJobs()` resolves; the
   * runner folds each message into the run's error count/message the same
   * way a per-record failure would (see runner.ts).
   */
  getLastFetchErrors?(): string[];
}
