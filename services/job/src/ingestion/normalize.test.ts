/**
 * Phase 3 — Normalization unit tests (deterministic, no I/O).
 */

import { describe, it, expect } from "vitest";
import {
  collapseWhitespace,
  normalizeCurrency,
  normalizeDescription,
  normalizeJobType,
  normalizePostedAt,
  normalizeRawJob,
  normalizeSalaryNumber,
  normalizeText,
  normalizeUrl,
  normalizeWorkLocation,
  stripHtml,
} from "./normalize.js";
import type { RawExternalJob } from "./types.js";

function makeRaw(overrides: Partial<RawExternalJob> = {}): RawExternalJob {
  return {
    source: "fixture",
    sourceJobId: "fx-1",
    sourceUrl: "https://example.com/jobs/fx-1",
    applyUrl: null,
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
    rawPayload: {},
    ...overrides,
  };
}

describe("collapseWhitespace / normalizeText", () => {
  it("collapses inner whitespace and trims", () => {
    expect(collapseWhitespace("  Senior   Software\n\tEngineer  ")).toBe(
      "Senior Software Engineer",
    );
  });

  it("converts empty / whitespace-only strings to null", () => {
    expect(normalizeText("   ")).toBeNull();
    expect(normalizeText("")).toBeNull();
    expect(normalizeText(null)).toBeNull();
    expect(normalizeText(123)).toBeNull();
  });

  it("preserves case but normalizes spacing", () => {
    expect(normalizeText("  Acme   Corp ")).toBe("Acme Corp");
  });
});

describe("stripHtml / normalizeDescription", () => {
  it("strips tags and keeps text", () => {
    expect(stripHtml("<p>Build <strong>things</strong></p>")).toBe("Build things");
  });

  it("removes script/style content", () => {
    expect(
      stripHtml("<script>alert(1)</script><p>Hello</p>"),
    ).toBe("Hello");
  });

  it("decodes common entities", () => {
    expect(normalizeDescription("<p>Fish &amp; Chips &lt;team&gt;</p>")).toBe(
      "Fish & Chips <team>",
    );
  });

  it("leaves plain text intact", () => {
    expect(normalizeDescription("Just plain text.")).toBe("Just plain text.");
  });
});

describe("normalizeJobType", () => {
  it.each([
    ["Full-time", "Full-time"],
    ["FULL TIME", "Full-time"],
    ["FullTime", "Full-time"],
    ["ft", "Full-time"],
    ["part time", "Part-time"],
    ["PT", "Part-time"],
    ["contract", "Contract"],
    ["Contractor", "Contract"],
    ["intern", "Internship"],
    ["Internship", "Internship"],
  ])("maps %s → %s", (input, expected) => {
    expect(normalizeJobType(input)).toBe(expected);
  });

  it("returns null for unknown values", () => {
    expect(normalizeJobType("Temporary")).toBeNull();
    expect(normalizeJobType("")).toBeNull();
    expect(normalizeJobType(null)).toBeNull();
  });
});

describe("normalizeWorkLocation", () => {
  it.each([
    ["Remote", "Remote"],
    ["WFH", "Remote"],
    ["work from home", "Remote"],
    ["OnSite", "On-site"],
    ["on site", "On-site"],
    ["office", "On-site"],
    ["HYBRID", "Hybrid"],
  ])("maps %s → %s", (input, expected) => {
    expect(normalizeWorkLocation(input)).toBe(expected);
  });

  it("returns null for unknown values", () => {
    expect(normalizeWorkLocation("Moon")).toBeNull();
  });
});

describe("normalizeUrl", () => {
  it("lowercases scheme/host, drops fragment and trailing slash", () => {
    expect(normalizeUrl("HTTPS://Example.COM/Jobs/1#section")).toBe(
      "https://example.com/Jobs/1",
    );
  });

  it("strips a single trailing slash", () => {
    expect(normalizeUrl("https://acme.example.com/careers/fx-001/")).toBe(
      "https://acme.example.com/careers/fx-001",
    );
  });

  it("returns null for empty / non-http / unparseable values", () => {
    expect(normalizeUrl("   ")).toBeNull();
    expect(normalizeUrl("ftp://example.com/x")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
  });
});

describe("normalizeCurrency / normalizeSalaryNumber / normalizePostedAt", () => {
  it("uppercases valid ISO codes", () => {
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("EUR")).toBe("EUR");
    expect(normalizeCurrency("US dollars")).toBeNull();
  });

  it("coerces numeric strings, rejects negatives/NaN", () => {
    expect(normalizeSalaryNumber("120000")).toBe(120000);
    expect(normalizeSalaryNumber(-5)).toBeNull();
    expect(normalizeSalaryNumber("abc")).toBeNull();
    expect(normalizeSalaryNumber(null)).toBeNull();
  });

  it("parses dates to ISO, null on garbage", () => {
    expect(normalizePostedAt("2026-09-01T10:00:00Z")).toBe(
      "2026-09-01T10:00:00.000Z",
    );
    expect(normalizePostedAt("not-a-date")).toBeNull();
  });
});

describe("normalizeRawJob", () => {
  it("normalizes a messy raw job deterministically", () => {
    const first = normalizeRawJob(
      makeRaw({
        title: "  Senior   Software Engineer  ",
        description: "<p>Build <strong>things</strong></p>",
        jobType: "FULL-TIME",
        workLocation: "remote",
        sourceUrl: "https://acme.example.com/careers/fx-1/",
        salaryCurrency: "usd",
      }),
    );
    const second = normalizeRawJob(
      makeRaw({
        title: "Senior Software Engineer",
        description: "Build things",
        jobType: "Full-time",
        workLocation: "Remote",
        sourceUrl: "https://acme.example.com/careers/fx-1",
        salaryCurrency: "USD",
      }),
    );
    expect(first.title).toBe("Senior Software Engineer");
    expect(first.description).toBe("Build things");
    expect(first.jobType).toBe("Full-time");
    expect(first.workLocation).toBe("Remote");
    expect(first.canonicalUrl).toBe("https://acme.example.com/careers/fx-1");
    expect(first.salaryCurrency).toBe("USD");
    // Same logical content → same fingerprint.
    expect(first.contentFingerprint).toBe(second.contentFingerprint);
  });

  it("falls back applyUrl to canonicalUrl when missing", () => {
    const job = normalizeRawJob(makeRaw({ applyUrl: "" }));
    expect(job.applyUrl).toBe(job.canonicalUrl);
  });

  it("swaps inverted salary ranges", () => {
    const job = normalizeRawJob(makeRaw({ salaryMin: 200000, salaryMax: 150000 }));
    expect(job.salaryMin).toBe(150000);
    expect(job.salaryMax).toBe(200000);
  });

  it("always produces a 64-char hex fingerprint", () => {
    const job = normalizeRawJob(makeRaw());
    expect(job.contentFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
