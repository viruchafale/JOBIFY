/**
 * Phase 6 — Source health tests, against an in-memory fake DB replicating
 * the upsert's CASE-based semantics exactly (completed resets consecutive
 * failures, partial leaves them untouched, failed increments them).
 */

import { describe, it, expect } from "vitest";
import type { SqlClient } from "../repository.js";
import { upsertSourceHealthAfterRun, listSourceHealth, deriveHealthLabel } from "./health.js";

interface FakeHealthRow {
  source: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_status: string | null;
  consecutive_failures: number;
  total_runs: number;
  total_successes: number;
  total_failures: number;
  last_duration_ms: number | null;
  last_error: string | null;
  updated_at: string;
}

function createFakeHealthDb(): SqlClient & { rows: Map<string, FakeHealthRow> } {
  const rows = new Map<string, FakeHealthRow>();
  const query = async (text: string, params: unknown[] = []): Promise<Record<string, any>[]> => {
    if (text.includes("scheduler:upsertHealth")) {
      const [source, status, durationMs, errorMessage] = params as [string, string, number, string | null];
      const now = new Date().toISOString();
      const existing = rows.get(source);
      if (!existing) {
        rows.set(source, {
          source,
          last_run_at: now,
          last_success_at: status === "completed" ? now : null,
          last_failure_at: status === "failed" ? now : null,
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
        existing.last_run_at = now;
        if (status === "completed") existing.last_success_at = now;
        if (status === "failed") existing.last_failure_at = now;
        existing.last_status = status;
        existing.consecutive_failures =
          status === "completed" ? 0 : status === "failed" ? existing.consecutive_failures + 1 : existing.consecutive_failures;
        existing.total_runs += 1;
        if (status === "completed") existing.total_successes += 1;
        if (status === "failed") existing.total_failures += 1;
        existing.last_duration_ms = durationMs;
        existing.last_error = errorMessage;
        existing.updated_at = now;
      }
      return [];
    }
    if (text.includes("scheduler:listHealth")) {
      return [...rows.values()].sort((a, b) => a.source.localeCompare(b.source));
    }
    throw new Error(`FakeHealthDb: unhandled query: ${text.slice(0, 60)}`);
  };
  return { query, rows };
}

describe("upsertSourceHealthAfterRun", () => {
  it("creates a row on the first run (completed)", async () => {
    const db = createFakeHealthDb();
    await upsertSourceHealthAfterRun(db, "lever", "completed", 500, null);
    const row = db.rows.get("lever")!;
    expect(row.last_status).toBe("completed");
    expect(row.consecutive_failures).toBe(0);
    expect(row.total_runs).toBe(1);
    expect(row.total_successes).toBe(1);
    expect(row.last_success_at).not.toBeNull();
  });

  it("increments consecutive_failures and total_failures on failure", async () => {
    const db = createFakeHealthDb();
    await upsertSourceHealthAfterRun(db, "lever", "failed", 100, "HTTP 500");
    await upsertSourceHealthAfterRun(db, "lever", "failed", 100, "HTTP 500");
    const row = db.rows.get("lever")!;
    expect(row.consecutive_failures).toBe(2);
    expect(row.total_failures).toBe(2);
    expect(row.last_error).toBe("HTTP 500");
  });

  it("resets consecutive_failures to 0 after a completed run", async () => {
    const db = createFakeHealthDb();
    await upsertSourceHealthAfterRun(db, "lever", "failed", 100, "HTTP 500");
    await upsertSourceHealthAfterRun(db, "lever", "failed", 100, "HTTP 500");
    await upsertSourceHealthAfterRun(db, "lever", "completed", 200, null);
    const row = db.rows.get("lever")!;
    expect(row.consecutive_failures).toBe(0);
    expect(row.last_status).toBe("completed");
  });

  it("does not reset or increment consecutive_failures on a partial run", async () => {
    const db = createFakeHealthDb();
    await upsertSourceHealthAfterRun(db, "lever", "failed", 100, "HTTP 500");
    await upsertSourceHealthAfterRun(db, "lever", "partial", 300, "one company failed");
    const row = db.rows.get("lever")!;
    expect(row.consecutive_failures).toBe(1); // untouched, not reset to 0, not incremented
    expect(row.last_status).toBe("partial");
    expect(row.total_runs).toBe(2);
    expect(row.total_successes).toBe(0);
    expect(row.total_failures).toBe(1); // partial does not count as a failure
  });

  it("stores last_duration_ms and last_error from the most recent run", async () => {
    const db = createFakeHealthDb();
    await upsertSourceHealthAfterRun(db, "lever", "failed", 123, "boom");
    const row = db.rows.get("lever")!;
    expect(row.last_duration_ms).toBe(123);
    expect(row.last_error).toBe("boom");
  });
});

describe("deriveHealthLabel", () => {
  it("is healthy after a completed run", () => {
    expect(deriveHealthLabel({ last_status: "completed", consecutive_failures: 0 })).toBe("healthy");
  });

  it("is degraded after a partial run", () => {
    expect(deriveHealthLabel({ last_status: "partial", consecutive_failures: 0 })).toBe("degraded");
  });

  it("is degraded (not yet unhealthy) below the consecutive-failure threshold", () => {
    expect(deriveHealthLabel({ last_status: "failed", consecutive_failures: 1 })).toBe("degraded");
  });

  it("is unhealthy at/above the consecutive-failure threshold", () => {
    expect(deriveHealthLabel({ last_status: "failed", consecutive_failures: 3 })).toBe("unhealthy");
  });

  it("is unknown when there is no history", () => {
    expect(deriveHealthLabel(null)).toBe("unknown");
  });
});

describe("listSourceHealth", () => {
  it("returns rows sorted by source", async () => {
    const db = createFakeHealthDb();
    await upsertSourceHealthAfterRun(db, "lever", "completed", 100, null);
    await upsertSourceHealthAfterRun(db, "ashby", "completed", 100, null);
    const rows = await listSourceHealth(db);
    expect(rows.map((r) => r.source)).toEqual(["ashby", "lever"]);
  });
});
