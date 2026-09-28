/**
 * Phase 5 — Greenhouse source adapter.
 *
 * Fetches postings from Greenhouse's official public Job Board API
 * (https://developers.greenhouse.io/job-board.html, no auth required) for
 * each configured board token and shapes them into RawExternalJob records.
 *
 * This adapter does ONLY that: HTTP request -> Greenhouse response ->
 * RawExternalJob[]. No PostgreSQL, no normalization, no dedupe, no
 * scheduling, no business logic — those stay in the Phase 3 pipeline
 * (normalize.ts / dedupe.ts / repository.ts / runner.ts).
 *
 * Mirrors the Phase 4 Lever adapter's shape and multi-company error
 * isolation exactly (see leverAdapter.ts) — the `getLastFetchErrors()` hook
 * is a generic JobSourceAdapter extension, not Greenhouse-specific.
 */

import axios from "axios";
import type { JobSourceAdapter } from "../adapter.js";
import type { RawExternalJob } from "../types.js";

export const GREENHOUSE_DEFAULT_BASE_URL = "https://boards-api.greenhouse.io/v1/boards";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface GreenhouseCompanyConfig {
  /** Greenhouse board token, e.g. "gitlab" (used in the job-board URL). */
  slug: string;
  /**
   * Fallback company display name, used only when Greenhouse's response
   * doesn't include `company_name` for a posting. Defaults to the slug.
   */
  displayName: string;
}

/**
 * Parses `GREENHOUSE_COMPANIES=slug1,slug2:Display Name,slug3`.
 * Each entry is `slug` or `slug:Display Name`.
 */
export function parseGreenhouseCompanies(raw: string | undefined): GreenhouseCompanyConfig[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [slugPart, ...nameParts] = entry.split(":");
      const slug = slugPart.trim();
      const displayName = nameParts.join(":").trim();
      return { slug, displayName: displayName || slug };
    });
}

interface GreenhouseLocation {
  name?: string | null;
}

interface GreenhouseOffice {
  name?: string | null;
}

interface GreenhouseDepartment {
  name?: string | null;
}

interface GreenhouseJob {
  id?: number | string;
  title?: string;
  absolute_url?: string;
  location?: GreenhouseLocation;
  offices?: GreenhouseOffice[];
  departments?: GreenhouseDepartment[];
  company_name?: string;
  content?: string;
  first_published?: string;
  updated_at?: string;
}

interface GreenhouseJobsResponse {
  jobs?: GreenhouseJob[];
}

/**
 * Greenhouse's Job Board API entity-escapes the `content` field once for
 * JSON transport (e.g. the string literally contains "&lt;div&gt;" instead
 * of "<div>"). This reverses only that one transport-level escaping so the
 * result is ordinary HTML — Phase 3's normalize.ts (stripHtml) is still
 * responsible for turning that HTML into plain text. This is NOT generic
 * HTML cleanup; it is undoing a Greenhouse-specific encoding quirk so the
 * common pipeline sees the same shape of HTML every other source provides.
 */
