/**
 * Phase 3 — Validation layer.
 *
 * A malformed job is rejected with structured reasons and never crashes the
 * ingestion run. Rejected records are counted, sampled in the run summary,
 * and the run continues.
 */

import type { NormalizedExternalJob, ValidationResult } from "./types.js";

export function validateNormalizedJob(
  job: NormalizedExternalJob,
): ValidationResult {
  const reasons: string[] = [];

  if (!job.source || job.source.trim() === "") reasons.push("missing_source");
  if (!job.sourceJobId || job.sourceJobId.trim() === "") {
    reasons.push("missing_source_job_id");
  }
  if (!job.canonicalUrl) reasons.push("missing_canonical_url");
  if (!job.companyName) reasons.push("missing_company_name");
  if (!job.title) reasons.push("missing_title");
  if (!job.description) reasons.push("missing_description");

  return { valid: reasons.length === 0, reasons };
}
