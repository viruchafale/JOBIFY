/**
 * Phase 6 — Scheduler configuration: parsing + validation of every
 * INGESTION_* environment variable. Fails clearly and eagerly (at scheduler
 * startup, not mid-run) rather than silently falling back to something
 * unsafe.
 *
 * Kept as plain validation functions (no schema library) to match this
 * service's existing conventions (see adapter `parse*Companies()` helpers
 * and `parseExternalJobFilters()` in repository.ts) rather than introducing
 * a new one.
 */

import { parseCronExpression, type CronSchedule } from "./cron.js";

export interface ScheduleEntry {
  source: string;
  cronExpression: string;
  schedule: CronSchedule;
}

export interface ReliabilityConfig {
  enabled: boolean;
  schedules: ScheduleEntry[];
  timezone: string;
  maxConcurrency: number;
  lockTtlSeconds: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  staleAfterRuns: number;
  shutdownTimeoutMs: number;
}

/** A source that must never be scheduled — local/deterministic test fixture only. */
export const NON_SCHEDULABLE_SOURCES = new Set(["fixture"]);

/** Parses `lever:0 * * * *;greenhouse:15 * * * *` into raw (unvalidated) entries. */
export function parseScheduleEntries(
  raw: string | undefined,
): { source: string; cronExpression: string }[] {
  if (!raw || raw.trim() === "") return [];
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const sepIndex = entry.indexOf(":");
      if (sepIndex === -1) {
        throw new Error(`invalid INGESTION_SCHEDULES entry (missing ':'): "${entry}"`);
      }
      const source = entry.slice(0, sepIndex).trim();
      const cronExpression = entry.slice(sepIndex + 1).trim();
      if (!source) {
        throw new Error(`invalid INGESTION_SCHEDULES entry (empty source): "${entry}"`);
      }
      if (!cronExpression) {
        throw new Error(`invalid INGESTION_SCHEDULES entry (empty cron expression): "${entry}"`);
      }
      return { source, cronExpression };
    });
}

/** Validates raw schedule entries against the set of registered sources. */
export function validateScheduleEntries(
  entries: { source: string; cronExpression: string }[],
  knownSources: string[],
): ScheduleEntry[] {
  const knownSet = new Set(knownSources);
  const seen = new Set<string>();

  return entries.map(({ source, cronExpression }) => {
    if (NON_SCHEDULABLE_SOURCES.has(source)) {
      throw new Error(
        `INGESTION_SCHEDULES references "${source}", which is a local test-only source and must never run on a schedule.`,
      );
    }
    if (!knownSet.has(source)) {
      throw new Error(
        `INGESTION_SCHEDULES references unknown source "${source}". Registered sources: ${[...knownSet].join(", ") || "(none)"}.`,
      );
    }
    if (seen.has(source)) {
      throw new Error(`INGESTION_SCHEDULES has more than one schedule for source "${source}".`);
    }
    seen.add(source);

    let schedule: CronSchedule;
    try {
      schedule = parseCronExpression(cronExpression);
    } catch (error) {
      throw new Error(
        `INGESTION_SCHEDULES has an invalid cron expression for source "${source}": ${(error as Error).message}`,
      );
    }
    return { source, cronExpression, schedule };
  });
}

function parseIntEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  options: { min?: number } = {},
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || (options.min !== undefined && value < options.min)) {
    throw new Error(
      `invalid ${name}: "${raw}" (must be an integer${options.min !== undefined ? ` >= ${options.min}` : ""})`,
    );
  }
  return value;
}

function parseBoolEnv(env: NodeJS.ProcessEnv, name: string, defaultValue: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`invalid ${name}: "${raw}" (must be "true" or "false")`);
}

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error(`invalid INGESTION_TIMEZONE: "${timezone}" (must be a valid IANA timezone, e.g. "UTC")`);
  }
}

/**
 * Loads and validates the full Phase 6 scheduler configuration.
 * `knownSources` should come from the live source registry — passed in
 * explicitly (rather than imported internally) so this stays pure and
 * testable without needing the real registry wired up.
 */
export function loadReliabilityConfig(
  env: NodeJS.ProcessEnv,
  knownSources: string[],
): ReliabilityConfig {
  const enabled = parseBoolEnv(env, "INGESTION_SCHEDULER_ENABLED", false);
  const timezone = env.INGESTION_TIMEZONE?.trim() || "UTC";
  assertValidTimezone(timezone);

  const rawEntries = parseScheduleEntries(env.INGESTION_SCHEDULES);
  const schedules = validateScheduleEntries(rawEntries, knownSources);

  const maxConcurrency = parseIntEnv(env, "INGESTION_MAX_CONCURRENCY", 1, { min: 1 });
  const lockTtlSeconds = parseIntEnv(env, "INGESTION_LOCK_TTL_SECONDS", 1800, { min: 30 });
  const retryMaxAttempts = parseIntEnv(env, "INGESTION_RETRY_MAX_ATTEMPTS", 3, { min: 1 });
  const retryBaseDelayMs = parseIntEnv(env, "INGESTION_RETRY_BASE_DELAY_MS", 1000, { min: 0 });
  const retryMaxDelayMs = parseIntEnv(env, "INGESTION_RETRY_MAX_DELAY_MS", 30000, {
    min: retryBaseDelayMs,
  });
  const staleAfterRuns = parseIntEnv(env, "INGESTION_STALE_AFTER_RUNS", 3, { min: 1 });
  const shutdownTimeoutMs = parseIntEnv(env, "INGESTION_SHUTDOWN_TIMEOUT_MS", 30000, { min: 0 });

  return {
    enabled,
    schedules,
    timezone,
    maxConcurrency,
    lockTtlSeconds,
    retryMaxAttempts,
    retryBaseDelayMs,
    retryMaxDelayMs,
    staleAfterRuns,
    shutdownTimeoutMs,
  };
}