function unescapeGreenhouseContent(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Greenhouse's `location.name` is already the board's own canonical,
 * deterministic single-string representation of a posting's location
 * (including multi-location postings, e.g. "Remote, Bangalore"). When it's
 * absent, fall back to joining `offices[].name` in the order Greenhouse
 * returned them — still deterministic, no reordering/inference.
 */
function resolveGreenhouseLocation(job: GreenhouseJob): string | null {
  const primary = job.location?.name;
  if (typeof primary === "string" && primary.trim() !== "") return primary;

  const officeNames = (job.offices ?? [])
    .map((office) => office.name)
    .filter((name): name is string => typeof name === "string" && name.trim() !== "");
  return officeNames.length > 0 ? officeNames.join(", ") : null;
}

function toRawExternalJob(company: GreenhouseCompanyConfig, job: GreenhouseJob): RawExternalJob {
  const sourceJobId =
    job.id !== undefined && job.id !== null && String(job.id).trim() !== ""
      ? String(job.id).trim()
      : "";

  const companyName =
    typeof job.company_name === "string" && job.company_name.trim() !== ""
      ? job.company_name
      : company.displayName;

  const sourceUrl = typeof job.absolute_url === "string" ? job.absolute_url : null;

  const description =
    typeof job.content === "string" ? unescapeGreenhouseContent(job.content) : null;

  return {
    source: "greenhouse",
    sourceJobId,
    sourceUrl,
    // Greenhouse's job page already contains the apply form — there is no
    // separate apply URL in the public API, so the two are the same link.
    applyUrl: sourceUrl,
    companyName,
    title: typeof job.title === "string" ? job.title : null,
    description,
    location: resolveGreenhouseLocation(job),
    // Greenhouse's public Job Board API has no dedicated job-type field.
    jobType: null,
    // No reliable structured remote/hybrid/on-site indicator either —
    // deterministic ingestion over guessing from free-text location/content.
    workLocation: null,
    role: job.departments?.[0]?.name ?? null,
    // No compensation field in the public Job Board API.
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt:
      typeof job.first_published === "string"
        ? job.first_published
        : typeof job.updated_at === "string"
          ? job.updated_at
          : null,
    rawPayload: job,
  };
}

export class GreenhouseAdapter implements JobSourceAdapter {
  readonly source = "greenhouse";
  private readonly companies: GreenhouseCompanyConfig[];
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private lastFetchErrors: string[] = [];

  constructor(options: {
    companies: GreenhouseCompanyConfig[];
    baseUrl?: string;
    timeoutMs?: number;
  }) {
    this.companies = options.companies;
    this.baseUrl = options.baseUrl ?? GREENHOUSE_DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Per-company failures from the most recent fetchJobs() call. */
  getLastFetchErrors(): string[] {
    return this.lastFetchErrors;
  }

  async fetchJobs(): Promise<RawExternalJob[]> {
    this.lastFetchErrors = [];

    if (this.companies.length === 0) {
      throw new Error(
        "GreenhouseAdapter: no companies configured. Set GREENHOUSE_COMPANIES to a comma-separated list of Greenhouse board tokens.",
      );
    }

    const results: RawExternalJob[] = [];
    for (const company of this.companies) {
      try {
        results.push(...(await this.fetchCompany(company)));
      } catch (error) {
        this.lastFetchErrors.push(
          `greenhouse_company_fetch_failed[company=${company.slug}]: ${(error as Error).message}`,
        );
      }
    }

    // Every configured board failed and nothing was fetched: total failure,
    // not partial — let the runner mark the run "failed" like any other
    // adapter's total fetch failure.
    if (results.length === 0 && this.lastFetchErrors.length === this.companies.length) {
      throw new Error(
        `GreenhouseAdapter: all ${this.companies.length} configured board${this.companies.length === 1 ? "" : "s"} failed: ${this.lastFetchErrors.join("; ")}`,
      );
    }

    return results;
  }

  private async fetchCompany(company: GreenhouseCompanyConfig): Promise<RawExternalJob[]> {
    if (!company.slug) {
      throw new Error("invalid company configuration (empty slug)");
    }

    let response;
    try {
      response = await axios.get(`${this.baseUrl}/${encodeURIComponent(company.slug)}/jobs`, {
        params: { content: "true" },
        timeout: this.timeoutMs,
        validateStatus: () => true,
      });
    } catch (error: any) {
      if (error?.code === "ECONNABORTED") {
        throw new Error(`request timed out after ${this.timeoutMs}ms`);
      }
      throw new Error(error?.message || "network request failed");
    }

    if (response.status === 404) {
      throw new Error(`unknown Greenhouse board "${company.slug}" (HTTP 404)`);
    }
    if (response.status === 429) {
      throw new Error("rate limited by Greenhouse's public API (HTTP 429)");
    }
    if (response.status >= 400 && response.status < 500) {
      throw new Error(`Greenhouse API rejected the request (HTTP ${response.status})`);
    }
    if (response.status >= 500) {
      throw new Error(`Greenhouse API server error (HTTP ${response.status})`);
    }

    const data = response.data as GreenhouseJobsResponse | unknown;
    if (
      typeof data !== "object" ||
      data === null ||
      !Array.isArray((data as GreenhouseJobsResponse).jobs)
    ) {
      throw new Error("malformed response: expected an object with a 'jobs' array");
    }

    const jobs: RawExternalJob[] = [];
    for (const entry of (data as GreenhouseJobsResponse).jobs ?? []) {
      if (typeof entry !== "object" || entry === null) continue;
      jobs.push(toRawExternalJob(company, entry as GreenhouseJob));
    }
    return jobs;
  }
}
