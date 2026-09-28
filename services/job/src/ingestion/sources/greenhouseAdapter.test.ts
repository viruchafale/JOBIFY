/**
 * Phase 5 — Greenhouse adapter tests.
 *
 * No real network access: axios is mocked. Covers successful mapping
 * (including the content-field entity-unescaping quirk), multiple postings,
 * empty responses, malformed responses, HTTP failures (400/404/429/500),
 * timeouts/network failures, multi-company error isolation, and invalid
 * configuration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("axios", () => ({
  default: { get: mockGet },
}));

import { GreenhouseAdapter, parseGreenhouseCompanies } from "./greenhouseAdapter.js";

function jsonResponse(status: number, data: unknown) {
  return { status, data };
}

const SAMPLE_JOB = {
  id: 8556658002,
  title: "AI Engineer",
  absolute_url: "https://job-boards.greenhouse.io/gitlab/jobs/8556658002",
  location: { name: "Remote, Bangalore" },
  offices: [{ name: "India" }],
  departments: [{ name: "Engineering" }],
  company_name: "GitLab",
  content: "&lt;div class=&quot;content-intro&quot;&gt;&lt;p&gt;Build great things &amp;amp; ship.&lt;/p&gt;&lt;/div&gt;",
  first_published: "2026-05-22T09:16:29-04:00",
  updated_at: "2026-09-14T16:01:39-04:00",
};

describe("parseGreenhouseCompanies", () => {
  it("parses comma-separated slugs", () => {
    expect(parseGreenhouseCompanies("gitlab,stripe")).toEqual([
      { slug: "gitlab", displayName: "gitlab" },
      { slug: "stripe", displayName: "stripe" },
    ]);
  });

  it("parses optional display names", () => {
    expect(parseGreenhouseCompanies("gitlab:GitLab Inc, stripe")).toEqual([
      { slug: "gitlab", displayName: "GitLab Inc" },
      { slug: "stripe", displayName: "stripe" },
    ]);
  });

  it("returns an empty array for undefined/empty input", () => {
    expect(parseGreenhouseCompanies(undefined)).toEqual([]);
    expect(parseGreenhouseCompanies("")).toEqual([]);
    expect(parseGreenhouseCompanies("  ,  ")).toEqual([]);
  });
});

describe("GreenhouseAdapter.fetchJobs", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("throws when no companies are configured", async () => {
    const adapter = new GreenhouseAdapter({ companies: [] });
    await expect(adapter.fetchJobs()).rejects.toThrow(/no companies configured/);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("maps a successful response into RawExternalJob, unescaping the content field once", async () => {
    mockGet.mockResolvedValueOnce(jsonResponse(200, { jobs: [SAMPLE_JOB] }));
    const adapter = new GreenhouseAdapter({ companies: [{ slug: "gitlab", displayName: "GitLab" }] });

    const jobs = await adapter.fetchJobs();

    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.source).toBe("greenhouse");
    expect(job.sourceJobId).toBe("8556658002");
    expect(job.title).toBe("AI Engineer");
    expect(job.companyName).toBe("GitLab");
    expect(job.description).toBe('<div class="content-intro"><p>Build great things &amp; ship.</p></div>');
    expect(job.sourceUrl).toBe("https://job-boards.greenhouse.io/gitlab/jobs/8556658002");
    expect(job.applyUrl).toBe("https://job-boards.greenhouse.io/gitlab/jobs/8556658002");
    expect(job.location).toBe("Remote, Bangalore");
    expect(job.role).toBe("Engineering");
    expect(job.jobType).toBeNull();
    expect(job.workLocation).toBeNull();
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.postedAt).toBe("2026-05-22T09:16:29-04:00");
    expect(job.rawPayload).toEqual(SAMPLE_JOB);
    expect(adapter.getLastFetchErrors()).toEqual([]);

    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining("/gitlab/jobs"),
      expect.objectContaining({ params: { content: "true" } }),
    );
  });

  it("falls back to offices[].name when location.name is missing, and to configured display name / updated_at", async () => {
    mockGet.mockResolvedValueOnce(
      jsonResponse(200, {
        jobs: [
          {
            id: 1,
            title: "Role",
            absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1",
            offices: [{ name: "Berlin" }, { name: "Remote" }],
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
    const adapter = new GreenhouseAdapter({ companies: [{ slug: "acme", displayName: "Acme Corp" }] });

    const [job] = await adapter.fetchJobs();
    expect(job.location).toBe("Berlin, Remote");
    expect(job.companyName).toBe("Acme Corp");
    expect(job.postedAt).toBe("2026-01-01T00:00:00Z");
    expect(job.description).toBeNull();
  });

  it("maps multiple postings into multiple RawExternalJob records", async () => {
    mockGet.mockResolvedValueOnce(
      jsonResponse(200, { jobs: [SAMPLE_JOB, { ...SAMPLE_JOB, id: 999, title: "Backend Engineer" }] }),
    );
    const adapter = new GreenhouseAdapter({ companies: [{ slug: "gitlab", displayName: "GitLab" }] });

    const jobs = await adapter.fetchJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.sourceJobId)).toEqual(["8556658002", "999"]);
  });

  it("handles an empty postings array", async () => {
    mockGet.mockResolvedValueOnce(jsonResponse(200, { jobs: [] }));
    const adapter = new GreenhouseAdapter({ companies: [{ slug: "gitlab", displayName: "GitLab" }] });

    const jobs = await adapter.fetchJobs();
    expect(jobs).toEqual([]);
    expect(adapter.getLastFetchErrors()).toEqual([]);
  });

  it("produces a useful error for a malformed response (missing jobs array)", async () => {
    mockGet.mockResolvedValueOnce(jsonResponse(200, { unexpected: "object" }));
    const adapter = new GreenhouseAdapter({ companies: [{ slug: "gitlab", displayName: "GitLab" }] });

    await expect(adapter.fetchJobs()).rejects.toThrow(/malformed response/);
  });

  it.each([400, 404, 429, 500])("produces a useful error for HTTP %d", async (status) => {
    mockGet.mockResolvedValueOnce(jsonResponse(status, {}));
    const adapter = new GreenhouseAdapter({ companies: [{ slug: "gitlab", displayName: "GitLab" }] });

    await expect(adapter.fetchJobs()).rejects.toThrow(new RegExp(String(status)));
  });

  it("propagates a timeout error", async () => {
    const timeoutError = Object.assign(new Error("timeout of 10000ms exceeded"), {
      code: "ECONNABORTED",
    });
    mockGet.mockRejectedValueOnce(timeoutError);
    const adapter = new GreenhouseAdapter({ companies: [{ slug: "gitlab", displayName: "GitLab" }] });

    await expect(adapter.fetchJobs()).rejects.toThrow(/timed out/);
  });

  it("propagates a DNS/network failure", async () => {
    mockGet.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND boards-api.greenhouse.io"));
    const adapter = new GreenhouseAdapter({ companies: [{ slug: "gitlab", displayName: "GitLab" }] });

    await expect(adapter.fetchJobs()).rejects.toThrow(/ENOTFOUND/);
  });

  it("isolates a per-company failure: other companies' jobs survive and the failure is reported", async () => {
    mockGet
      .mockResolvedValueOnce(jsonResponse(200, { jobs: [SAMPLE_JOB] })) // company A
      .mockResolvedValueOnce(jsonResponse(500, {})) // company B
      .mockResolvedValueOnce(jsonResponse(200, { jobs: [{ ...SAMPLE_JOB, id: "c-1", title: "Role C" }] })); // company C

    const adapter = new GreenhouseAdapter({
      companies: [
        { slug: "company-a", displayName: "Company A" },
        { slug: "company-b", displayName: "Company B" },
        { slug: "company-c", displayName: "Company C" },
      ],
    });

    const jobs = await adapter.fetchJobs();

    expect(jobs.map((j) => j.sourceJobId).sort()).toEqual(["8556658002", "c-1"].sort());
    const errors = adapter.getLastFetchErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/company=company-b/);
    expect(errors[0]).toMatch(/500/);
  });

  it("throws when every configured board fails", async () => {
    mockGet
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(jsonResponse(500, {}));

    const adapter = new GreenhouseAdapter({
      companies: [
        { slug: "company-a", displayName: "Company A" },
        { slug: "company-b", displayName: "Company B" },
      ],
    });

    await expect(adapter.fetchJobs()).rejects.toThrow(/all 2 configured boards failed/);
  });

  it("rejects an invalid (empty-slug) company configuration", async () => {
    const adapter = new GreenhouseAdapter({ companies: [{ slug: "", displayName: "" }] });
    await expect(adapter.fetchJobs()).rejects.toThrow(/invalid company configuration/);
  });
});
