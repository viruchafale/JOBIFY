/**
 * Phase 6 — Minimal standard 5-field cron parser + matcher.
 *
 * No dependency was added for this: the project doesn't already use a cron
 * library anywhere, and a full library would be more infrastructure than
 * "which source is due right now" needs. This module is pure and
 * deterministic — easy to unit test without waiting on real timers.
 *
 * Supported syntax per field: a wildcard, a wildcard with a step suffix
 * (e.g. every-15 written as wildcard-slash-15), a range ("a-b"), a range
 * with a step suffix, and comma-separated combinations of the above
 * (e.g. "1-5,10,wildcard-slash-15").
 *
 * Fields (in order): minute(0-59) hour(0-23) day-of-month(1-31) month(1-12)
 * day-of-week(0-7, both 0 and 7 mean Sunday).
 *
 * Day-of-month/day-of-week use the standard cron OR quirk: if BOTH fields
 * are restricted (neither is a literal `*`), a date matches if it satisfies
 * EITHER field, not both.
 */

export interface CronSchedule {
  readonly raw: string;
  readonly minute: FieldMatch;
  readonly hour: FieldMatch;
  readonly dayOfMonth: FieldMatch;
  readonly month: FieldMatch;
  readonly dayOfWeek: FieldMatch;
}

interface FieldMatch {
  /** true only for a literal "*" — used for the day-of-month/day-of-week OR quirk. */
  isWildcard: boolean;
  values: Set<number>;
}

const FIELD_RANGES: { name: string; min: number; max: number }[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 },
];

function parseField(rawField: string, name: string, min: number, max: number): FieldMatch {
  if (rawField === "*") {
    const values = new Set<number>();
    for (let v = min; v <= max; v += 1) values.add(v);
    return { isWildcard: true, values };
  }

  const values = new Set<number>();
  const parts = rawField.split(",");
  if (parts.length === 0 || parts.some((p) => p.trim() === "")) {
    throw new Error(`invalid cron ${name} field: "${rawField}"`);
  }

  for (const part of parts) {
    const stepMatch = part.match(/^(\*|\d+-\d+|\d+)(?:\/(\d+))?$/);
    if (!stepMatch) {
      throw new Error(`invalid cron ${name} field segment: "${part}" (in "${rawField}")`);
    }
    const [, rangePart, stepPart] = stepMatch;
    const step = stepPart !== undefined ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`invalid cron ${name} step: "${part}"`);
    }

    let rangeStart: number;
    let rangeEnd: number;
    if (rangePart === "*") {
      rangeStart = min;
      rangeEnd = max;
    } else if (rangePart.includes("-")) {
      const [startStr, endStr] = rangePart.split("-");
      rangeStart = Number(startStr);
      rangeEnd = Number(endStr);
      if (rangeStart > rangeEnd) {
        throw new Error(`invalid cron ${name} range (start > end): "${part}"`);
      }
    } else {
      rangeStart = Number(rangePart);
      rangeEnd = rangeStart;
    }

    if (
      !Number.isInteger(rangeStart) ||
      !Number.isInteger(rangeEnd) ||
      rangeStart < min ||
      rangeEnd > max
    ) {
      throw new Error(
        `invalid cron ${name} value out of range [${min}-${max}]: "${part}" (in "${rawField}")`,
      );
    }

    for (let v = rangeStart; v <= rangeEnd; v += step) {
      // day-of-week: normalize 7 -> 0 (both mean Sunday).
      values.add(name === "day-of-week" && v === 7 ? 0 : v);
    }
  }

  return { isWildcard: false, values };
}

export function parseCronExpression(expr: string): CronSchedule {
  const trimmed = expr.trim();
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `invalid cron expression "${expr}": expected 5 space-separated fields (minute hour day-of-month month day-of-week), got ${fields.length}`,
    );
  }

  const [minuteStr, hourStr, domStr, monthStr, dowStr] = fields;
  const minute = parseField(minuteStr, FIELD_RANGES[0].name, FIELD_RANGES[0].min, FIELD_RANGES[0].max);
  const hour = parseField(hourStr, FIELD_RANGES[1].name, FIELD_RANGES[1].min, FIELD_RANGES[1].max);
  const dayOfMonth = parseField(domStr, FIELD_RANGES[2].name, FIELD_RANGES[2].min, FIELD_RANGES[2].max);
  const month = parseField(monthStr, FIELD_RANGES[3].name, FIELD_RANGES[3].min, FIELD_RANGES[3].max);
  const dayOfWeek = parseField(dowStr, FIELD_RANGES[4].name, FIELD_RANGES[4].min, FIELD_RANGES[4].max);

  return { raw: trimmed, minute, hour, dayOfMonth, month, dayOfWeek };
}

interface WallClockFields {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

/** Wall-clock date/time fields for `date` as observed in `timeZone`. Throws for an invalid IANA timezone. */
export function getWallClockFields(date: Date, timeZone: string): WallClockFields {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      minute: "numeric",
      hour: "numeric",
      hourCycle: "h23",
      day: "numeric",
      month: "numeric",
      weekday: "short",
    }).formatToParts(date);
  } catch {
    throw new Error(`invalid IANA timezone: "${timeZone}"`);
  }

  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const weekdayShort = get("weekday");
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const minute = Number(get("minute"));
  const hour = Number(get("hour"));
  const dayOfMonth = Number(get("day"));
  const month = Number(get("month"));
  const dayOfWeek = weekdayShort ? weekdayMap[weekdayShort] : undefined;

  if (
    !Number.isInteger(minute) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(dayOfMonth) ||
    !Number.isInteger(month) ||
    dayOfWeek === undefined
  ) {
    throw new Error(`failed to resolve wall-clock fields for timezone "${timeZone}"`);
  }

  return { minute, hour: hour === 24 ? 0 : hour, dayOfMonth, month, dayOfWeek };
}

/** Does `date` (interpreted in `timeZone`) match this cron schedule's minute? */
export function cronMatches(schedule: CronSchedule, date: Date, timeZone: string): boolean {
  const fields = getWallClockFields(date, timeZone);

  if (!schedule.minute.values.has(fields.minute)) return false;
  if (!schedule.hour.values.has(fields.hour)) return false;
  if (!schedule.month.values.has(fields.month)) return false;

  const domRestricted = !schedule.dayOfMonth.isWildcard;
  const dowRestricted = !schedule.dayOfWeek.isWildcard;

  if (domRestricted && dowRestricted) {
    return schedule.dayOfMonth.values.has(fields.dayOfMonth) || schedule.dayOfWeek.values.has(fields.dayOfWeek);
  }
  if (domRestricted) return schedule.dayOfMonth.values.has(fields.dayOfMonth);
  if (dowRestricted) return schedule.dayOfWeek.values.has(fields.dayOfWeek);
  return true;
}

/** A minute-granularity dedupe key, stable across repeated ticks within the same minute. */
export function minuteKey(date: Date, timeZone: string): string {
  const fields = getWallClockFields(date, timeZone);
  return `${fields.month}-${fields.dayOfMonth}-${fields.hour}-${fields.minute}`;
}
