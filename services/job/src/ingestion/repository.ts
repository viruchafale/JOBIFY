/**
 * Phase 3 — Ingestion persistence layer.
 *
 * All SQL is parameterized (neon `query(text, params)` style). This module
 * owns every ingestion write; source adapters never touch the database.
 *
 * Idempotency: re-running an ingestion updates `last_seen_at` on existing
 * rows and preserves `first_seen_at`. No duplicate rows are created.
 *
 * N+1 avoidance: existing rows are resolved with 3 batched SELECTs
 * (by source+id, by canonical URL, by fingerprint) instead of one query
 * per job. Per-row INSERT/UPDATE follows (fixture-scale batches; a future
 * COPY/bulk path can be added if batch sizes grow).
 */

import type {
  IngestionRunStatus,
  NormalizedExternalJob,
} from "./types.js";

/** Minimal DB surface (compatible with @neondatabase/serverless `sql`). */
export interface SqlClient {
  query: (text: string, params?: unknown[]) => Promise<Record<string, any>[]>;
}

export interface PersistCounts {
  insertedCount: number;
  updatedCount: number;
  errorCount: number;
  errorMessage: string | null;
}

interface ExistingExternalJobRow {
  id: number;
  source: string;
  source_job_id: string;
  canonical_url: string;
  content_fingerprint: string;
}

const EXTERNAL_JOB_COLUMNS = `
  id, source, source_job_id, canonical_url, content_fingerprint
`;

export type IngestionTriggerType = "manual" | "scheduled" | "retry";

export async function createIngestionRun(
  db: SqlClient,
  source: string,
  options: {
    triggerType?: IngestionTriggerType;
    attempt?: number;
    scheduledFor?: string | Date | null;
  } = {},
): Promise<number> {
  const triggerType = options.triggerType ?? "manual";
  const attempt = options.attempt ?? 1;
  const scheduledFor = options.scheduledFor ?? null;
  const rows = await db.query(
    `/* ingestion:createRun */ INSERT INTO ingestion_runs
       (source, status, trigger_type, attempt, scheduled_for)
     VALUES ($1, 'running', $2, $3, $4::timestamptz)
     RETURNING id`,
    [source, triggerType, attempt, scheduledFor],
  );
  return Number(rows[0].id);
}

export async function finishIngestionRun(
  db: SqlClient,
  runId: number,
  status: IngestionRunStatus,
  stats: {
    fetchedCount: number;
    acceptedCount: number;
    rejectedCount: number;
    insertedCount: number;
    updatedCount: number;
    duplicateCount: number;
    errorCount: number;
  },
  errorMessage: string | null = null,
  durationMs: number | null = null,
): Promise<void> {
  await db.query(
    `/* ingestion:finishRun */ UPDATE ingestion_runs
     SET status = $2::ingestion_run_status,
         finished_at = NOW(),
         fetched_count = $3,
         accepted_count = $4,
         rejected_count = $5,
         inserted_count = $6,
         updated_count = $7,
         duplicate_count = $8,
         error_count = $9,
         error_message = $10,
         duration_ms = $11
     WHERE id = $1`,
    [
      runId,
      status,
      stats.fetchedCount,
      stats.acceptedCount,
      stats.rejectedCount,
      stats.insertedCount,
      stats.updatedCount,
      stats.duplicateCount,
      stats.errorCount,
      errorMessage,
      durationMs,
    ],
  );
}

/** Store the untouched source payload. Returns the raw row id (or null). */
export async function insertRawJob(
  db: SqlClient,
  input: {
    source: string;
    sourceJobId: string;
    rawPayload: unknown;
    ingestionRunId: number;
  },
): Promise<number | null> {
  const payload =
    typeof input.rawPayload === "string"
      ? input.rawPayload
      : JSON.stringify(input.rawPayload ?? {});
  const inserted = await db.query(
    `/* ingestion:insertRaw */ INSERT INTO raw_external_jobs
       (source, source_job_id, raw_payload, ingestion_run_id)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (source, source_job_id, ingestion_run_id) DO NOTHING
     RETURNING id`,
    [input.source, input.sourceJobId, payload, input.ingestionRunId],
  );
  if (inserted.length > 0) return Number(inserted[0].id);

  const existing = await db.query(
    `/* ingestion:findRaw */ SELECT id FROM raw_external_jobs
     WHERE source = $1 AND source_job_id = $2 AND ingestion_run_id = $3
     LIMIT 1`,
    [input.source, input.sourceJobId, input.ingestionRunId],
  );
  return existing.length > 0 ? Number(existing[0].id) : null;
}

