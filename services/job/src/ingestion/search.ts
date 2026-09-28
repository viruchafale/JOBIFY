/**
 * Phase 7 — Advanced search over `external_jobs`.
 *
 * Deterministic, explainable PostgreSQL full-text + structured search. No
 * embeddings, no vector DB, no external search infrastructure — just
 * `websearch_to_tsquery()` against a generated/stored `search_vector`
 * column (see migration 006) plus parameterized structured filters.
 *
 * This is a NEW, separate surface from Phase 3's `listExternalJobs()` /
 * `parseExternalJobFilters()` in repository.ts, which remain untouched so
 * `GET /api/job/external` keeps working exactly as before. This module
 * backs the new `GET /api/job/external/search` only.
 *
 * General NULL-filter principle (applied consistently below): a filter
 * that requires a specific known value on a nullable column (salary,
 * posted_at) EXCLUDES rows where that column is unknown — it never
 * "passes" an unknown value. No filter at all means no exclusion.
 */

import { normalizeJobType, normalizeWorkLocation } from "./normalize.js";
import type { SqlClient } from "./repository.js";

export type SearchSort = "relevance" | "newest" | "oldest" | "salary_high" | "salary_low";

const VALID_SORTS: readonly SearchSort[] = ["relevance", "newest", "oldest", "salary_high", "salary_low"];

const MAX_QUERY_LENGTH = 200;
const MAX_TEXT_FILTER_LENGTH = 200;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface ExternalJobSearchParams {
  q?: string;
  location?: string;
  company?: string;
  /** Already validated against the registered source list. */
  source?: string[];
  /** Canonical value, e.g. "Full-time" — already normalized from user input. */
  jobType?: string;
  /** Canonical value, e.g. "Remote" — already normalized from user input. */
  workLocation?: string;
  role?: string;
  minSalary?: number;
  maxSalary?: number;
  /** ISO-8601 */
  postedAfter?: string;
  /** ISO-8601 */
  postedBefore?: string;
  active: boolean;
  page: number;
  limit: number;
  /**
   * Resolved/effective sort — "relevance" only ever appears here when `q`
   * is actually present; a request for `sort=relevance` with no `q` is
   * resolved to `newest` here (documented fallback, not an error).
   */
  sort: SearchSort;
}

function requireError(message: string): never {
  throw new Error(message);
}

