/**
 * Phase 6 — Scheduler tests: due-selection (pure), concurrency limiting,
 * failure isolation, and graceful shutdown. Uses a fake DB (same query
 * markers as executeSourceIngestion.test.ts / runner.test.ts) and fake
 * adapters — no real network, no waiting on real cron intervals.
 */

import { describe, it, expect } from "vitest";
import type { JobSourceAdapter } from "../adapter.js";
import type { SqlClient } from "../repository.js";
import type { RawExternalJob } from "../types.js";
import { parseCronExpression } from "./cron.js";
import { isScheduleDue, Scheduler } from "./scheduler.js";
import type { ReliabilityConfig, ScheduleEntry } from "./config.js";

function entry(source: string, cronExpression: string): ScheduleEntry {
  return { source, cronExpression, schedule: parseCronExpression(cronExpression) };
}

function baseConfig(overrides: Partial<ReliabilityConfig> = {}): ReliabilityConfig {
  return {
    enabled: true,
    schedules: [],
    timezone: "UTC",
    maxConcurrency: 1,
    lockTtlSeconds: 1800,
    retryMaxAttempts: 3,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 5,
    staleAfterRuns: 3,
    shutdownTimeoutMs: 5000,
    ...overrides,
  };
}

function createFakeDb(): SqlClient {
  const locks = new Map<string, { owner_id: string; locked_until: Date }>();
  let runSeq = 1;
  const query = async (text: string, params: unknown[] = []): Promise<Record<string, any>[]> => {
    if (text.includes("scheduler:acquireLock")) {
      const [source, ownerId, ttlSeconds] = params as [string, string, string];
      const now = new Date();
      const existing = locks.get(source);
      if (!existing || existing.locked_until.getTime() < now.getTime()) {
        locks.set(source, { owner_id: ownerId, locked_until: new Date(now.getTime() + Number(ttlSeconds) * 1000) });
        return [{ owner_id: ownerId }];
      }
      return [];
    }
    if (text.includes("scheduler:releaseLock")) {
      const [source, ownerId] = params as [string, string];
      const existing = locks.get(source);
      if (existing && existing.owner_id === ownerId) locks.delete(source);
      return [];
    }
    if (text.includes("scheduler:upsertHealth")) return [];
    if (text.includes("scheduler:deactivateStale")) return [];
    if (text.includes("ingestion:createRun")) return [{ id: runSeq++ }];
    if (text.includes("ingestion:finishRun")) return [];
    if (text.includes("ingestion:insertRaw")) return [{ id: 1 }];
    if (
      text.includes("ingestion:findBySourceIds") ||
      text.includes("ingestion:findByUrls") ||
      text.includes("ingestion:findByFingerprints")
    ) {
      return [];
    }
    if (text.includes("ingestion:insertExternal")) return [{ id: 1 }];
    if (text.includes("ingestion:updateExternalSeen")) return [];
    throw new Error(`FakeDb: unhandled query: ${text.slice(0, 80)}`);
  };
  return { query };
}

function job(source: string, id: string): RawExternalJob {
  return {
    source,
    sourceJobId: id,
    sourceUrl: `https://example.com/${source}/${id}`,
    companyName: "Acme",
    title: "Engineer",
    description: "A real job.",
    rawPayload: {},
  };
}

describe("isScheduleDue", () => {
  it("is due when the cron matches and the minute wasn't already fired", () => {
    const e = entry("lever", "0 * * * *");
    const now = new Date("2026-09-24T14:00:00.000Z");
    const result = isScheduleDue(e, now, "UTC", undefined);
    expect(result.due).toBe(true);
  });

  it("is not due when the cron doesn't match", () => {
    const e = entry("lever", "0 * * * *");
    const now = new Date("2026-09-24T14:05:00.000Z");
    expect(isScheduleDue(e, now, "UTC", undefined).due).toBe(false);
  });

  it("is not due again within the same already-fired minute", () => {
    const e = entry("lever", "0 * * * *");
    const now = new Date("2026-09-24T14:00:30.000Z");
    const first = isScheduleDue(e, now, "UTC", undefined);
    expect(first.due).toBe(true);
    const second = isScheduleDue(e, now, "UTC", first.minuteKey);
    expect(second.due).toBe(false);
  });
});

