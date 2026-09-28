/**
 * Phase 4 — Lever source adapter.
 *
 * Fetches postings from Lever's official public Postings API
 * (https://github.com/lever/postings-api, no auth required) for each
 * configured company slug and shapes them into RawExternalJob records.
 *
 * This adapter does ONLY that: HTTP request -> Lever response ->
 * RawExternalJob[]. No PostgreSQL, no normalization, no dedupe, no
 * scheduling, no business logic — those stay in the Phase 3 pipeline
 * (normalize.ts / dedupe.ts / repository.ts / runner.ts).
 *
 * Multi-company fan-out: one HTTP request per configured company. A single
 * company's failure (HTTP error, timeout, malformed response) does not drop
 * the other companies' jobs — it is recorded and exposed via
 * `getLastFetchErrors()`, which the runner folds into the run's error count
 * without discarding successful companies' results (see runner.ts).
 */

import axios from "axios";
import type { JobSourceAdapter } from "../adapter.js";
import type { RawExternalJob } from "../types.js";

export const LEVER_DEFAULT_BASE_URL = "https://api.lever.co/v0/postings";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface LeverCompanyConfig {
  /** Lever company slug, e.g. "palantir" (used in the postings URL). */
  slug: string;
  /**
   * Human-readable company name. Lever's public postings API does not
   * return a company display name, so this must come from configuration
   * rather than being invented. Defaults to the slug when not supplied.
   */
  displayName: string;
}

/**
 * Parses `LEVER_COMPANIES=slug1,slug2:Display Name,slug3`.
 * Each entry is `slug` or `slug:Display Name`.
 */
export function parseLeverCompanies(raw: string | undefined): LeverCompanyConfig[] {
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

interface LeverCategories {
  commitment?: string | null;
  location?: string | null;
  team?: string | null;
  department?: string | null;
}

interface LeverSalaryRange {
  min?: number | string | null;
  max?: number | string | null;
  currency?: string | null;
}

interface LeverPosting {
  id?: string;
  text?: string;
  description?: string;
  categories?: LeverCategories;
  createdAt?: number;
  hostedUrl?: string;
  applyUrl?: string;
  workplaceType?: string;
  salaryRange?: LeverSalaryRange;
}

function toRawExternalJob(company: LeverCompanyConfig, posting: LeverPosting): RawExternalJob {
  const sourceJobId =
    typeof posting.id === "string" && posting.id.trim() !== "" ? posting.id.trim() : "";
  const categories = posting.categories ?? {};
  const salaryRange = posting.salaryRange ?? null;

  const salaryMin =
    salaryRange && (typeof salaryRange.min === "number" || typeof salaryRange.min === "string")
      ? salaryRange.min
      : null;
  const salaryMax =
    salaryRange && (typeof salaryRange.max === "number" || typeof salaryRange.max === "string")
      ? salaryRange.max
      : null;
  const salaryCurrency =
    salaryRange && typeof salaryRange.currency === "string" ? salaryRange.currency : null;

  const sourceUrl = typeof posting.hostedUrl === "string" ? posting.hostedUrl : null;
  const applyUrl = typeof posting.applyUrl === "string" ? posting.applyUrl : sourceUrl;

  return {
    source: "lever",
    sourceJobId,
    sourceUrl,
    applyUrl,
    companyName: company.displayName,
    title: typeof posting.text === "string" ? posting.text : null,
    description: typeof posting.description === "string" ? posting.description : null,
    location: typeof categories.location === "string" ? categories.location : null,
    jobType: typeof categories.commitment === "string" ? categories.commitment : null,
    workLocation: typeof posting.workplaceType === "string" ? posting.workplaceType : null,
    role:
      typeof categories.department === "string"
        ? categories.department
        : typeof categories.team === "string"
          ? categories.team
          : null,
    salaryMin,
    salaryMax,
    salaryCurrency,
    postedAt:
      typeof posting.createdAt === "number" && Number.isFinite(posting.createdAt)
        ? new Date(posting.createdAt).toISOString()
        : null,
    rawPayload: posting,
  };
}

export class LeverAdapter implements JobSourceAdapter {
  readonly source = "lever";
  private readonly companies: LeverCompanyConfig[];
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private lastFetchErrors: string[] = [];

  constructor(options: {
    companies: LeverCompanyConfig[];
    baseUrl?: string;
    timeoutMs?: number;
  }) {
    this.companies = options.companies;
    this.baseUrl = options.baseUrl ?? LEVER_DEFAULT_BASE_URL;
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
        "LeverAdapter: no companies configured. Set LEVER_COMPANIES to a comma-separated list of Lever company slugs.",
      );
    }

    const results: RawExternalJob[] = [];
    for (const company of this.companies) {
      try {
        results.push(...(await this.fetchCompany(company)));
      } catch (error) {
        this.lastFetchErrors.push(
          `lever_company_fetch_failed[company=${company.slug}]: ${(error as Error).message}`,
        );
      }
    }

    // Every configured company failed and nothing was fetched: this is a
    // total fetch failure, not a partial one — let the runner mark the run
    // "failed" the same way any other fetch error would.
    if (results.length === 0 && this.lastFetchErrors.length === this.companies.length) {
      throw new Error(
        `LeverAdapter: all ${this.companies.length} configured compan${this.companies.length === 1 ? "y" : "ies"} failed: ${this.lastFetchErrors.join("; ")}`,
      );
    }

    return results;
  }

  private async fetchCompany(company: LeverCompanyConfig): Promise<RawExternalJob[]> {
    if (!company.slug) {
      throw new Error("invalid company configuration (empty slug)");
    }

    let response;
    try {
      response = await axios.get(`${this.baseUrl}/${encodeURIComponent(company.slug)}`, {
        params: { mode: "json" },
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
      throw new Error(`unknown Lever company "${company.slug}" (HTTP 404)`);
    }
    if (response.status === 429) {
      throw new Error("rate limited by Lever's public API (HTTP 429)");
    }
    if (response.status >= 400 && response.status < 500) {
      throw new Error(`Lever API rejected the request (HTTP ${response.status})`);
    }
    if (response.status >= 500) {
      throw new Error(`Lever API server error (HTTP ${response.status})`);
    }

    const data = response.data;
    if (!Array.isArray(data)) {
      throw new Error("malformed response: expected a JSON array of postings");
    }

    const jobs: RawExternalJob[] = [];
    for (const entry of data) {
      if (typeof entry !== "object" || entry === null) continue;
      jobs.push(toRawExternalJob(company, entry as LeverPosting));
    }
    return jobs;
  }
}
