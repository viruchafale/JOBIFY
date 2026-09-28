/**
 * Phase 6 — executeSourceIngestion tests: the orchestration of
 * lock -> runIngestion() -> health -> stale detection -> unlock, including
 * retries. Uses an in-memory fake DB covering both the Phase 3 pipeline's
 * query markers (see runner.test.ts) and the Phase 6 lock/health/stale
 * markers, plus fake adapters standing in for Lever/Greenhouse/Ashby.
 */

import { describe, it, expect } from "vitest";
import type { JobSourceAdapter } from "../adapter.js";
import type { SqlClient } from "../repository.js";
import type { RawExternalJob } from "../types.js";
import { executeSourceIngestion } from "./executeSourceIngestion.js";

// ---------------------------------------------------------------------------
// Fake DB: Phase 3 pipeline markers (adapted from runner.test.ts) + Phase 6
// lock/health/stale markers, all against the same in-memory state.
// ---------------------------------------------------------------------------
function createFakeDb() {
  const state = {
    runs: [] as Record<string, any>[],
    external: [] as Record<string, any>[],
    raws: [] as Record<string, any>[],
    locks: new Map<string, { owner_id: string; locked_until: Date }>(),
    health: new Map<string, Record<string, any>>(),
  };
  let runSeq = 1;
  let rawSeq = 1;
  let externalSeq = 1;

  const query = async (text: string, params: unknown[] = []): Promise<Record<string, any>[]> => {
    if (text.includes("scheduler:acquireLock")) {
      const [source, ownerId, ttlSeconds] = params as [string, string, string];
      const now = new Date();
      const existing = state.locks.get(source);
      if (!existing || existing.locked_until.getTime() < now.getTime()) {
        state.locks.set(source, { owner_id: ownerId, locked_until: new Date(now.getTime() + Number(ttlSeconds) * 1000) });
        return [{ owner_id: ownerId }];
      }
      return [];
    }
    if (text.includes("scheduler:releaseLock")) {
      const [source, ownerId] = params as [string, string];
      const existing = state.locks.get(source);
      if (existing && existing.owner_id === ownerId) state.locks.delete(source);
      return [];
    }
    if (text.includes("scheduler:upsertHealth")) {
      const [source, status, durationMs, errorMessage] = params as [string, string, number, string | null];
      const now = new Date().toISOString();
      const existing = state.health.get(source);
      if (!existing) {
        state.health.set(source, {
          source,
          last_status: status,
          consecutive_failures: status === "failed" ? 1 : 0,
          total_runs: 1,
          total_successes: status === "completed" ? 1 : 0,
          total_failures: status === "failed" ? 1 : 0,
          last_duration_ms: durationMs,
          last_error: errorMessage,
          updated_at: now,
        });
      } else {
        existing.last_status = status;
        existing.consecutive_failures =
          status === "completed" ? 0 : status === "failed" ? existing.consecutive_failures + 1 : existing.consecutive_failures;
        existing.total_runs += 1;
        if (status === "completed") existing.total_successes += 1;
        if (status === "failed") existing.total_failures += 1;
        existing.last_duration_ms = durationMs;
        existing.last_error = errorMessage;
      }
      return [];
    }
    if (text.includes("scheduler:deactivateStale")) {
      return []; // not the focus of these tests; covered in staleJobs.test.ts
    }
    if (text.includes("ingestion:createRun")) {
      const run = { id: runSeq++, source: params[0], status: "running" };
      state.runs.push(run);
      return [{ id: run.id }];
    }
    if (text.includes("ingestion:finishRun")) {
      const run = state.runs.find((r) => r.id === params[0]);
      if (run) run.status = params[1];
      return [];
    }
    if (text.includes("ingestion:insertRaw")) {
      const [source, sourceJobId, payload, ingestionRunId] = params as [string, string, string, number];
      const row = { id: rawSeq++, source, source_job_id: sourceJobId, raw_payload: payload, ingestion_run_id: ingestionRunId };
      state.raws.push(row);
      return [{ id: row.id }];
    }
    if (text.includes("ingestion:findRaw")) return [];
    if (text.includes("ingestion:findBySourceIds") || text.includes("ingestion:findByUrls") || text.includes("ingestion:findByFingerprints")) {
      return [];
    }
    if (text.includes("ingestion:insertExternal")) {
      const row = { id: externalSeq++, source_job_id: params[1] };
      state.external.push(row);
      return [{ id: row.id }];
    }
    if (text.includes("ingestion:updateExternalSeen")) return [];
    throw new Error(`FakeDb: unhandled query: ${text.slice(0, 80)}`);
  };

  return { query, ...state } as unknown as SqlClient & typeof state;
}

function job(id: string): RawExternalJob {
  return {
    source: "lever",
    sourceJobId: id,
    sourceUrl: `https://example.com/jobs/${id}`,
    companyName: "Acme",
    title: "Engineer",
    description: "A real job.",
    rawPayload: {},
  };
}

class SucceedingAdapter implements JobSourceAdapter {
  readonly source = "lever";
  async fetchJobs(): Promise<RawExternalJob[]> {
    return [job("j-1")];
  }
}

class AlwaysFailingAdapter implements JobSourceAdapter {
  readonly source = "lever";
  constructor(private readonly message: string) {}
  async fetchJobs(): Promise<RawExternalJob[]> {
    throw new Error(this.message);
  }
}

class FlakyThenSucceedsAdapter implements JobSourceAdapter {
  readonly source = "lever";
  private calls = 0;
  constructor(
    private readonly failTimes: number,
    private readonly message: string,
  ) {}
  async fetchJobs(): Promise<RawExternalJob[]> {
    this.calls += 1;
    if (this.calls <= this.failTimes) throw new Error(this.message);
    return [job("j-1")];
  }
}

