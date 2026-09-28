/**
 * Phase 8 — Batch processing tests: keyset pagination, bounded
 * concurrency, and failure isolation (one bad job never stops the batch).
 */

import { describe, it, expect } from "vitest";
import type { SqlClient } from "../ingestion/repository.js";
import { runIntelligenceBatch } from "./batch.js";
import { EXTRACTOR_VERSION } from "./constants.js";
import type { IntelligenceConfig } from "./config.js";

const config: IntelligenceConfig = {
  aiEnabled: false,
  geminiApiKey: null,
  geminiModel: "gemini-3-flash-preview",
  maxDescriptionLength: 20000,
  batchSize: 2,
  maxConcurrency: 2,
  aiTimeoutMs: 5000,
  workerIntervalMs: 60000,
};

interface FakeJob {
  id: number;
  source: string;
  title: string | null;
  description: string | null;
  content_fingerprint: string;
  job_type: string | null;
  work_location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  raw_payload: unknown;
  malformed?: boolean; // simulates a job that crashes deterministic extraction
}

function makeJob(id: number, overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    id,
    source: "greenhouse",
    title: "Backend Engineer",
    description: "We use Go and PostgreSQL. 3+ years of experience.",
    content_fingerprint: `fp-${id}`,
    job_type: "Full-time",
    work_location: "Remote",
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    raw_payload: {},
    ...overrides,
  };
}

function createFakeDb(jobs: FakeJob[]) {
  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  const intelligence = new Map<string, Record<string, any>>();
  let nextId = 1;
  const key = (id: number, v: string) => `${id}:${v}`;

  const query = async (text: string, params: unknown[] = []): Promise<Record<string, any>[]> => {
    if (text.includes("intelligence:listPendingJobIds")) {
      const [afterId, limit, extractorVersion] = params as [number, number, string];
      const onlyPending = text.includes("ji.status != 'completed'");
      const ids = jobs
        .map((j) => j.id)
        .filter((id) => id > afterId)
        .filter((id) => {
          if (!onlyPending) return true;
          const row = intelligence.get(key(id, extractorVersion));
          const job = jobsById.get(id)!;
          return !row || row.status !== "completed" || row.content_fingerprint !== job.content_fingerprint;
        })
        .sort((a, b) => a - b)
        .slice(0, limit);
      return ids.map((id) => ({ id }));
    }
    if (text.includes("intelligence:loadTaxonomy")) return [];
    if (text.includes("intelligence:loadJob")) {
      const job = jobsById.get(params[0] as number);
      if (!job) return [];
      if (job.malformed) throw new Error("simulated malformed job data");
      return [job];
    }
    if (text.includes("intelligence:findExisting")) {
      const row = intelligence.get(key(params[0] as number, params[1] as string));
      return row ? [{ id: row.id, content_fingerprint: row.content_fingerprint, status: row.status }] : [];
    }
    if (text.includes("intelligence:beginProcessing")) {
      const [externalJobId, extractorVersion, contentFingerprint] = params as [number, string, string];
      const k = key(externalJobId, extractorVersion);
      let row = intelligence.get(k);
      if (!row) {
        row = { id: nextId++, status: "processing", content_fingerprint: contentFingerprint, attempt_count: 1 };
        intelligence.set(k, row);
      } else {
        row.status = "processing";
        row.attempt_count += 1;
      }
      return [{ id: row.id }];
    }
    if (text.includes("intelligence:complete")) {
      const id = params[0];
      const row = [...intelligence.values()].find((r) => r.id === id);
      if (row) Object.assign(row, { status: params[15] });
      return [];
    }
    if (text.includes("intelligence:markFailed")) {
      const [id, status, error] = params as [number, string, string];
      const row = [...intelligence.values()].find((r) => r.id === id);
      if (row) Object.assign(row, { status, last_error: error });
      return [];
    }
    if (
      text.includes("intelligence:deleteSkills") ||
      text.includes("intelligence:insertSkill") ||
      text.includes("intelligence:deleteResp") ||
      text.includes("intelligence:insertResp") ||
      text.includes("intelligence:deleteReq") ||
      text.includes("intelligence:insertReq")
    ) {
      return [];
    }
    throw new Error(`FakeDb: unhandled query: ${text.slice(0, 80)}`);
  };

  return { query, intelligence } as unknown as SqlClient & { intelligence: Map<string, Record<string, any>> };
}

describe("runIntelligenceBatch", () => {
  it("processes every job across multiple pages (keyset pagination)", async () => {
    const jobs = Array.from({ length: 5 }, (_, i) => makeJob(i + 1));
    const db = createFakeDb(jobs);
    const result = await runIntelligenceBatch(db, { batchSize: 2, maxConcurrency: 2, config });
    expect(result.processed).toBe(5);
    expect(result.completed).toBe(5);
    expect(result.failed).toBe(0);
  });

  it("isolates a failing job: the batch continues and other jobs still complete", async () => {
    const jobs = [
      makeJob(1),
      makeJob(2, { malformed: true }),
      makeJob(3),
      makeJob(4),
    ];
    const db = createFakeDb(jobs);
    const result = await runIntelligenceBatch(db, { batchSize: 2, maxConcurrency: 2, config });

    expect(result.processed).toBe(4);
    expect(result.completed).toBe(3);
    expect(result.failed).toBe(1);

    expect(db.intelligence.get("1:" + EXTRACTOR_VERSION)?.status).toBe("completed");
    expect(db.intelligence.get("3:" + EXTRACTOR_VERSION)?.status).toBe("completed");
    expect(db.intelligence.get("4:" + EXTRACTOR_VERSION)?.status).toBe("completed");
  });

  it("does not reprocess an already-completed, unchanged job on a second batch run (pending-only query)", async () => {
    const jobs = [makeJob(1), makeJob(2)];
    const db = createFakeDb(jobs);
    const first = await runIntelligenceBatch(db, { batchSize: 2, maxConcurrency: 2, config });
    expect(first.completed).toBe(2);

    const second = await runIntelligenceBatch(db, { batchSize: 2, maxConcurrency: 2, config });
    // listPendingJobIds excludes already-completed unchanged jobs, so the
    // second run finds nothing to do at all.
    expect(second.processed).toBe(0);
  });

  it("an empty dataset yields a zeroed result without error", async () => {
    const db = createFakeDb([]);
    const result = await runIntelligenceBatch(db, { batchSize: 20, maxConcurrency: 2, config });
    expect(result).toEqual({ processed: 0, completed: 0, retryableFailed: 0, failed: 0, skipped: 0 });
  });

  it("respects maxConcurrency (never runs more than N jobs at once)", async () => {
    let concurrent = 0;
    let maxObserved = 0;
    const jobs = Array.from({ length: 6 }, (_, i) => makeJob(i + 1));
    const db = createFakeDb(jobs);
    const originalQuery = db.query;
    db.query = async (text: string, params: unknown[] = []) => {
      if (text.includes("intelligence:loadJob")) {
        concurrent += 1;
        maxObserved = Math.max(maxObserved, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const result = await originalQuery(text, params);
        concurrent -= 1;
        return result;
      }
      return originalQuery(text, params);
    };

    await runIntelligenceBatch(db, { batchSize: 6, maxConcurrency: 2, config });
    expect(maxObserved).toBeLessThanOrEqual(2);
  });
});
