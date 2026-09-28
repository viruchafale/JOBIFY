/**
 * Phase 5 — Ashby source adapter.
 *
 * Fetches postings from Ashby's official public Job Postings API
 * (https://developers.ashbyhq.com/reference/jobpostingapi, no auth
 * required) for each configured job-board name and shapes them into
 * RawExternalJob records.
 *
 * This adapter does ONLY that: HTTP request -> Ashby response ->
 * RawExternalJob[]. No PostgreSQL, no normalization, no dedupe, no
 * scheduling, no business logic — those stay in the Phase 3 pipeline
 * (normalize.ts / dedupe.ts / repository.ts / runner.ts).
 *
 * Mirrors the Phase 4 Lever adapter's shape and multi-company error
 * isolation exactly (see leverAdapter.ts) — the `getLastFetchErrors()` hook
 * is a generic JobSourceAdapter extension, not Ashby-specific.
 */

import axios from "axios";
import type { JobSourceAdapter } from "../adapter.js";
import type { RawExternalJob } from "../types.js";

export const ASHBY_DEFAULT_BASE_URL = "https://api.ashbyhq.com/posting-api/job-board";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface AshbyCompanyConfig {
  /** Ashby public job-board name, e.g. "zapier" (used in the API URL). */
  slug: string;
  /**
   * Fallback company display name. Ashby's public Job Postings API does not
   * return an organization display name anywhere in the payload, so this
   * must come from configuration rather than being invented. Defaults to
   * the slug when not supplied.
   */
  displayName: string;
}

/**
 * Parses `ASHBY_COMPANIES=slug1,slug2:Display Name,slug3`.
 * Each entry is `slug` or `slug:Display Name`.
 */
export function parseAshbyCompanies(raw: string | undefined): AshbyCompanyConfig[] {
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

interface AshbyCompensationComponent {
  compensationType?: string;
  currencyCode?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
}

interface AshbyCompensation {
  summaryComponents?: AshbyCompensationComponent[];
}

interface AshbyPosting {
  id?: string;
  title?: string;
  department?: string | null;
  team?: string | null;
  employmentType?: string;
  location?: string;
  publishedAt?: string;
  workplaceType?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
  compensation?: AshbyCompensation | null;
}

interface AshbyJobBoardResponse {
  jobs?: AshbyPosting[];
}

/** First component whose type indicates a base salary range, if any. */
function resolveSalaryComponent(
  compensation: AshbyCompensation | null | undefined,
): AshbyCompensationComponent | null {
  const components = compensation?.summaryComponents ?? [];
  const salary = components.find(
    (component) =>
      component.compensationType === "Salary" &&
      (typeof component.minValue === "number" || typeof component.maxValue === "number"),
  );
  return salary ?? null;
}

function toRawExternalJob(company: AshbyCompanyConfig, posting: AshbyPosting): RawExternalJob {
  const sourceJobId =
    typeof posting.id === "string" && posting.id.trim() !== "" ? posting.id.trim() : "";

  const sourceUrl = typeof posting.jobUrl === "string" ? posting.jobUrl : null;
  const applyUrl = typeof posting.applyUrl === "string" ? posting.applyUrl : sourceUrl;

  const salary = resolveSalaryComponent(posting.compensation);

  return {
    source: "ashby",
    sourceJobId,
    sourceUrl,
    applyUrl,
    // Ashby's public API never returns an organization display name.
    companyName: company.displayName,
    title: typeof posting.title === "string" ? posting.title : null,
    description: typeof posting.descriptionHtml === "string" ? posting.descriptionHtml : null,
    location: typeof posting.location === "string" ? posting.location : null,
    jobType: typeof posting.employmentType === "string" ? posting.employmentType : null,
    workLocation: typeof posting.workplaceType === "string" ? posting.workplaceType : null,
    role:
      typeof posting.department === "string"
        ? posting.department
        : typeof posting.team === "string"
          ? posting.team
          : null,
    salaryMin: salary && typeof salary.minValue === "number" ? salary.minValue : null,
    salaryMax: salary && typeof salary.maxValue === "number" ? salary.maxValue : null,
    salaryCurrency: salary && typeof salary.currencyCode === "string" ? salary.currencyCode : null,
    postedAt: typeof posting.publishedAt === "string" ? posting.publishedAt : null,
    rawPayload: posting,
  };
}

export class AshbyAdapter implements JobSourceAdapter {
  readonly source = "ashby";
  private readonly companies: AshbyCompanyConfig[];
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private lastFetchErrors: string[] = [];

  constructor(options: { companies: AshbyCompanyConfig[]; baseUrl?: string; timeoutMs?: number }) {
    this.companies = options.companies;
    this.baseUrl = options.baseUrl ?? ASHBY_DEFAULT_BASE_URL;
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
        "AshbyAdapter: no companies configured. Set ASHBY_COMPANIES to a comma-separated list of Ashby job-board names.",
      );
    }

    const results: RawExternalJob[] = [];
    for (const company of this.companies) {
      try {
        results.push(...(await this.fetchCompany(company)));
      } catch (error) {
        this.lastFetchErrors.push(
          `ashby_company_fetch_failed[company=${company.slug}]: ${(error as Error).message}`,
        );
      }
    }

    if (results.length === 0 && this.lastFetchErrors.length === this.companies.length) {
      throw new Error(
        `AshbyAdapter: all ${this.companies.length} configured board${this.companies.length === 1 ? "" : "s"} failed: ${this.lastFetchErrors.join("; ")}`,
      );
    }

    return results;
  }

  private async fetchCompany(company: AshbyCompanyConfig): Promise<RawExternalJob[]> {
    if (!company.slug) {
      throw new Error("invalid company configuration (empty slug)");
    }

    let response;
    try {
      response = await axios.get(`${this.baseUrl}/${encodeURIComponent(company.slug)}`, {
        // Documented, public query param: includes compensation ranges for
        // boards whose organization has opted into comp transparency.
        params: { includeCompensation: "true" },
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
      throw new Error(`unknown Ashby job board "${company.slug}" (HTTP 404)`);
    }
    if (response.status === 429) {
      throw new Error("rate limited by Ashby's public API (HTTP 429)");
    }
    if (response.status >= 400 && response.status < 500) {
      throw new Error(`Ashby API rejected the request (HTTP ${response.status})`);
    }
    if (response.status >= 500) {
      throw new Error(`Ashby API server error (HTTP ${response.status})`);
    }

    const data = response.data as AshbyJobBoardResponse | unknown;
    if (
      typeof data !== "object" ||
      data === null ||
      !Array.isArray((data as AshbyJobBoardResponse).jobs)
    ) {
      throw new Error("malformed response: expected an object with a 'jobs' array");
    }

    const jobs: RawExternalJob[] = [];
    for (const entry of (data as AshbyJobBoardResponse).jobs ?? []) {
      if (typeof entry !== "object" || entry === null) continue;
      jobs.push(toRawExternalJob(company, entry as AshbyPosting));
    }
    return jobs;
  }
}