/**
 * Resolve existing rows for a batch using the dedupe hierarchy:
 * Level 1 (source + sourceJobId) → Level 2 (canonical URL) → Level 3 (fingerprint).
 * Returns a map from normalized-job index to the matched existing row.
 */
export async function findExistingExternalJobs(
  db: SqlClient,
  jobs: NormalizedExternalJob[],
): Promise<Map<number, ExistingExternalJobRow>> {
  const matches = new Map<number, ExistingExternalJobRow>();
  if (jobs.length === 0) return matches;

  const byIdentity = new Map<string, number[]>();
  const byUrl = new Map<string, number[]>();
  const byFingerprint = new Map<string, number[]>();

  jobs.forEach((job, index) => {
    const identity = `${job.source}${job.sourceJobId}`.toLowerCase();
    appendToMultiMap(byIdentity, identity, index);
    if (job.canonicalUrl) {
      appendToMultiMap(byUrl, job.canonicalUrl.toLowerCase(), index);
    }
    appendToMultiMap(byFingerprint, job.contentFingerprint, index);
  });

  const assignMatches = (
    rows: Record<string, any>[],
    lookup: (row: ExistingExternalJobRow) => number[],
  ) => {
    for (const raw of rows) {
      const row = raw as unknown as ExistingExternalJobRow;
      for (const index of lookup(row)) {
        if (!matches.has(index)) matches.set(index, row);
      }
    }
  };

  // Level 1: source + sourceJobId (batched per source to keep ANY() homogeneous).
  const identitiesBySource = new Map<string, { ids: string[]; indexes: Map<string, number[]> }>();
  jobs.forEach((job, index) => {
    let entry = identitiesBySource.get(job.source);
    if (!entry) {
      entry = { ids: [], indexes: new Map() };
      identitiesBySource.set(job.source, entry);
    }
    entry.ids.push(job.sourceJobId);
    appendToMultiMap(entry.indexes, job.sourceJobId.toLowerCase(), index);
  });
  for (const [source, entry] of identitiesBySource) {
    const uniqueIds = [...new Set(entry.ids)];
    if (uniqueIds.length === 0) continue;
    const rows = await db.query(
      `/* ingestion:findBySourceIds */ SELECT ${EXTERNAL_JOB_COLUMNS} FROM external_jobs
       WHERE source = $1 AND LOWER(source_job_id) = ANY($2)`,
      [source, uniqueIds.map((id) => id.toLowerCase())],
    );
    assignMatches(rows, (row) => entry.indexes.get(row.source_job_id.toLowerCase()) ?? []);
  }

  // Level 2: canonical URL.
  const urls = [...byUrl.keys()];
  if (urls.length > 0) {
    const rows = await db.query(
      `/* ingestion:findByUrls */ SELECT ${EXTERNAL_JOB_COLUMNS} FROM external_jobs
       WHERE LOWER(canonical_url) = ANY($1)`,
      [urls],
    );
    assignMatches(rows, (row) => byUrl.get(row.canonical_url.toLowerCase()) ?? []);
  }

  // Level 3: content fingerprint.
  const fingerprints = [...byFingerprint.keys()];
  if (fingerprints.length > 0) {
    const rows = await db.query(
      `/* ingestion:findByFingerprints */ SELECT ${EXTERNAL_JOB_COLUMNS} FROM external_jobs
       WHERE content_fingerprint = ANY($1)`,
      [fingerprints],
    );
    assignMatches(rows, (row) => byFingerprint.get(row.content_fingerprint) ?? []);
  }

  return matches;
}

function appendToMultiMap(
  map: Map<string, number[]>,
  key: string,
  index: number,
): void {
  const list = map.get(key);
  if (list) list.push(index);
  else map.set(key, [index]);
}

