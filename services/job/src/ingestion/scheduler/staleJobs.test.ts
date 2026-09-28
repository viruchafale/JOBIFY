/**
 * Phase 6 — Stale-job detection tests, against an in-memory fake DB that
 * replicates the correlated-subquery semantics exactly: a job is only
 * deactivated once the number of *completed* ingestion_runs for its source
 * started after the job's last_seen_at reaches the threshold. Failed/
 * partial runs never count toward that threshold.
 */

import { describe, it, expect } from "vitest";
import type { SqlClient } from "../repository.js";
import { deactivateStaleJobs } from "./staleJobs.js";

interface FakeJobRow {
  id: number;
  source: string;
  is_active: boolean;
  last_seen_at: string;
}

interface FakeRunRow {
  source: string;
  status: string;
  started_at: string;
}

function createFakeDb(): SqlClient & { jobs: FakeJobRow[]; runs: FakeRunRow[] } {
  const jobs: FakeJobRow[] = [];
  const runs: FakeRunRow[] = [];
  const query = async (text: string, params: unknown[] = []): Promise<Record<string, any>[]> => {
    if (text.includes("scheduler:deactivateStale")) {
      const [source, staleAfterRuns] = params as [string, number];
      const affected: FakeJobRow[] = [];
      for (const job of jobs) {
        if (job.source !== source || !job.is_active) continue;
        const qualifyingRuns = runs.filter(
          (r) => r.source === source && r.status === "completed" && r.started_at > job.last_seen_at,
        ).length;
        if (qualifyingRuns >= staleAfterRuns) {
          job.is_active = false;
          affected.push(job);
        }
      }
      return affected.map((j) => ({ id: j.id }));
    }
    throw new Error(`FakeDb: unhandled query: ${text.slice(0, 60)}`);
  };
  return { query, jobs, runs };
}

describe("deactivateStaleJobs", () => {
  it("leaves a job active before the threshold is reached", async () => {
    const db = createFakeDb();
    db.jobs.push({ id: 1, source: "lever", is_active: true, last_seen_at: "2026-01-01T00:00:00Z" });
    db.runs.push({ source: "lever", status: "completed", started_at: "2026-01-02T00:00:00Z" });
    db.runs.push({ source: "lever", status: "completed", started_at: "2026-01-03T00:00:00Z" });

    const count = await deactivateStaleJobs(db, "lever", 3);
    expect(count).toBe(0);
    expect(db.jobs[0].is_active).toBe(true);
  });

  it("deactivates a job once it has missed the configured number of completed runs", async () => {
    const db = createFakeDb();
    db.jobs.push({ id: 1, source: "lever", is_active: true, last_seen_at: "2026-01-01T00:00:00Z" });
    for (let i = 2; i <= 4; i += 1) {
      db.runs.push({ source: "lever", status: "completed", started_at: `2026-01-0${i}T00:00:00Z` });
    }

    const count = await deactivateStaleJobs(db, "lever", 3);
    expect(count).toBe(1);
    expect(db.jobs[0].is_active).toBe(false);
  });

  it("does not count failed runs toward the threshold", async () => {
    const db = createFakeDb();
    db.jobs.push({ id: 1, source: "lever", is_active: true, last_seen_at: "2026-01-01T00:00:00Z" });
    db.runs.push({ source: "lever", status: "completed", started_at: "2026-01-02T00:00:00Z" });
    db.runs.push({ source: "lever", status: "failed", started_at: "2026-01-03T00:00:00Z" });
    db.runs.push({ source: "lever", status: "failed", started_at: "2026-01-04T00:00:00Z" });

    const count = await deactivateStaleJobs(db, "lever", 3);
    expect(count).toBe(0); // only 1 completed run counts, threshold is 3
    expect(db.jobs[0].is_active).toBe(true);
  });

  it("does not count partial runs toward the threshold", async () => {
    const db = createFakeDb();
    db.jobs.push({ id: 1, source: "lever", is_active: true, last_seen_at: "2026-01-01T00:00:00Z" });
    db.runs.push({ source: "lever", status: "completed", started_at: "2026-01-02T00:00:00Z" });
    db.runs.push({ source: "lever", status: "partial", started_at: "2026-01-03T00:00:00Z" });
    db.runs.push({ source: "lever", status: "partial", started_at: "2026-01-04T00:00:00Z" });

    const count = await deactivateStaleJobs(db, "lever", 3);
    expect(count).toBe(0);
    expect(db.jobs[0].is_active).toBe(true);
  });

  it("a job re-observed after last_seen_at refresh is protected again", async () => {
    const db = createFakeDb();
    // Job A: not seen since day 1 -> 3 completed runs since -> stale.
    // Job B: refreshed on day 3 (still "seen") -> only 1 completed run since -> stays active.
    db.jobs.push({ id: 1, source: "lever", is_active: true, last_seen_at: "2026-01-01T00:00:00Z" });
    db.jobs.push({ id: 2, source: "lever", is_active: true, last_seen_at: "2026-01-03T00:00:00Z" });
    db.runs.push({ source: "lever", status: "completed", started_at: "2026-01-02T00:00:00Z" });
    db.runs.push({ source: "lever", status: "completed", started_at: "2026-01-03T12:00:00Z" });
    db.runs.push({ source: "lever", status: "completed", started_at: "2026-01-04T00:00:00Z" });

    const count = await deactivateStaleJobs(db, "lever", 3);
    expect(count).toBe(1);
    expect(db.jobs.find((j) => j.id === 1)?.is_active).toBe(false);
    expect(db.jobs.find((j) => j.id === 2)?.is_active).toBe(true);
  });

  it("only affects the given source", async () => {
    const db = createFakeDb();
    db.jobs.push({ id: 1, source: "lever", is_active: true, last_seen_at: "2026-01-01T00:00:00Z" });
    db.jobs.push({ id: 2, source: "greenhouse", is_active: true, last_seen_at: "2026-01-01T00:00:00Z" });
    for (let i = 2; i <= 4; i += 1) {
      db.runs.push({ source: "lever", status: "completed", started_at: `2026-01-0${i}T00:00:00Z` });
    }

    await deactivateStaleJobs(db, "lever", 3);
    expect(db.jobs.find((j) => j.id === 1)?.is_active).toBe(false);
    expect(db.jobs.find((j) => j.id === 2)?.is_active).toBe(true); // untouched, different source
  });

  it("never reactivates or deletes rows — is_active is the only mutation", async () => {
    const db = createFakeDb();
    db.jobs.push({ id: 1, source: "lever", is_active: true, last_seen_at: "2026-01-01T00:00:00Z" });
    for (let i = 2; i <= 4; i += 1) {
      db.runs.push({ source: "lever", status: "completed", started_at: `2026-01-0${i}T00:00:00Z` });
    }
    await deactivateStaleJobs(db, "lever", 3);
    expect(db.jobs).toHaveLength(1); // row preserved, not deleted
    expect(db.jobs[0].id).toBe(1);
  });

  it("rejects an invalid staleAfterRuns value", async () => {
    const db = createFakeDb();
    await expect(deactivateStaleJobs(db, "lever", 0)).rejects.toThrow(/invalid staleAfterRuns/);
  });
});