describe("Scheduler concurrency + dispatch", () => {
  it("dispatches a due source on tick and it completes by the time stop() resolves", async () => {
    const db = createFakeDb();
    let ran = false;
    const config = baseConfig({ schedules: [entry("lever", "* * * * *")], shutdownTimeoutMs: 5000 });
    const scheduler = new Scheduler({
      db,
      config,
      now: () => new Date("2026-09-24T14:00:00.000Z"),
      createAdapter: (): JobSourceAdapter => ({
        source: "lever",
        fetchJobs: async () => {
          ran = true;
          return [job("lever", "j-1")];
        },
      }),
    });

    scheduler.tick();
    await scheduler.stop();
    expect(ran).toBe(true);
  });

  it("does not dispatch a source that isn't due", async () => {
    const db = createFakeDb();
    let ran = false;
    const config = baseConfig({ schedules: [entry("lever", "0 0 1 1 *")], shutdownTimeoutMs: 1000 }); // once a year
    const scheduler = new Scheduler({
      db,
      config,
      now: () => new Date("2026-09-24T14:00:00.000Z"),
      createAdapter: (): JobSourceAdapter => ({
        source: "lever",
        fetchJobs: async () => {
          ran = true;
          return [];
        },
      }),
    });

    scheduler.tick();
    await scheduler.stop();
    expect(ran).toBe(false);
  });

  it("respects INGESTION_MAX_CONCURRENCY=1: two due sources never run at the same time", async () => {
    const db = createFakeDb();
    let concurrent = 0;
    let maxObservedConcurrency = 0;
    const makeAdapter = (source: string): JobSourceAdapter => ({
      source,
      fetchJobs: async () => {
        concurrent += 1;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 20));
        concurrent -= 1;
        return [job(source, "j-1")];
      },
    });

    const config = baseConfig({
      maxConcurrency: 1,
      schedules: [entry("lever", "* * * * *"), entry("greenhouse", "* * * * *")],
      shutdownTimeoutMs: 5000,
    });
    const scheduler = new Scheduler({
      db,
      config,
      now: () => new Date("2026-09-24T14:00:00.000Z"),
      createAdapter: makeAdapter,
    });

    scheduler.tick();
    await scheduler.stop();
    expect(maxObservedConcurrency).toBe(1);
  });

  it("allows N concurrent sources when INGESTION_MAX_CONCURRENCY=N", async () => {
    const db = createFakeDb();
    let concurrent = 0;
    let maxObservedConcurrency = 0;
    const makeAdapter = (source: string): JobSourceAdapter => ({
      source,
      fetchJobs: async () => {
        concurrent += 1;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 20));
        concurrent -= 1;
        return [job(source, "j-1")];
      },
    });

    const config = baseConfig({
      maxConcurrency: 2,
      schedules: [entry("lever", "* * * * *"), entry("greenhouse", "* * * * *")],
      shutdownTimeoutMs: 5000,
    });
    const scheduler = new Scheduler({
      db,
      config,
      now: () => new Date("2026-09-24T14:00:00.000Z"),
      createAdapter: makeAdapter,
    });

    scheduler.tick();
    await scheduler.stop();
    expect(maxObservedConcurrency).toBe(2);
  });

  it("does not dispatch a source that's already in flight from this instance", () => {
    const db = createFakeDb();
    let callCount = 0;
    const config = baseConfig({ schedules: [entry("lever", "* * * * *")] });
    const scheduler = new Scheduler({
      db,
      config,
      now: () => new Date("2026-09-24T14:00:00.000Z"),
      createAdapter: (): JobSourceAdapter => ({
        source: "lever",
        fetchJobs: async () => {
          callCount += 1;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return [];
        },
      }),
    });

    scheduler.tick(); // dispatches lever
    scheduler.tick(); // same source still in flight -> must not dispatch again
    expect(callCount).toBeLessThanOrEqual(1);
  });
});

