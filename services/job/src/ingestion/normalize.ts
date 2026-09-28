/**
 * Phase 3 — Deterministic normalization (no LLM, no embeddings).
 *
 * Every function here is pure and deterministic: the same raw input always
 * produces the same normalized output.
 */

import { computeContentFingerprint } from "./fingerprint.js";
import type { NormalizedExternalJob, RawExternalJob } from "./types.js";

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Empty / whitespace-only strings become null. Non-strings become null. */
export function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = collapseWhitespace(value);
  return collapsed === "" ? null : collapsed;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const charCode = Number(code);
      return Number.isFinite(charCode) ? String.fromCharCode(charCode) : "";
    });
}

/** Strip script/style blocks + tags, decode entities, collapse whitespace. */
export function stripHtml(value: string): string {
  const withoutScripts = value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withoutTags = withoutScripts.replace(/<[^>]*>/g, " ");
  return collapseWhitespace(decodeHtmlEntities(withoutTags));
}

export function normalizeDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const stripped = stripHtml(value);
  return stripped === "" ? null : stripped;
}

const JOB_TYPE_MAP: Record<string, string> = {
  "full-time": "Full-time",
  fulltime: "Full-time",
  "full time": "Full-time",
  full_time: "Full-time",
  ft: "Full-time",
  "part-time": "Part-time",
  parttime: "Part-time",
  "part time": "Part-time",
  part_time: "Part-time",
  pt: "Part-time",
  contract: "Contract",
  contractor: "Contract",
  contractual: "Contract",
  internship: "Internship",
  intern: "Internship",
};

export function normalizeJobType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.toLowerCase().trim();
  return JOB_TYPE_MAP[key] ?? null;
}

const WORK_LOCATION_MAP: Record<string, string> = {
  remote: "Remote",
  wfh: "Remote",
  "work from home": "Remote",
  workfromhome: "Remote",
  "on-site": "On-site",
  onsite: "On-site",
  "on site": "On-site",
  office: "On-site",
  hybrid: "Hybrid",
};

export function normalizeWorkLocation(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.toLowerCase().trim();
  return WORK_LOCATION_MAP[key] ?? null;
}

/**
 * Lowercase scheme + host, drop fragment, strip one trailing slash.
 * Returns null for empty / non-HTTP(S) / unparseable values so that
 * validation can reject the record instead of persisting junk.
 */
export function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    let normalized = url.toString();
    if (normalized.length > 1 && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return null;
  }
}

export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : null;
}

export function normalizeSalaryNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

export function normalizePostedAt(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const time = Date.parse(value.trim());
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function normalizeRawJob(raw: RawExternalJob): NormalizedExternalJob {
  const source = typeof raw.source === "string" ? raw.source.trim() : "";
  const sourceJobId =
    typeof raw.sourceJobId === "string" ? raw.sourceJobId.trim() : "";

  const canonicalUrl = normalizeUrl(raw.sourceUrl);
  const applyUrl = normalizeUrl(raw.applyUrl) ?? canonicalUrl;

  const companyName = normalizeText(raw.companyName);
  const title = normalizeText(raw.title);
  const description = normalizeDescription(raw.description);
  const location = normalizeText(raw.location);
  const role = normalizeText(raw.role);

  let salaryMin = normalizeSalaryNumber(raw.salaryMin);
  let salaryMax = normalizeSalaryNumber(raw.salaryMax);
  if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
    [salaryMin, salaryMax] = [salaryMax, salaryMin];
  }

  const normalized: NormalizedExternalJob = {
    source,
    sourceJobId,
    canonicalUrl,
    applyUrl,
    companyName,
    title,
    description,
    location,
    jobType: normalizeJobType(raw.jobType),
    workLocation: normalizeWorkLocation(raw.workLocation),
    role,
    salaryMin,
    salaryMax,
    salaryCurrency: normalizeCurrency(raw.salaryCurrency),
    postedAt: normalizePostedAt(raw.postedAt),
    contentFingerprint: "",
  };
  normalized.contentFingerprint = computeContentFingerprint({
    companyName: normalized.companyName ?? "",
    title: normalized.title ?? "",
    description: normalized.description ?? "",
    location: normalized.location ?? "",
  });
  return normalized;
}