class PartialAdapter implements JobSourceAdapter {
  readonly source = "lever";
  async fetchJobs(): Promise<RawExternalJob[]> {
    return [job("j-1")];
  }
  getLastFetchErrors(): string[] {
    return ["lever_company_fetch_failed[company=b]: Lever API server error (HTTP 500)"];
  }
}

const noSleep = async () => {}; // instant, deterministic tests

describe("executeSourceIngestion", () => {
  it("succeeds on the first attempt: acquires lock, runs once, updates health, releases lock", async () => {
    const db = createFakeDb();
    const result = await executeSourceIngestion({
      source: "lever",
      db,
      ownerId: "owner-a",
      trigger: "scheduled",
      lockTtlSeconds: 1800,
      retryMaxAttempts: 3,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 100,
      staleAfterRuns: 3,
      sleep: noSleep,
      createAdapter: () => new SucceedingAdapter(),
    });

    expect(result.locked).toBe(true);
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0].status).toBe("completed");
    expect(db.locks.has("lever")).toBe(false); // released
    expect(db.health.get("lever")?.last_status).toBe("completed");
  });

  it("skips when the lock is already held by another owner", async () => {
    const db = createFakeDb();
    db.locks.set("lever", { owner_id: "someone-else", locked_until: new Date(Date.now() + 60_000) });

    const result = await executeSourceIngestion({
      source: "lever",
      db,
      ownerId: "owner-a",
      trigger: "scheduled",
      lockTtlSeconds: 1800,
      retryMaxAttempts: 3,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 100,
      staleAfterRuns: 3,
      sleep: noSleep,
      createAdapter: () => new SucceedingAdapter(),
    });

    expect(result.locked).toBe(false);
    expect(result.summaries).toEqual([]);
    expect(db.runs).toHaveLength(0); // no ingestion attempted
  });

  it("retries a retryable failure and succeeds, recording each attempt", async () => {
    const db = createFakeDb();
    // A single shared instance: retries must reuse it (a real registry
    // would create a fresh adapter per attempt too, but that adapter's own
    // fetch behavior — success/failure — is what must vary across calls
    // here, which requires one instance carrying its own call count).
    const adapter = new FlakyThenSucceedsAdapter(2, "HTTP 503 Service Unavailable");
    const result = await executeSourceIngestion({
      source: "lever",
      db,
      ownerId: "owner-a",
      trigger: "scheduled",
      lockTtlSeconds: 1800,
      retryMaxAttempts: 3,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 100,
      staleAfterRuns: 3,
      sleep: noSleep,
      createAdapter: () => adapter,
    });

    expect(result.summaries).toHaveLength(3);
    expect(result.summaries[0].status).toBe("failed");
    expect(result.summaries[0].attempt).toBe(1);
    expect(result.summaries[0].triggerType).toBe("scheduled");
    expect(result.summaries[1].status).toBe("failed");
    expect(result.summaries[1].attempt).toBe(2);
    expect(result.summaries[1].triggerType).toBe("retry");
    expect(result.summaries[2].status).toBe("completed");
    expect(result.summaries[2].attempt).toBe(3);
    expect(result.summaries[2].triggerType).toBe("retry");
    expect(db.locks.has("lever")).toBe(false);
  });

  it("does not retry a permanent (configuration) failure", async () => {
    const db = createFakeDb();
    const result = await executeSourceIngestion({
      source: "lever",
      db,
      ownerId: "owner-a",
      trigger: "scheduled",
      lockTtlSeconds: 1800,
      retryMaxAttempts: 5,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 100,
      staleAfterRuns: 3,
      sleep: noSleep,
      createAdapter: () => new AlwaysFailingAdapter("LeverAdapter: no companies configured. Set LEVER_COMPANIES..."),
    });

    expect(result.summaries).toHaveLength(1); // no retry attempted
    expect(result.summaries[0].status).toBe("failed");
    expect(db.health.get("lever")?.consecutive_failures).toBe(1);
  });

  it("stops after retryMaxAttempts even if the failure is retryable", async () => {
    const db = createFakeDb();
    const result = await executeSourceIngestion({
      source: "lever",
      db,
      ownerId: "owner-a",
      trigger: "scheduled",
      lockTtlSeconds: 1800,
      retryMaxAttempts: 3,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 100,
      staleAfterRuns: 3,
      sleep: noSleep,
      createAdapter: () => new AlwaysFailingAdapter("HTTP 503 Service Unavailable"),
    });

    expect(result.summaries).toHaveLength(3);
    expect(result.summaries.every((s) => s.status === "failed")).toBe(true);
  });

  it("does not retry a partial run (some companies succeeded)", async () => {
    const db = createFakeDb();
    const result = await executeSourceIngestion({
      source: "lever",
      db,
      ownerId: "owner-a",
      trigger: "scheduled",
      lockTtlSeconds: 1800,
      retryMaxAttempts: 3,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 100,
      staleAfterRuns: 3,
      sleep: noSleep,
      createAdapter: () => new PartialAdapter(),
    });

    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0].status).toBe("partial");
    expect(db.health.get("lever")?.last_status).toBe("partial");
  });

  it("always releases the lock, even when every attempt fails", async () => {
    const db = createFakeDb();
    await executeSourceIngestion({
      source: "lever",
      db,
      ownerId: "owner-a",
      trigger: "scheduled",
      lockTtlSeconds: 1800,
      retryMaxAttempts: 2,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 100,
      staleAfterRuns: 3,
      sleep: noSleep,
      createAdapter: () => new AlwaysFailingAdapter("HTTP 500"),
    });
    expect(db.locks.has("lever")).toBe(false);
  });
});
