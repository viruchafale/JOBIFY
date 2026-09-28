/**
 * Phase 3 — Job Ingestion Foundation: shared types.
 *
 * Raw vs normalized:
 * - RawExternalJob preserves source information verbatim (plus the untouched
 *   `rawPayload` for debugging/reprocessing). It is what adapters return.
 * - NormalizedExternalJob is the deterministic, cleaned representation that
 *   gets validated, deduplicated and persisted. No LLM, no embeddings.
 */

export interface RawExternalJob {
  source: string;
  sourceJobId: string;
  sourceUrl?: string | null;
  applyUrl?: string | null;
  companyName?: string | null;
  title?: string | null;
  description?: string | null;
  location?: string | null;
  jobType?: string | null;
  workLocation?: string | null;
  role?: string | null;
  salaryMin?: number | string | null;
  salaryMax?: number | string | null;
  salaryCurrency?: string | null;
  postedAt?: string | null;
  /** Untouched source payload, preserved for debugging/reprocessing. */
  rawPayload: unknown;
}

export interface NormalizedExternalJob {
  source: string;
  sourceJobId: string;
  /** Normalized source URL — the Level-2 dedupe identity. */
  canonicalUrl: string | null;
  applyUrl: string | null;
  companyName: string | null;
  title: string | null;
  /** Plain text: HTML stripped, whitespace collapsed. */
  description: string | null;
  location: string | null;
  /** Canonical enum text: "Full-time" | "Part-time" | "Contract" | "Internship" */
  jobType: string | null;
  /** Canonical enum text: "On-site" | "Remote" | "Hybrid" */
  workLocation: string | null;
  role: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  /** ISO-8601 timestamp, or null when the source value is unparseable. */
  postedAt: string | null;
  /** SHA-256 over normalized (company, title, description, location). */
  contentFingerprint: string;
}

export interface ValidationResult {
  valid: boolean;
  reasons: string[];
}

export type IngestionRunStatus = "running" | "completed" | "failed" | "partial";

export interface IngestionStats {
  fetchedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  insertedCount: number;
  updatedCount: number;
  duplicateCount: number;
  errorCount: number;
}

export interface RejectionRecord {
  index: number;
  reasons: string[];
}

/** Phase 6: how an ingestion run was initiated. */
export type IngestionTriggerType = "manual" | "scheduled" | "retry";

export interface IngestionSummary extends IngestionStats {
  ingestionRunId: number;
  source: string;
  status: IngestionRunStatus;
  durationMs: number;
  errorMessage?: string | null;
  rejections: RejectionRecord[];
  /** Phase 6: audit trail — how/when this attempt was triggered. */
  triggerType: IngestionTriggerType;
  attempt: number;
}
