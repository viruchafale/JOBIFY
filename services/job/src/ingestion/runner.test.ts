/**
 * Phase 3 — Runner + repository persistence tests (in-memory fake DB).
 *
 * Verifies: run counts, rejection isolation, idempotent re-runs,
 * first_seen_at stability, last_seen_at refresh, and fetch-failure handling.
 */

import { describe, it, expect } from "vitest";
import type { JobSourceAdapter } from "./adapter.js";
import { FixtureJobSource } from "./sources/fixtureSource.js";
import type { SqlClient } from "./repository.js";
import { runIngestion } from "./runner.js";
import type { RawExternalJob } from "./types.js";

interface FakeExternalRow {
  id: number;
  source: string;
  source_job_id: string;
  canonical_url: string;
  apply_url: string | null;
  company_name: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  job_type: string | null;
  work_location: string | null;
  role: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  posted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_active: boolean;
  content_fingerprint: string;
  raw_job_id: number | null;
}

/** Minimal in-memory stand-in for the ingestion SQL surface. */
function createFakeDb(options: { failInsertForSourceJobId?: string } = {}): SqlClient & {
  runs: Record<string, any>[];
  external: FakeExternalRow[];
  raws: Record<string, any>[];
} {
  const state = {
    runs: [] as Record<string, any>[],
    external: [] as FakeExternalRow[],
    raws: [] as Record<string, any>[],
  };
  let runSeq = 1;
  let rawSeq = 1;
  let externalSeq = 1;

  const query = async (text: string, params: unknown[] = []): Promise<Record<string, any>[]> => {
    if (text.includes("ingestion:createRun")) {
      const run = { id: runSeq++, source: params[0], status: "running" };
      state.runs.push(run);
      return [{ id: run.id }];
    }
    if (text.includes("ingestion:finishRun")) {
      const run = state.runs.find((r) => r.id === params[0]);
      if (run) {
        run.status = params[1];
        run.counts = {
          fetchedCount: params[2],
          acceptedCount: params[3],
          rejectedCount: params[4],
          insertedCount: params[5],
          updatedCount: params[6],
          duplicateCount: params[7],
          errorCount: params[8],
        };
        run.errorMessage = params[9];
      }
      return [];
    }
    if (text.includes("ingestion:insertRaw")) {
      const [source, sourceJobId, payload, ingestionRunId] = params as [string, string, string, number];
      const duplicate = state.raws.find(
        (r) => r.source === source && r.source_job_id === sourceJobId && r.ingestion_run_id === ingestionRunId,
      );
      if (duplicate) return [];
      const row = { id: rawSeq++, source, source_job_id: sourceJobId, raw_payload: payload, ingestion_run_id: ingestionRunId };
      state.raws.push(row);
      return [{ id: row.id }];
    }
    if (text.includes("ingestion:findRaw")) {
      const row = state.raws.find(
        (r) => r.source === params[0] && r.source_job_id === params[1] && r.ingestion_run_id === params[2],
      );
      return row ? [{ id: row.id }] : [];
    }
    if (text.includes("ingestion:findBySourceIds")) {
      const [source, ids] = params as [string, string[]];
      return state.external.filter(
        (r) => r.source === source && (ids as string[]).includes(r.source_job_id.toLowerCase()),
      );
    }
    if (text.includes("ingestion:findByUrls")) {
      const [urls] = params as [string[]];
      return state.external.filter((r) => urls.includes(r.canonical_url.toLowerCase()));
    }
    if (text.includes("ingestion:findByFingerprints")) {
      const [fps] = params as [string[]];
      return state.external.filter((r) => fps.includes(r.content_fingerprint));
    }
    if (text.includes("ingestion:insertExternal")) {
      const [
        source, sourceJobId, canonicalUrl, applyUrl, companyName, title,
        description, location, jobType, workLocation, role,
        salaryMin, salaryMax, salaryCurrency, postedAt,
        fingerprint, rawJobId,
      ] = params as any[];
      if (options.failInsertForSourceJobId === sourceJobId) {
        throw new Error("simulated database conflict");
      }
      const now = new Date().toISOString();
      const row: FakeExternalRow = {
        id: externalSeq++,
        source, source_job_id: sourceJobId, canonical_url: canonicalUrl,
        apply_url: applyUrl, company_name: companyName, title,
        description, location, job_type: jobType, work_location: workLocation,
        role, salary_min: salaryMin, salary_max: salaryMax,
        salary_currency: salaryCurrency, posted_at: postedAt,
        first_seen_at: now, last_seen_at: now, is_active: true,
        content_fingerprint: fingerprint, raw_job_id: rawJobId,
      };
      state.external.push(row);
      return [{ id: row.id }];
    }
    if (text.includes("ingestion:updateExternalSeen")) {
      const [id, canonicalUrl, applyUrl, companyName, title, description,
        location, jobType, workLocation, role, salaryMin, salaryMax,
        salaryCurrency, postedAt, fingerprint, rawJobId] = params as any[];
      const row = state.external.find((r) => r.id === id);
      if (!row) throw new Error(`row ${id} not found`);
      Object.assign(row, {
        canonical_url: canonicalUrl, apply_url: applyUrl, company_name: companyName,
        title, description, location, job_type: jobType, work_location: workLocation,
        role, salary_min: salaryMin, salary_max: salaryMax,
        salary_currency: salaryCurrency, posted_at: postedAt,
        content_fingerprint: fingerprint,
        raw_job_id: rawJobId ?? row.raw_job_id,
        last_seen_at: new Date().toISOString(), is_active: true,
      });
      return [];
    }
    throw new Error(`FakeDb: unhandled query: ${text.slice(0, 80)}`);
  };

  return { query, ...state };
}

