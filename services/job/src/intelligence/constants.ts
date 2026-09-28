/**
 * Phase 8 — centralized extractor version. Never hard-code a version
 * string anywhere else; import this. Bumping it does not touch or delete
 * existing `job_intelligence` rows (they remain under their own version —
 * see the UNIQUE(external_job_id, extractor_version) constraint); it only
 * causes new processing to produce a new, additional row per job.
 */
export const EXTRACTOR_VERSION = "1.0";

/** Job descriptions are untrusted input — hard cap before any processing. */
export const MAX_DESCRIPTION_LENGTH_FOR_EXTRACTION = 20_000;

/** Caps on how much structured output one job can produce (defense against pathological input). */
export const MAX_SKILLS_PER_JOB = 30;
export const MAX_RESPONSIBILITIES_PER_JOB = 20;
export const MAX_REQUIREMENTS_PER_JOB = 20;

export const EVIDENCE_MAX_LENGTH = 200;
export const ITEM_TEXT_MAX_LENGTH = 500;
export const SUMMARY_MAX_LENGTH = 600;
