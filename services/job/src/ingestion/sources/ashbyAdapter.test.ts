/**
 * Phase 5 — Ashby adapter tests.
 *
 * No real network access: axios is mocked. Covers successful mapping,
 * multiple postings, empty responses, malformed responses, HTTP failures
 * (400/404/429/500), timeouts/network failures, multi-company error
 * isolation, invalid configuration, and compensation mapping (present and
 * absent).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("axios", () => ({
  default: { get: mockGet },
}));

import { AshbyAdapter, parseAshbyCompanies } from "./ashbyAdapter.js";

function jsonResponse(status: number, data: unknown) {
  return { status, data };
}

const SAMPLE_POSTING = {
  id: "cb1aec2c-05cd-4598-8117-bd1f7ed9a49f",
  title: "Finance Manager, Marketing",
  department: "Finance",
  team: "Finance",
  employmentType: "FullTime",
  location: "NAMER",
  publishedAt: "2026-09-21T20:13:45.355+00:00",
  workplaceType: "Remote",
  jobUrl: "https://jobs.ashbyhq.com/zapier/cb1aec2c-05cd-4598-8117-bd1f7ed9a49f",
  applyUrl: "https://jobs.ashbyhq.com/zapier/cb1aec2c-05cd-4598-8117-bd1f7ed9a49f/application",
  descriptionHtml: "<h2><strong>AI at Zapier</strong></h2><p>Some description.</p>",
  compensation: {
    summaryComponents: [
      { compensationType: "Bonus", currencyCode: null, minValue: null, maxValue: null },
      {
        compensationType: "Salary",
        currencyCode: "USD",
        minValue: 158300,
        maxValue: 237500,
      },
    ],
  },
};

describe("parseAshbyCompanies", () => {
  it("parses comma-separated slugs", () => {
    expect(parseAshbyCompanies("zapier,ramp")).toEqual([
      { slug: "zapier", displayName: "zapier" },
      { slug: "ramp", displayName: "ramp" },
    ]);
  });

  it("parses optional display names", () => {
    expect(parseAshbyCompanies("zapier:Zapier Inc, ramp")).toEqual([
      { slug: "zapier", displayName: "Zapier Inc" },
      { slug: "ramp", displayName: "ramp" },
    ]);
  });

  it("returns an empty array for undefined/empty input", () => {
    expect(parseAshbyCompanies(undefined)).toEqual([]);
    expect(parseAshbyCompanies("")).toEqual([]);
    expect(parseAshbyCompanies("  ,  ")).toEqual([]);
  });
});

describe("AshbyAdapter.fetchJobs", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("throws when no companies are configured", async () => {
    const adapter = new AshbyAdapter({ companies: [] });
    await expect(adapter.fetchJobs()).rejects.toThrow(/no companies configured/);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("maps a successful response into RawExternalJob, including compensation", async () => {
    mockGet.mockResolvedValueOnce(jsonResponse(200, { jobs: [SAMPLE_POSTING], apiVersion: "1" }));
    const adapter = new AshbyAdapter({ companies: [{ slug: "zapier", displayName: "Zapier" }] });

    const jobs = await adapter.fetchJobs();

    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.source).toBe("ashby");
    expect(job.sourceJobId).toBe("cb1aec2c-05cd-4598-8117-bd1f7ed9a49f");
    expect(job.title).toBe("Finance Manager, Marketing");
    expect(job.companyName).toBe("Zapier");
    expect(job.description).toBe("<h2><strong>AI at Zapier</strong></h2><p>Some description.</p>");
    expect(job.sourceUrl).toBe("https://jobs.ashbyhq.com/zapier/cb1aec2c-05cd-4598-8117-bd1f7ed9a49f");
    expect(job.applyUrl).toBe(
      "https://jobs.ashbyhq.com/zapier/cb1aec2c-05cd-4598-8117-bd1f7ed9a49f/application",
    );
    expect(job.location).toBe("NAMER");
    expect(job.jobType).toBe("FullTime");
    expect(job.workLocation).toBe("Remote");
    expect(job.role).toBe("Finance");
    expect(job.salaryMin).toBe(158300);
    expect(job.salaryMax).toBe(237500);
    expect(job.salaryCurrency).toBe("USD");
    expect(job.postedAt).toBe("2026-09-21T20:13:45.355+00:00");
    expect(job.rawPayload).toEqual(SAMPLE_POSTING);
    expect(adapter.getLastFetchErrors()).toEqual([]);

    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining("/zapier"),
      expect.objectContaining({ params: { includeCompensation: "true" } }),
    );
  });

  it("maps null salary fields when compensation is absent", async () => {
    const { compensation, ...withoutCompensation } = SAMPLE_POSTING;
    mockGet.mockResolvedValueOnce(jsonResponse(200, { jobs: [withoutCompensation] }));
    const adapter = new AshbyAdapter({ companies: [{ slug: "zapier", displayName: "Zapier" }] });

    const [job] = await adapter.fetchJobs();
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.salaryCurrency).toBeNull();
  });

  it("falls back to jobUrl for applyUrl and to team when department is missing", async () => {
    mockGet.mockResolvedValueOnce(
      jsonResponse(200, {
        jobs: [
          {
            id: "x1",
            title: "Role",
            team: "Platform",
            jobUrl: "https://jobs.ashbyhq.com/acme/x1",
          },
        ],
      }),
    );
    const adapter = new AshbyAdapter({ companies: [{ slug: "acme", displayName: "acme" }] });

    const [job] = await adapter.fetchJobs();
    expect(job.applyUrl).toBe("https://jobs.ashbyhq.com/acme/x1");
    expect(job.role).toBe("Platform");
    expect(job.companyName).toBe("acme");
    expect(job.description).toBeNull();
  });

  it("maps multiple postings into multiple RawExternalJob records", async () => {
    mockGet.mockResolvedValueOnce(
      jsonResponse(200, { jobs: [SAMPLE_POSTING, { ...SAMPLE_POSTING, id: "def-456", title: "Other Role" }] }),
    );
    const adapter = new AshbyAdapter({ companies: [{ slug: "zapier", displayName: "Zapier" }] });

    const jobs = await adapter.fetchJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.sourceJobId)).toEqual([SAMPLE_POSTING.id, "def-456"]);
  });

  it("handles an empty postings array", async () => {
    mockGet.mockResolvedValueOnce(jsonResponse(200, { jobs: [] }));
    const adapter = new AshbyAdapter({ companies: [{ slug: "zapier", displayName: "Zapier" }] });

    const jobs = await adapter.fetchJobs();
    expect(jobs).toEqual([]);
    expect(adapter.getLastFetchErrors()).toEqual([]);
  });

  it("produces a useful error for a malformed response (missing jobs array)", async () => {
    mockGet.mockResolvedValueOnce(jsonResponse(200, { unexpected: "object" }));
    const adapter = new AshbyAdapter({ companies: [{ slug: "zapier", displayName: "Zapier" }] });

    await expect(adapter.fetchJobs()).rejects.toThrow(/malformed response/);
  });

  it.each([400, 404, 429, 500])("produces a useful error for HTTP %d", async (status) => {
    mockGet.mockResolvedValueOnce(jsonResponse(status, {}));
    const adapter = new AshbyAdapter({ companies: [{ slug: "zapier", displayName: "Zapier" }] });

    await expect(adapter.fetchJobs()).rejects.toThrow(new RegExp(String(status)));
  });

  it("propagates a timeout error", async () => {
    const timeoutError = Object.assign(new Error("timeout of 10000ms exceeded"), {
      code: "ECONNABORTED",
    });
    mockGet.mockRejectedValueOnce(timeoutError);
    const adapter = new AshbyAdapter({ companies: [{ slug: "zapier", displayName: "Zapier" }] });

    await expect(adapter.fetchJobs()).rejects.toThrow(/timed out/);
  });

  it("propagates a DNS/network failure", async () => {
    mockGet.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND api.ashbyhq.com"));
    const adapter = new AshbyAdapter({ companies: [{ slug: "zapier", displayName: "Zapier" }] });

    await expect(adapter.fetchJobs()).rejects.toThrow(/ENOTFOUND/);
  });

  it("isolates a per-company failure: other companies' jobs survive and the failure is reported", async () => {
    mockGet
      .mockResolvedValueOnce(jsonResponse(200, { jobs: [SAMPLE_POSTING] })) // company A
      .mockResolvedValueOnce(jsonResponse(500, {})) // company B
      .mockResolvedValueOnce(
        jsonResponse(200, { jobs: [{ ...SAMPLE_POSTING, id: "c-1", title: "Role C" }] }),
      ); // company C

    const adapter = new AshbyAdapter({
      companies: [
        { slug: "company-a", displayName: "Company A" },
        { slug: "company-b", displayName: "Company B" },
        { slug: "company-c", displayName: "Company C" },
      ],
    });

    const jobs = await adapter.fetchJobs();

    expect(jobs.map((j) => j.sourceJobId).sort()).toEqual([SAMPLE_POSTING.id, "c-1"].sort());
    const errors = adapter.getLastFetchErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/company=company-b/);
    expect(errors[0]).toMatch(/500/);
  });

  it("throws when every configured board fails", async () => {
    mockGet
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(500, {}));

    const adapter = new AshbyAdapter({
      companies: [
        { slug: "company-a", displayName: "Company A" },
        { slug: "company-b", displayName: "Company B" },
      ],
    });

    await expect(adapter.fetchJobs()).rejects.toThrow(/all 2 configured boards failed/);
  });

  it("rejects an invalid (empty-slug) company configuration", async () => {
    const adapter = new AshbyAdapter({ companies: [{ slug: "", displayName: "" }] });
    await expect(adapter.fetchJobs()).rejects.toThrow(/invalid company configuration/);
  });
});
