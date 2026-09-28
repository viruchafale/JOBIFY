/**
 * Phase 6 — Scheduler configuration tests.
 */

import { describe, it, expect } from "vitest";
import {
  loadReliabilityConfig,
  parseScheduleEntries,
  validateScheduleEntries,
} from "./config.js";

const KNOWN_SOURCES = ["fixture", "lever", "greenhouse", "ashby"];

describe("parseScheduleEntries", () => {
  it("parses multiple entries", () => {
    const entries = parseScheduleEntries("lever:0 * * * *;greenhouse:15 * * * *");
    expect(entries).toEqual([
      { source: "lever", cronExpression: "0 * * * *" },
      { source: "greenhouse", cronExpression: "15 * * * *" },
    ]);
  });

  it("returns an empty array for undefined/empty input", () => {
    expect(parseScheduleEntries(undefined)).toEqual([]);
    expect(parseScheduleEntries("")).toEqual([]);
    expect(parseScheduleEntries("   ")).toEqual([]);
  });

  it("rejects an entry missing the ':' separator", () => {
    expect(() => parseScheduleEntries("lever-0 * * * *")).toThrow(/missing ':'/);
  });

  it("rejects an entry with an empty source", () => {
    expect(() => parseScheduleEntries(":0 * * * *")).toThrow(/empty source/);
  });
});

describe("validateScheduleEntries", () => {
  it("accepts a valid schedule for a registered source", () => {
    const result = validateScheduleEntries(
      [{ source: "lever", cronExpression: "0 * * * *" }],
      KNOWN_SOURCES,
    );
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("lever");
    expect(result[0].schedule.minute.values.has(0)).toBe(true);
  });

  it("rejects an invalid cron expression with a clear error", () => {
    expect(() =>
      validateScheduleEntries([{ source: "lever", cronExpression: "not a cron" }], KNOWN_SOURCES),
    ).toThrow(/invalid cron expression for source "lever"/);
  });

  it("rejects an unknown source", () => {
    expect(() =>
      validateScheduleEntries([{ source: "workday", cronExpression: "0 * * * *" }], KNOWN_SOURCES),
    ).toThrow(/unknown source "workday"/);
  });

  it("rejects scheduling the fixture source", () => {
    expect(() =>
      validateScheduleEntries([{ source: "fixture", cronExpression: "0 * * * *" }], KNOWN_SOURCES),
    ).toThrow(/must never run on a schedule/);
  });

  it("rejects a duplicate schedule for the same source", () => {
    expect(() =>
      validateScheduleEntries(
        [
          { source: "lever", cronExpression: "0 * * * *" },
          { source: "lever", cronExpression: "30 * * * *" },
        ],
        KNOWN_SOURCES,
      ),
    ).toThrow(/more than one schedule/);
  });
});

describe("loadReliabilityConfig", () => {
  it("is disabled by default with no schedules", () => {
    const config = loadReliabilityConfig({}, KNOWN_SOURCES);
    expect(config.enabled).toBe(false);
    expect(config.schedules).toEqual([]);
    expect(config.timezone).toBe("UTC");
  });

  it("parses a full valid configuration", () => {
    const config = loadReliabilityConfig(
      {
        INGESTION_SCHEDULER_ENABLED: "true",
        INGESTION_SCHEDULES: "lever:0 * * * *;greenhouse:15 * * * *;ashby:30 * * * *",
        INGESTION_TIMEZONE: "America/New_York",
        INGESTION_MAX_CONCURRENCY: "2",
        INGESTION_LOCK_TTL_SECONDS: "900",
        INGESTION_RETRY_MAX_ATTEMPTS: "5",
        INGESTION_RETRY_BASE_DELAY_MS: "500",
        INGESTION_RETRY_MAX_DELAY_MS: "10000",
        INGESTION_STALE_AFTER_RUNS: "5",
        INGESTION_SHUTDOWN_TIMEOUT_MS: "15000",
      } as NodeJS.ProcessEnv,
      KNOWN_SOURCES,
    );
    expect(config.enabled).toBe(true);
    expect(config.schedules.map((s) => s.source)).toEqual(["lever", "greenhouse", "ashby"]);
    expect(config.timezone).toBe("America/New_York");
    expect(config.maxConcurrency).toBe(2);
    expect(config.lockTtlSeconds).toBe(900);
    expect(config.retryMaxAttempts).toBe(5);
    expect(config.retryBaseDelayMs).toBe(500);
    expect(config.retryMaxDelayMs).toBe(10000);
    expect(config.staleAfterRuns).toBe(5);
    expect(config.shutdownTimeoutMs).toBe(15000);
  });

  it("rejects an invalid timezone", () => {
    expect(() =>
      loadReliabilityConfig({ INGESTION_TIMEZONE: "Not/AZone" } as NodeJS.ProcessEnv, KNOWN_SOURCES),
    ).toThrow(/invalid INGESTION_TIMEZONE/);
  });

  it("rejects a non-boolean INGESTION_SCHEDULER_ENABLED", () => {
    expect(() =>
      loadReliabilityConfig(
        { INGESTION_SCHEDULER_ENABLED: "yes" } as NodeJS.ProcessEnv,
        KNOWN_SOURCES,
      ),
    ).toThrow(/invalid INGESTION_SCHEDULER_ENABLED/);
  });

  it("rejects a non-integer numeric setting", () => {
    expect(() =>
      loadReliabilityConfig(
        { INGESTION_MAX_CONCURRENCY: "not-a-number" } as NodeJS.ProcessEnv,
        KNOWN_SOURCES,
      ),
    ).toThrow(/invalid INGESTION_MAX_CONCURRENCY/);
  });

  it("rejects a value below its minimum", () => {
    expect(() =>
      loadReliabilityConfig({ INGESTION_MAX_CONCURRENCY: "0" } as NodeJS.ProcessEnv, KNOWN_SOURCES),
    ).toThrow(/invalid INGESTION_MAX_CONCURRENCY/);
  });

  it("propagates schedule validation errors (unknown source) with scheduler disabled", () => {
    expect(() =>
      loadReliabilityConfig(
        { INGESTION_SCHEDULES: "workday:0 * * * *" } as NodeJS.ProcessEnv,
        KNOWN_SOURCES,
      ),
    ).toThrow(/unknown source "workday"/);
  });
});