function parseTrimmedString(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") requireError(`Invalid '${field}': must be a string.`);
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length > maxLength) {
    requireError(`Invalid '${field}': must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

function parseBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") requireError(`Invalid '${field}': must be "true" or "false".`);
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  requireError(`Invalid '${field}': must be "true" or "false".`);
}

function parseSalary(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    requireError(`Invalid '${field}': must be a non-negative number.`);
  }
  return num;
}

function parseDate(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    requireError(`Invalid '${field}': must be a valid date.`);
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    requireError(`Invalid '${field}': must be a valid ISO-8601 date.`);
  }
  return new Date(time).toISOString();
}

/**
 * Validates and normalizes every `GET /api/job/external/search` query
 * parameter. `knownSources` is injected (rather than read from the live
 * registry internally) so this stays pure and unit-testable.
 */
export function parseExternalJobSearchParams(
  query: unknown,
  knownSources: string[],
): ExternalJobSearchParams {
  const params = (query ?? {}) as Record<string, unknown>;

  const q = parseTrimmedString(params.q, "q", MAX_QUERY_LENGTH);
  const location = parseTrimmedString(params.location, "location", MAX_TEXT_FILTER_LENGTH);
  const company = parseTrimmedString(params.company, "company", MAX_TEXT_FILTER_LENGTH);
  const role = parseTrimmedString(params.role, "role", MAX_TEXT_FILTER_LENGTH);

  let source: string[] | undefined;
  const rawSource = parseTrimmedString(params.source, "source", MAX_TEXT_FILTER_LENGTH);
  if (rawSource !== undefined) {
    const knownSet = new Set(knownSources);
    const values = rawSource
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (values.length === 0) requireError(`Invalid 'source': must not be empty.`);
    for (const value of values) {
      if (!knownSet.has(value)) {
        requireError(`Invalid 'source': unknown source "${value}". Registered sources: ${knownSources.join(", ") || "(none)"}.`);
      }
    }
    source = values;
  }

  let jobType: string | undefined;
  const rawJobType = parseTrimmedString(params.jobType, "jobType", 50);
  if (rawJobType !== undefined) {
    const normalized = normalizeJobType(rawJobType);
    if (!normalized) requireError(`Invalid 'jobType': "${rawJobType}" is not a recognized job type.`);
    jobType = normalized;
  }

  let workLocation: string | undefined;
  const rawWorkLocation = parseTrimmedString(params.workLocation, "workLocation", 50);
  if (rawWorkLocation !== undefined) {
    const normalized = normalizeWorkLocation(rawWorkLocation);
    if (!normalized) requireError(`Invalid 'workLocation': "${rawWorkLocation}" is not a recognized work location.`);
    workLocation = normalized;
  }

  const minSalary = parseSalary(params.minSalary, "minSalary");
  const maxSalary = parseSalary(params.maxSalary, "maxSalary");
  if (minSalary !== undefined && maxSalary !== undefined && minSalary > maxSalary) {
    requireError(`Invalid salary range: 'minSalary' must be <= 'maxSalary'.`);
  }

  const postedAfter = parseDate(params.postedAfter, "postedAfter");
  const postedBefore = parseDate(params.postedBefore, "postedBefore");
  if (postedAfter !== undefined && postedBefore !== undefined && postedAfter > postedBefore) {
    requireError(`Invalid date range: 'postedAfter' must be <= 'postedBefore'.`);
  }

  const active = parseBoolean(params.active, "active") ?? true;

  const page = params.page === undefined ? 1 : Number(params.page);
  if (!Number.isInteger(page) || page < 1) {
    requireError(`Invalid 'page': must be a positive integer.`);
  }

  const limit = params.limit === undefined ? DEFAULT_LIMIT : Number(params.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    requireError(`Invalid 'limit': must be an integer between 1 and ${MAX_LIMIT}.`);
  }

  let requestedSort: SearchSort = "newest";
  if (params.sort !== undefined) {
    if (typeof params.sort !== "string" || !VALID_SORTS.includes(params.sort as SearchSort)) {
      requireError(`Invalid 'sort': must be one of ${VALID_SORTS.join(", ")}.`);
    }
    requestedSort = params.sort as SearchSort;
  } else if (q) {
    requestedSort = "relevance";
  }

  // "relevance" only makes sense with a query; fall back to "newest"
  // (documented behavior, not a validation error).
  const sort: SearchSort = requestedSort === "relevance" && !q ? "newest" : requestedSort;

  return {
    q,
    location,
    company,
    source,
    jobType,
    workLocation,
    role,
    minSalary,
    maxSalary,
    postedAfter,
    postedBefore,
    active,
    page,
    limit,
    sort,
  };
}

const SEARCH_RESULT_COLUMNS = `
  id, source, canonical_url, apply_url, company_name, title, description,
  location, job_type, work_location, role, salary_min, salary_max,
  salary_currency, posted_at, last_seen_at, is_active
`;

function buildWhereClause(params: ExternalJobSearchParams): { where: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  conditions.push(`is_active = $${i++}`);
  values.push(params.active);

  if (params.q) {
    conditions.push(`search_vector @@ websearch_to_tsquery('english', $${i++})`);
    values.push(params.q);
  }
  if (params.location) {
    conditions.push(`location ILIKE $${i++}`);
    values.push(`%${params.location}%`);
  }
  if (params.company) {
    conditions.push(`company_name ILIKE $${i++}`);
    values.push(`%${params.company}%`);
  }
  if (params.role) {
    conditions.push(`role ILIKE $${i++}`);
    values.push(`%${params.role}%`);
  }
  if (params.source && params.source.length > 0) {
    conditions.push(`source = ANY($${i++}::text[])`);
    values.push(params.source);
  }
  if (params.jobType) {
    conditions.push(`job_type = $${i++}`);
    values.push(params.jobType);
  }
  if (params.workLocation) {
    conditions.push(`work_location = $${i++}`);
    values.push(params.workLocation);
  }
  // Interval-overlap semantics: minSalary is compared against the job's
  // upper bound, maxSalary against the job's lower bound. NULL salary
  // fields naturally exclude the row (NULL >= x is NULL, not true) when a
  // salary filter is active — no special-casing needed.
  if (params.minSalary !== undefined) {
    conditions.push(`salary_max >= $${i++}`);
    values.push(params.minSalary);
  }
  if (params.maxSalary !== undefined) {
    conditions.push(`salary_min <= $${i++}`);
    values.push(params.maxSalary);
  }
  if (params.postedAfter !== undefined) {
    conditions.push(`posted_at >= $${i++}::timestamptz`);
    values.push(params.postedAfter);
  }
  if (params.postedBefore !== undefined) {
    conditions.push(`posted_at <= $${i++}::timestamptz`);
    values.push(params.postedBefore);
  }

  return { where: conditions.join(" AND "), values };
}

function buildOrderByClause(sort: SearchSort, rankParamIndex: number): string {
  switch (sort) {
    case "relevance":
      return `ts_rank(search_vector, websearch_to_tsquery('english', $${rankParamIndex})) DESC, id DESC`;
    case "oldest":
      return `posted_at ASC NULLS LAST, id ASC`;
    case "salary_high":
      return `salary_max DESC NULLS LAST, id DESC`;
    case "salary_low":
      return `salary_min ASC NULLS LAST, id ASC`;
    case "newest":
    default:
      return `posted_at DESC NULLS LAST, id DESC`;
  }
}

export interface SearchExternalJobsResult {
  items: Record<string, any>[];
  total: number;
}

export async function searchExternalJobs(
  db: SqlClient,
  params: ExternalJobSearchParams,
): Promise<SearchExternalJobsResult> {
  const { where, values } = buildWhereClause(params);

  const countRows = await db.query(
    `/* search:count */ SELECT COUNT(*)::int AS total FROM external_jobs WHERE ${where}`,
    values,
  );
  const total = Number(countRows[0]?.total ?? 0);

  if (total === 0) {
    return { items: [], total: 0 };
  }

  const selectValues = [...values];
  let orderBy: string;
  if (params.sort === "relevance") {
    // q is guaranteed present when sort === "relevance" (see parseExternalJobSearchParams).
    selectValues.push(params.q);
    orderBy = buildOrderByClause(params.sort, selectValues.length);
  } else {
    orderBy = buildOrderByClause(params.sort, 0);
  }

  const limitIndex = selectValues.length + 1;
  const offsetIndex = selectValues.length + 2;
  selectValues.push(params.limit, (params.page - 1) * params.limit);

  const items = await db.query(
    `/* search:select */ SELECT ${SEARCH_RESULT_COLUMNS}
     FROM external_jobs
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    selectValues,
  );

  return { items, total };
}
