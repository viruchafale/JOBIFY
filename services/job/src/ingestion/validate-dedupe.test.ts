/**
 * Phase 3 — Validation + fingerprint + dedupe unit tests.
 */

import { describe, it, expect } from "vitest";
import { computeContentFingerprint } from "./fingerprint.js";
import { dedupeNormalizedJobs } from "./dedupe.js";
import { normalizeRawJob } from "./normalize.js";
import type { NormalizedExternalJob, RawExternalJob } from "./types.js";
import { validateNormalizedJob } from "./validate.js";

function validJob(overrides: Partial<NormalizedExternalJob> = {}): NormalizedExternalJob {
  return {
    source: "fixture",
    sourceJobId: "fx-1",
    canonicalUrl: "https://example.com/jobs/fx-1",
    applyUrl: "https://example.com/jobs/fx-1/apply",
    companyName: "Acme",
    title: "Engineer",
    description: "Do things.",
    location: "Remote",
    jobType: "Full-time",
    workLocation: "Remote",
    role: "Engineering",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt: null,
    contentFingerprint: "fp-1",
    ...overrides,
  };
}

describe("validateNormalizedJob", () => {
  it("accepts a valid job", () => {
    expect(validateNormalizedJob(validJob())).toEqual({ valid: true, reasons: [] });
  });

  it("rejects a missing title", () => {
    const result = validateNormalizedJob(validJob({ title: null }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("missing_title");
  });

  it("rejects a missing description", () => {
    const result = validateNormalizedJob(validJob({ description: null }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("missing_description");
  });

  it("rejects a missing source job id", () => {
    const result = validateNormalizedJob(validJob({ sourceJobId: "  " }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("missing_source_job_id");
  });

  it("rejects a missing canonical URL / company / source", () => {
    const result = validateNormalizedJob(
      validJob({ canonicalUrl: null, companyName: null, source: "" }),
    );
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "missing_canonical_url",
        "missing_company_name",
        "missing_source",
      ]),
    );
  });

  it("reports every problem at once", () => {
    const result = validateNormalizedJob(
      validJob({ title: null, description: null }),
    );
    expect(result.reasons).toHaveLength(2);
  });
});

describe("computeContentFingerprint", () => {
  it("is deterministic and 64-char hex", () => {
    const input = {
      companyName: "Acme",
      title: "Engineer",
      description: "Do things.",
      location: "Remote",
    };
    const a = computeContentFingerprint(input);
    const b = computeContentFingerprint(input);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is case/whitespace insensitive", () => {
    const a = computeContentFingerprint({
      companyName: "Acme",
      title: "Engineer",
      description: "Do things.",
      location: "Remote",
    });
    const b = computeContentFingerprint({
      companyName: "  acme ",
      title: "ENGINEER",
      description: "do  things.",
      location: "remote",
    });
    expect(a).toBe(b);
  });

  it("changes when content changes", () => {
    const a = computeContentFingerprint({
      companyName: "Acme",
      title: "Engineer",
      description: "Do things.",
      location: "Remote",
    });
    const b = computeContentFingerprint({
      companyName: "Acme",
      title: "Manager",
      description: "Do things.",
      location: "Remote",
    });
    expect(a).not.toBe(b);
  });
});

describe("dedupeNormalizedJobs", () => {
  it("deduplicates same source + sourceJobId (Level 1)", () => {
    const jobs = [validJob({ sourceJobId: "a" }), validJob({ sourceJobId: "a" })];
    const result = dedupeNormalizedJobs(jobs);
    expect(result.unique).toHaveLength(1);
    expect(result.duplicateCount).toBe(1);
  });

  it("treats same id from different sources as distinct", () => {
    const jobs = [
      validJob({ source: "lever", sourceJobId: "a", canonicalUrl: "https://x/1", contentFingerprint: "fp-a" }),
      validJob({ source: "greenhouse", sourceJobId: "a", canonicalUrl: "https://x/2", contentFingerprint: "fp-b" }),
    ];
    expect(dedupeNormalizedJobs(jobs).unique).toHaveLength(2);
  });

  it("deduplicates same canonical URL (Level 2)", () => {
    const jobs = [
      validJob({ sourceJobId: "a", canonicalUrl: "https://x/jobs/1/", contentFingerprint: "fp-a" }),
      validJob({ sourceJobId: "b", canonicalUrl: "https://x/jobs/1", contentFingerprint: "fp-b" }),
    ];
    // Note: in-batch dedupe compares raw canonical strings case-insensitively;
    // normalization normally strips the trailing slash beforehand.
    const normalized = jobs.map((job) => ({
      ...job,
      canonicalUrl: job.canonicalUrl!.replace(/\/$/, ""),
    }));
    const result = dedupeNormalizedJobs(normalized);
    expect(result.unique).toHaveLength(1);
    expect(result.duplicateCount).toBe(1);
  });

  it("deduplicates same fingerprint (Level 3)", () => {
    const jobs = [
      validJob({ sourceJobId: "a", canonicalUrl: "https://x/1", contentFingerprint: "same-fp" }),
      validJob({ sourceJobId: "b", canonicalUrl: "https://x/2", contentFingerprint: "same-fp" }),
    ];
    const result = dedupeNormalizedJobs(jobs);
    expect(result.unique).toHaveLength(1);
    expect(result.duplicateCount).toBe(1);
  });

  it("keeps distinct jobs distinct", () => {
    const jobs = [
      validJob({ sourceJobId: "a", canonicalUrl: "https://x/1", contentFingerprint: "fp-a" }),
      validJob({ sourceJobId: "b", canonicalUrl: "https://x/2", contentFingerprint: "fp-b" }),
      validJob({ sourceJobId: "c", canonicalUrl: "https://x/3", contentFingerprint: "fp-c" }),
    ];
    const result = dedupeNormalizedJobs(jobs);
    expect(result.unique).toHaveLength(3);
    expect(result.duplicateCount).toBe(0);
  });

  it("keeps the first occurrence", () => {
    const jobs = [
      validJob({ sourceJobId: "a", title: "First", contentFingerprint: "fp-a", canonicalUrl: "https://x/1" }),
      validJob({ sourceJobId: "a", title: "Second", contentFingerprint: "fp-b", canonicalUrl: "https://x/1" }),
    ];
    const result = dedupeNormalizedJobs(jobs);
    expect(result.unique[0].title).toBe("First");
  });

  it("end-to-end: messy equivalents share a fingerprint after normalization", () => {
    const toRaw = (overrides: Partial<RawExternalJob>): RawExternalJob => ({
      source: "fixture",
      sourceJobId: "fx-x",
      sourceUrl: "https://initech.example.com/jobs/fx-x",
      applyUrl: null,
      companyName: "Initech",
      title: "Data Analyst",
      description: "<div>Analyze <em>business</em> data.</div>",
      location: "Austin, TX",
      jobType: "Contract",
      workLocation: "Hybrid",
      role: "Data",
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      postedAt: null,
      rawPayload: {},
      ...overrides,
    });
    const a = normalizeRawJob(toRaw({}));
    const b = normalizeRawJob(
      toRaw({
        sourceJobId: "fx-y",
        sourceUrl: "https://initech.example.com/jobs/fx-y",
        companyName: "  Initech ",
        title: "  Data   Analyst ",
      }),
    );
    expect(a.contentFingerprint).toBe(b.contentFingerprint);
    const result = dedupeNormalizedJobs([a, b]);
    expect(result.duplicateCount).toBe(1);
  });
});