export async function insertExternalJob(
  db: SqlClient,
  job: NormalizedExternalJob,
  rawJobId: number | null,
): Promise<number> {
  const rows = await db.query(
    `/* ingestion:insertExternal */ INSERT INTO external_jobs
       (source, source_job_id, canonical_url, apply_url, company_name, title,
        description, location, job_type, work_location, role,
        salary_min, salary_max, salary_currency, posted_at,
        first_seen_at, last_seen_at, is_active, content_fingerprint, raw_job_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::timestamptz,
             NOW(), NOW(), true, $16, $17)
     RETURNING id`,
    [
      job.source,
      job.sourceJobId,
      job.canonicalUrl,
      job.applyUrl,
      job.companyName,
      job.title,
      job.description,
      job.location,
      job.jobType,
      job.workLocation,
      job.role,
      job.salaryMin,
      job.salaryMax,
      job.salaryCurrency,
      job.postedAt,
      job.contentFingerprint,
      rawJobId,
    ],
  );
  return Number(rows[0].id);
}

/**
 * Refresh a re-observed job: update mutable fields + `last_seen_at`,
 * keep it active, and NEVER overwrite `first_seen_at`.
 */
export async function updateExternalJobSeen(
  db: SqlClient,
  id: number,
  job: NormalizedExternalJob,
  rawJobId: number | null,
): Promise<void> {
  await db.query(
    `/* ingestion:updateExternalSeen */ UPDATE external_jobs
     SET canonical_url = $2,
         apply_url = $3,
         company_name = $4,
         title = $5,
         description = $6,
         location = $7,
         job_type = $8,
         work_location = $9,
         role = $10,
         salary_min = $11,
         salary_max = $12,
         salary_currency = $13,
         posted_at = $14::timestamptz,
         last_seen_at = NOW(),
         is_active = true,
         content_fingerprint = $15,
         raw_job_id = COALESCE($16, raw_job_id),
         updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      job.canonicalUrl,
      job.applyUrl,
      job.companyName,
      job.title,
      job.description,
      job.location,
      job.jobType,
      job.workLocation,
      job.role,
      job.salaryMin,
      job.salaryMax,
      job.salaryCurrency,
      job.postedAt,
      job.contentFingerprint,
      rawJobId,
    ],
  );
}

export interface ExternalJobFilters {
  title?: string;
  location?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

export function parseExternalJobFilters(query: unknown): ExternalJobFilters {
  const params = query as Record<string, unknown>;
  const filters: ExternalJobFilters = {};

  if (typeof params.title === "string" && params.title.trim() !== "") {
    filters.title = params.title.trim();
  }
  if (typeof params.location === "string" && params.location.trim() !== "") {
    filters.location = params.location.trim();
  }
  if (typeof params.source === "string" && params.source.trim() !== "") {
    filters.source = params.source.trim();
  }

  const limit = params.limit === undefined ? 20 : Number(params.limit);
  const offset = params.offset === undefined ? 0 : Number(params.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid 'limit': must be an integer between 1 and 100.");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Invalid 'offset': must be a non-negative integer.");
  }
  filters.limit = limit;
  filters.offset = offset;
  return filters;
}

export async function listExternalJobs(
  db: SqlClient,
  filters: ExternalJobFilters,
): Promise<Record<string, any>[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.title) {
    conditions.push(`title ILIKE $${paramIndex++}`);
    params.push(`%${filters.title}%`);
  }
  if (filters.location) {
    conditions.push(`location ILIKE $${paramIndex++}`);
    params.push(`%${filters.location}%`);
  }
  if (filters.source) {
    conditions.push(`source = $${paramIndex++}`);
    params.push(filters.source);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;
  params.push(limit, offset);

  return db.query(
    `/* ingestion:listExternal */ SELECT id, source, source_job_id, canonical_url,
       apply_url, company_name, title, description, location, job_type,
       work_location, role, salary_min, salary_max, salary_currency,
       posted_at, first_seen_at, last_seen_at, is_active,
       content_fingerprint, created_at, updated_at
     FROM external_jobs
     ${where}
     ORDER BY last_seen_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    params,
  );
}

export async function getExternalJobById(
  db: SqlClient,
  id: number,
): Promise<Record<string, any> | null> {
  const rows = await db.query(
    `/* ingestion:getExternalById */ SELECT id, source, source_job_id, canonical_url,
       apply_url, company_name, title, description, location, job_type,
       work_location, role, salary_min, salary_max, salary_currency,
       posted_at, first_seen_at, last_seen_at, is_active,
       content_fingerprint, created_at, updated_at
     FROM external_jobs WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows.length > 0 ? rows[0] : null;
}
