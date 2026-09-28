/**
 * Phase 6 — Cron parser + matcher tests. Pure, no timers.
 */

import { describe, it, expect } from "vitest";
import { parseCronExpression, cronMatches, minuteKey, getWallClockFields } from "./cron.js";

describe("parseCronExpression", () => {
  it("parses a simple every-hour-at-minute-0 expression", () => {
    const schedule = parseCronExpression("0 * * * *");
    expect(schedule.minute.values.has(0)).toBe(true);
    expect(schedule.minute.values.has(1)).toBe(false);
    expect(schedule.hour.isWildcard).toBe(true);
  });

  it("parses a step expression", () => {
    const schedule = parseCronExpression("*/15 * * * *");
    expect([...schedule.minute.values].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
  });

  it("parses a range expression", () => {
    const schedule = parseCronExpression("0 9-17 * * *");
    expect(schedule.hour.values.has(9)).toBe(true);
    expect(schedule.hour.values.has(17)).toBe(true);
    expect(schedule.hour.values.has(8)).toBe(false);
    expect(schedule.hour.values.has(18)).toBe(false);
  });

  it("parses a comma-separated list", () => {
    const schedule = parseCronExpression("0,30 * * * *");
    expect([...schedule.minute.values].sort((a, b) => a - b)).toEqual([0, 30]);
  });

  it("normalizes day-of-week 7 to 0 (Sunday)", () => {
    const schedule = parseCronExpression("0 0 * * 7");
    expect(schedule.dayOfWeek.values.has(0)).toBe(true);
  });

  it("rejects a wrong number of fields", () => {
    expect(() => parseCronExpression("* * *")).toThrow(/expected 5/);
  });

  it("rejects an out-of-range value", () => {
    expect(() => parseCronExpression("60 * * * *")).toThrow(/out of range/);
    expect(() => parseCronExpression("0 24 * * *")).toThrow(/out of range/);
  });

  it("rejects garbage input", () => {
    expect(() => parseCronExpression("not a cron * *")).toThrow();
    expect(() => parseCronExpression("* * * * abc")).toThrow();
  });

  it("rejects a zero or negative step", () => {
    expect(() => parseCronExpression("*/0 * * * *")).toThrow();
  });

  it("rejects an inverted range", () => {
    expect(() => parseCronExpression("0 17-9 * * *")).toThrow(/start > end/);
  });
});

describe("cronMatches", () => {
  it("matches an exact minute/hour", () => {
    const schedule = parseCronExpression("30 14 * * *");
    const date = new Date("2026-09-24T14:30:00.000Z");
    expect(cronMatches(schedule, date, "UTC")).toBe(true);
  });

  it("does not match a different minute", () => {
    const schedule = parseCronExpression("30 14 * * *");
    const date = new Date("2026-09-24T14:31:00.000Z");
    expect(cronMatches(schedule, date, "UTC")).toBe(false);
  });

  it("applies the day-of-month/day-of-week OR quirk when both are restricted", () => {
    // 2026-09-24 is a Thursday (day-of-week 4). day-of-month=1 does not match,
    // but day-of-week=4 does -> overall match because cron ORs the two when
    // both are restricted.
    const schedule = parseCronExpression("0 0 1 * 4");
    const date = new Date("2026-09-24T00:00:00.000Z");
    expect(cronMatches(schedule, date, "UTC")).toBe(true);
  });

  it("respects timezone: a UTC instant maps to different local hours", () => {
    const schedule = parseCronExpression("0 9 * * *");
    // 09:00 in America/New_York (UTC-4 in September) is 13:00 UTC.
    const date = new Date("2026-09-24T13:00:00.000Z");
    expect(cronMatches(schedule, date, "America/New_York")).toBe(true);
    expect(cronMatches(schedule, date, "UTC")).toBe(false);
  });

  it("throws a clear error for an invalid timezone", () => {
    const schedule = parseCronExpression("0 * * * *");
    expect(() => cronMatches(schedule, new Date(), "Not/AZone")).toThrow(/invalid IANA timezone/);
  });
});

describe("minuteKey", () => {
  it("is stable within the same minute and changes across minutes", () => {
    const a = minuteKey(new Date("2026-09-24T14:30:00.000Z"), "UTC");
    const b = minuteKey(new Date("2026-09-24T14:30:59.000Z"), "UTC");
    const c = minuteKey(new Date("2026-09-24T14:31:00.000Z"), "UTC");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("getWallClockFields", () => {
  it("returns correct fields for a known UTC instant", () => {
    const fields = getWallClockFields(new Date("2026-09-24T14:30:00.000Z"), "UTC");
    expect(fields).toEqual({ minute: 30, hour: 14, dayOfMonth: 24, month: 9, dayOfWeek: 4 });
  });
});