describe("Scheduler failure isolation", () => {
  it("one source failing (even by throwing synchronously) does not stop another from succeeding, and does not throw", async () => {
    const db = createFakeDb();
    let greenhouseRan = false;
    const config = baseConfig({
      schedules: [entry("lever", "* * * * *"), entry("greenhouse", "* * * * *")],
      shutdownTimeoutMs: 5000,
    });
    const scheduler = new Scheduler({
      db,
      config,
      now: () => new Date("2026-09-24T14:00:00.000Z"),
      createAdapter: (source: string): JobSourceAdapter => {
        if (source === "lever") {
          throw new Error("adapter construction failed"); // simulates a task-level throw, not a fetch failure
        }
        return {
          source,
          fetchJobs: async () => {
            greenhouseRan = true;
            return [job(source, "j-1")];
          },
        };
      },
    });

    expect(() => scheduler.tick()).not.toThrow();
    await scheduler.stop();
    expect(greenhouseRan).toBe(true);
  });
});

describe("Scheduler graceful shutdown", () => {
  it("stops scheduling new work after stop() resolves", async () => {
    const db = createFakeDb();
    let callCount = 0;
    const config = baseConfig({ schedules: [entry("lever", "* * * * *")], shutdownTimeoutMs: 1000 });
    const scheduler = new Scheduler({
      db,
      config,
      now: () => new Date("2026-09-24T14:00:00.000Z"),
      createAdapter: (): JobSourceAdapter => ({
        source: "lever",
        fetchJobs: async () => {
          callCount += 1;
          return [];
        },
      }),
    });

    await scheduler.stop(); // stop before ever starting/ticking
    scheduler.tick(); // must be a no-op post-stop
    expect(callCount).toBe(0);
  });

  it("waits for an in-flight ingestion to finish within the shutdown timeout", async () => {
    const db = createFakeDb();
    let finished = false;
    const config = baseConfig({ schedules: [entry("lever", "* * * * *")], shutdownTimeoutMs: 2000 });
    const scheduler = new Scheduler({
      db,
      config,
      now: () => new Date("2026-09-24T14:00:00.000Z"),
      createAdapter: (): JobSourceAdapter => ({
        source: "lever",
        fetchJobs: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          finished = true;
          return [];
        },
      }),
    });

    scheduler.tick();
    await scheduler.stop();
    expect(finished).toBe(true);
  });

  it("respects the shutdown timeout instead of waiting forever for a stuck task", async () => {
    const db = createFakeDb();
    const config = baseConfig({ schedules: [entry("lever", "* * * * *")], shutdownTimeoutMs: 30 });
    const scheduler = new Scheduler({
      db,
      config,
      now: () => new Date("2026-09-24T14:00:00.000Z"),
      createAdapter: (): JobSourceAdapter => ({
        source: "lever",
        fetchJobs: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_000)); // effectively "stuck"
          return [];
        },
      }),
    });

    scheduler.tick();
    const startedAt = Date.now();
    await scheduler.stop();
    expect(Date.now() - startedAt).toBeLessThan(1000); // returned promptly, did not wait 10s
  });

  it("releases the lock even after a shutdown-timeout race, once the task itself finishes", async () => {
    const db = createFakeDb();
    const config = baseConfig({ schedules: [entry("lever", "* * * * *")], shutdownTimeoutMs: 10 });
    const scheduler = new Scheduler({
      db,
      config,
      now: () => new Date("2026-09-24T14:00:00.000Z"),
      createAdapter: (): JobSourceAdapter => ({
        source: "lever",
        fetchJobs: async () => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return [];
        },
      }),
    });

    scheduler.tick();
    await scheduler.stop(); // times out before the task finishes
    await new Promise((resolve) => setTimeout(resolve, 100)); // let the background task actually finish
    const rows = await db.query(
      `/* scheduler:acquireLock */ INSERT INTO ingestion_locks (source, owner_id, locked_until, created_at, updated_at)
       VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval, NOW(), NOW())
       ON CONFLICT (source) DO UPDATE
         SET owner_id = EXCLUDED.owner_id, locked_until = EXCLUDED.locked_until, updated_at = NOW()
         WHERE ingestion_locks.locked_until < NOW()
       RETURNING owner_id`,
      ["lever", "probe", "10"],
    );
    expect(rows).toHaveLength(1); // lock was released -> a fresh acquisition succeeds
  });
});
