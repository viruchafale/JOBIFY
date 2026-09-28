/**
 * Phase 4 — Lever adapter tests.
 *
 * No real network access: axios is mocked. Covers successful mapping,
 * multiple postings, empty responses, malformed responses, HTTP failures
 * (400/404/429/500), timeouts/network failures, and multi-company
 * error isolation (one company's failure must not drop another's jobs).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("axios", () => ({
  default: { get: mockGet },
}));

import { LeverAdapter, parseLeverCompanies } from "./leverAdapter.js";

function jsonResponse(status: number, data: unknown) {
  return { status, data };
}

const SAMPLE_POSTING = {
  id: "abc-123",
  text: "Senior Backend Engineer",
  description: "<div>Build things.</div>",
  categories: {
    commitment: "Full-time",
    location: "Remote - US",
    team: "Engineering",
  },
  createdAt: 1700000000000,
  hostedUrl: "https://jobs.lever.co/acme/abc-123",
  applyUrl: "https://jobs.lever.co/acme/abc-123/apply",
  workplaceType: "remote",
};

describe("parseLeverCompanies", () => {
  it("parses comma-separated slugs", () => {
    expect(parseLeverCompanies("acme,globex")).toEqual([
      { slug: "acme", displayName: "acme" },
      { slug: "globex", displayName: "globex" },
    ]);
  });

  it("parses optional display names", () => {
    expect(parseLeverCompanies("acme:Acme Corp, globex")).toEqual([
      { slug: "acme", displayName: "Acme Corp" },
      { slug: "globex", displayName: "globex" },
    ]);
  });

  it("returns an empty array for undefined/empty input", () => {
    expect(parseLeverCompanies(undefined)).toEqual([]);
    expect(parseLeverCompanies("")).toEqual([]);
    expect(parseLeverCompanies("  ,  ")).toEqual([]);
  });
});

describe("LeverAdapter.fetchJobs", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("throws when no companies are configured", async () => {
    const adapter = new LeverAdapter({ companies: [] });
    await expect(adapter.fetchJobs()).rejects.toThrow(/no companies configured/);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("maps a successful response into RawExternalJob", async () => {
    mockGet.mockResolvedValueOnce(jsonResponse(200, [SAMPLE_POSTING]));
    const adapter = new LeverAdapter({ companies: [{ slug: "acme", displayName: "Acme Corp" }] });

    const jobs = await adapter.fetchJobs();

    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.source).toBe("lever");
    expect(job.sourceJobId).toBe("abc-123");
    expect(job.title).toBe("Senior Backend Engineer");
    expect(job.companyName).toBe("Acme Corp");
    expect(job.description).toBe("<div>Build things.</div>");
    expect(job.sourceUrl).toBe("https://jobs.lever.co/acme/abc-123");
    expect(job.applyUrl).toBe("https://jobs.lever.co/acme/abc-123/apply");
    expect(job.location).toBe("Remote - US");
    expect(job.jobType).toBe("Full-time");
    expect(job.workLocation).toBe("remote");
    expect(job.role).toBe("Engineering");
    expect(job.postedAt).toBe(new Date(1700000000000).toISOString());
    expect(job.rawPayload).toEqual(SAMPLE_POSTING);
    expect(adapter.getLastFetchErrors()).toEqual([]);

    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining("/acme"),
      expect.objectContaining({ params: { mode: "json" } }),
    );
  });

  it("falls back to hostedUrl for applyUrl and slug for company name when unavailable", async () => {
    mockGet.mockResolvedValueOnce(
      jsonResponse(200, [{ id: "x1", text: "Role", hostedUrl: "https://jobs.lever.co/acme/x1" }]),
    );
    const adapter = new LeverAdapter({ companies: [{ slug: "acme", displayName: "acme" }] });

    const [job] = await adapter.fetchJobs();
    expect(job.applyUrl).toBe("https://jobs.lever.co/acme/x1");
    expect(job.companyName).toBe("acme");
    expect(job.description).toBeNull();
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.salaryCurrency).toBeNull();
  });

  it("maps multiple postings into multiple RawExternalJob records", async () => {
    mockGet.mockResolvedValueOnce(
      jsonResponse(200, [
        SAMPLE_POSTING,
        { ...SAMPLE_POSTING, id: "def-456", text: "Frontend Engineer" },
      ]),
    );
    const adapter = new LeverAdapter({ companies: [{ slug: "acme", displayName: "Acme" }] });

    const jobs = await adapter.fetchJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.sourceJobId)).toEqual(["abc-123", "def-456"]);
  });

  it("handles an empty postings array", async () => {
    mockGet.mockResolvedValueOnce(jsonResponse(200, []));
    const adapter = new LeverAdapter({ companies: [{ slug: "acme", displayName: "Acme" }] });

    const jobs = await adapter.fetchJobs();
    expect(jobs).toEqual([]);
    expect(adapter.getLastFetchErrors()).toEqual([]);
  });

  it("produces a useful error for a malformed (non-array) response", async () => {
    mockGet.mockResolvedValueOnce(jsonResponse(200, { unexpected: "object" }));
    const adapter = new LeverAdapter({ companies: [{ slug: "acme", displayName: "Acme" }] });

    await expect(adapter.fetchJobs()).rejects.toThrow(/malformed response/);
  });

  it.each([400, 404, 429, 500])("produces a useful error for HTTP %d", async (status) => {
    mockGet.mockResolvedValueOnce(jsonResponse(status, {}));
    const adapter = new LeverAdapter({ companies: [{ slug: "acme", displayName: "Acme" }] });

    await expect(adapter.fetchJobs()).rejects.toThrow(new RegExp(String(status)));
  });

  it("propagates a timeout error", async () => {
    const timeoutError = Object.assign(new Error("timeout of 10000ms exceeded"), {
      code: "ECONNABORTED",
    });
    mockGet.mockRejectedValueOnce(timeoutError);
    const adapter = new LeverAdapter({ companies: [{ slug: "acme", displayName: "Acme" }] });

    await expect(adapter.fetchJobs()).rejects.toThrow(/timed out/);
  });

  it("propagates a DNS/network failure", async () => {
    mockGet.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND api.lever.co"));
    const adapter = new LeverAdapter({ companies: [{ slug: "acme", displayName: "Acme" }] });

    await expect(adapter.fetchJobs()).rejects.toThrow(/ENOTFOUND/);
  });

  it("isolates a per-company failure: other companies' jobs survive and the failure is reported", async () => {
    mockGet
      .mockResolvedValueOnce(jsonResponse(200, [SAMPLE_POSTING])) // company A
      .mockResolvedValueOnce(jsonResponse(500, {})) // company B
      .mockResolvedValueOnce(
        jsonResponse(200, [{ ...SAMPLE_POSTING, id: "c-1", text: "Role C" }]),
      ); // company C

    const adapter = new LeverAdapter({
      companies: [
        { slug: "company-a", displayName: "Company A" },
        { slug: "company-b", displayName: "Company B" },
        { slug: "company-c", displayName: "Company C" },
      ],
    });

    const jobs = await adapter.fetchJobs();

    expect(jobs.map((j) => j.sourceJobId).sort()).toEqual(["abc-123", "c-1"].sort());
    const errors = adapter.getLastFetchErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/company=company-b/);
    expect(errors[0]).toMatch(/500/);
  });

  it("throws when every configured company fails", async () => {
    mockGet
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(500, {}));

    const adapter = new LeverAdapter({
      companies: [
        { slug: "company-a", displayName: "Company A" },
        { slug: "company-b", displayName: "Company B" },
      ],
    });

    await expect(adapter.fetchJobs()).rejects.toThrow(/all 2 configured companies failed/);
  });

  it("rejects an invalid (empty-slug) company configuration", async () => {
    const adapter = new LeverAdapter({ companies: [{ slug: "", displayName: "" }] });
    await expect(adapter.fetchJobs()).rejects.toThrow(/invalid company configuration/);
  });
});