describe("runIngestion with fixture source", () => {
  it("inserts on first run with correct counts", async () => {
    const db = createFakeDb();
    const summary = await runIngestion({
      source: "fixture",
      adapter: new FixtureJobSource(),
      db,
    });

    expect(summary.status).toBe("completed");
    expect(summary.fetchedCount).toBe(16);
    expect(summary.acceptedCount).toBe(13);
    expect(summary.rejectedCount).toBe(3);
    expect(summary.duplicateCount).toBe(3);
    expect(summary.insertedCount).toBe(10);
    expect(summary.updatedCount).toBe(0);
    expect(summary.errorCount).toBe(0);
    expect(db.external).toHaveLength(10);
    // Rejection reasons are structured.
    const reasons = summary.rejections.flatMap((r) => r.reasons);
    expect(reasons).toEqual(
      expect.arrayContaining(["missing_title", "missing_description", "missing_source_job_id"]),
    );
    // Run row recorded.
    expect(db.runs).toHaveLength(1);
    expect(db.runs[0].status).toBe("completed");
  });

  it("is idempotent: second run updates instead of inserting", async () => {
    const db = createFakeDb();
    const adapter = new FixtureJobSource();
    await runIngestion({ source: "fixture", adapter, db });

    // Age every row so last_seen_at movement is observable.
    for (const row of db.external) {
      row.first_seen_at = "2026-01-01T00:00:00.000Z";
      row.last_seen_at = "2026-01-01T00:00:00.000Z";
    }

    const second = await runIngestion({ source: "fixture", adapter, db });
    expect(second.status).toBe("completed");
    expect(second.insertedCount).toBe(0);
    expect(second.updatedCount).toBe(10);
    expect(second.duplicateCount).toBe(3);
    expect(db.external).toHaveLength(10);
    for (const row of db.external) {
      expect(row.first_seen_at).toBe("2026-01-01T00:00:00.000Z");
      expect(new Date(row.last_seen_at).getTime()).toBeGreaterThan(
        new Date("2026-01-01T00:00:00.000Z").getTime(),
      );
    }
  });

  it("isolates persistence errors and marks the run partial", async () => {
    const db = createFakeDb({ failInsertForSourceJobId: "fx-002" });
    const summary = await runIngestion({
      source: "fixture",
      adapter: new FixtureJobSource(),
      db,
    });

    expect(summary.errorCount).toBe(1);
    expect(summary.status).toBe("partial");
    expect(summary.insertedCount).toBe(9);
    expect(summary.errorMessage).toMatch(/fx-002/);
    // The run continued past the failing record.
    expect(summary.fetchedCount).toBe(16);
  });

  it("records a failed run when fetching throws", async () => {
    const db = createFakeDb();
    const brokenAdapter: JobSourceAdapter = {
      source: "fixture",
      fetchJobs: async () => {
        throw new Error("network down");
      },
    };
    const summary = await runIngestion({ source: "fixture", adapter: brokenAdapter, db });
    expect(summary.status).toBe("failed");
    expect(summary.fetchedCount).toBe(0);
    expect(summary.errorMessage).toMatch(/fetch_failed/);
    expect(db.runs[0].status).toBe("failed");
  });

  it("surfaces adapter-reported partial fetch errors (getLastFetchErrors) without discarding fetched jobs", async () => {
    const db = createFakeDb();
    const good: RawExternalJob = {
      source: "fixture",
      sourceJobId: "multi-1",
      sourceUrl: "https://example.com/jobs/multi-1",
      companyName: "Acme",
      title: "Engineer",
      description: "Fine job.",
      rawPayload: {},
    };
    const adapter: JobSourceAdapter = {
      source: "fixture",
      fetchJobs: async () => [good],
      getLastFetchErrors: () => ["company_b_fetch_failed: HTTP 500"],
    };
    const summary = await runIngestion({ source: "fixture", adapter, db });

    expect(summary.fetchedCount).toBe(1);
    expect(summary.insertedCount).toBe(1);
    expect(summary.errorCount).toBe(1);
    expect(summary.status).toBe("partial");
    expect(summary.errorMessage).toMatch(/company_b_fetch_failed/);
  });

  it("a failing record does not poison other records", async () => {
    const db = createFakeDb();
    const adapter: JobSourceAdapter = {
      source: "fixture",
      fetchJobs: async () => {
        const good: RawExternalJob = {
          source: "fixture",
          sourceJobId: "good-1",
          sourceUrl: "https://example.com/jobs/good-1",
          companyName: "Acme",
          title: "Engineer",
          description: "Fine job.",
          rawPayload: {},
        };
        const bad = "not-an-object" as unknown as RawExternalJob;
        const good2: RawExternalJob = {
          ...good,
          sourceJobId: "good-2",
          sourceUrl: "https://example.com/jobs/good-2",
          title: "Designer",
          description: "A different role.",
        };
        return [good, bad, good2];
      },
    };
    const summary = await runIngestion({ source: "fixture", adapter, db });
    expect(summary.fetchedCount).toBe(3);
    expect(summary.insertedCount + summary.updatedCount).toBe(2);
    expect(summary.status).not.toBe("failed");
  });
});
