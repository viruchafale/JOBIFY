/**
 * Phase 6 — The scheduler.
 *
 * Owns exactly one decision: "which source is due right now?" — then hands
 * off to executeSourceIngestion() (lock -> runIngestion() -> health ->
 * stale detection -> unlock). No normalization/validation/dedupe/
 * persistence logic lives here.
 *
 * Failure isolation: every dispatched source runs inside its own
 * try/catch. One source throwing (adapter bug, DB hiccup in the lock/health
 * calls, anything) is logged and does not stop the tick loop, does not
 * affect other sources, and does not crash the process.
 *
 * Concurrency: a simple in-process counting semaphore bounds how many
 * sources this scheduler instance runs at once (INGESTION_MAX_CONCURRENCY).
 * Per-source overlap (this or another scheduler process) is prevented by
 * the DB-backed lock in lock.ts, not by this semaphore.
 */

import { randomUUID } from "node:crypto";
import type { JobSourceAdapter } from "../adapter.js";
import type { SqlClient } from "../repository.js";
import type { IngestionTriggerType } from "../types.js";
import type { ReliabilityConfig, ScheduleEntry } from "./config.js";
import { cronMatches, minuteKey } from "./cron.js";
import { executeSourceIngestion, type ExecuteSourceIngestionResult } from "./executeSourceIngestion.js";
import { logSchedulerEvent } from "./logger.js";

/** Pure, timer-free due-check — easy to unit test with fixed Date objects. */
export function isScheduleDue(
  entry: ScheduleEntry,
  now: Date,
  timezone: string,
  lastFiredMinuteKey: string | undefined,
): { due: boolean; minuteKey: string } {
  const key = minuteKey(now, timezone);
  if (key === lastFiredMinuteKey) return { due: false, minuteKey: key };
  return { due: cronMatches(entry.schedule, now, timezone), minuteKey: key };
}

class Semaphore {
  private available: number;
  private readonly queue: (() => void)[] = [];

  constructor(count: number) {
    this.available = Math.max(1, count);
  }

  acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve(() => this.release());
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.available -= 1;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.available += 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

export interface SchedulerOptions {
  db: SqlClient;
  config: ReliabilityConfig;
  tickIntervalMs?: number;
  /** Injectable for tests. */
  now?: () => Date;
  /** Injectable for tests; defaults to the real source registry. */
  createAdapter?: (source: string) => JobSourceAdapter;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export class Scheduler {
  private readonly db: SqlClient;
  private readonly config: ReliabilityConfig;
  private readonly tickIntervalMs: number;
  private readonly now: () => Date;
  private readonly ownerId = randomUUID();
  private readonly semaphore: Semaphore;
  private readonly lastFiredMinute = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly createAdapter?: (source: string) => JobSourceAdapter;
  private readonly sleep?: (ms: number) => Promise<void>;

  constructor(options: SchedulerOptions) {
    this.db = options.db;
    this.config = options.config;
    this.tickIntervalMs = options.tickIntervalMs ?? 15_000;
    this.now = options.now ?? (() => new Date());
    this.semaphore = new Semaphore(options.config.maxConcurrency);
    this.createAdapter = options.createAdapter;
    this.sleep = options.sleep;
  }

  start(): void {
    if (this.timer) return;
    logSchedulerEvent("scheduler_started", {
      sources: this.config.schedules.map((s) => s.source),
      timezone: this.config.timezone,
      maxConcurrency: this.config.maxConcurrency,
    });
    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
    this.tick();
  }

  /** Runs every configured source exactly once, ignoring cron timing. Used by `--once`. */
  async runOnce(): Promise<Map<string, ExecuteSourceIngestionResult>> {
    const results = new Map<string, ExecuteSourceIngestionResult>();
    await Promise.all(
      this.config.schedules.map(async (entry) => {
        const result = await this.dispatch(entry.source, "manual", null);
        if (result) results.set(entry.source, result);
      }),
    );
    return results;
  }

  tick(): void {
    if (this.stopped) return;
    const now = this.now();
    for (const entry of this.config.schedules) {
      if (this.inFlight.has(entry.source)) continue; // already running from this instance

      const { due, minuteKey: key } = isScheduleDue(
        entry,
        now,
        this.config.timezone,
        this.lastFiredMinute.get(entry.source),
      );
      if (!due) continue;

      this.lastFiredMinute.set(entry.source, key);
      void this.dispatch(entry.source, "scheduled", now);
    }
  }

  private async dispatch(
    source: string,
    trigger: IngestionTriggerType,
    scheduledFor: Date | null,
  ): Promise<ExecuteSourceIngestionResult | undefined> {
    if (this.stopped) return undefined;

    let resolveTask: () => void;
    const task = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });
    this.inFlight.set(source, task);

    try {
      const release = await this.semaphore.acquire();
      try {
        return await executeSourceIngestion({
          source,
          db: this.db,
          ownerId: this.ownerId,
          trigger,
          scheduledFor,
          lockTtlSeconds: this.config.lockTtlSeconds,
          retryMaxAttempts: this.config.retryMaxAttempts,
          retryBaseDelayMs: this.config.retryBaseDelayMs,
          retryMaxDelayMs: this.config.retryMaxDelayMs,
          staleAfterRuns: this.config.staleAfterRuns,
          createAdapter: this.createAdapter,
          sleep: this.sleep,
        });
      } finally {
        release();
      }
    } catch (error) {
      // A single source's task must never take down the scheduler.
      logSchedulerEvent("scheduler_task_error", { source, error: (error as Error).message });
      return undefined;
    } finally {
      this.inFlight.delete(source);
      resolveTask!();
    }
  }

  /**
   * Graceful shutdown: stop scheduling new work immediately, wait for
   * in-flight ingestion up to `shutdownTimeoutMs`, then return. If the
   * timeout elapses first, in-flight tasks keep running in the background
   * (Node can't safely abort an in-flight HTTP request) and their own
   * `finally` block still releases their lock when they finish — and even
   * if the process is killed before that, the lock's TTL (not this
   * shutdown path) is what guarantees it's never held permanently.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const running = [...this.inFlight.keys()];
    logSchedulerEvent("scheduler_stopping", { running });
    if (running.length === 0) {
      logSchedulerEvent("scheduler_stopped", {});
      return;
    }

    const pending = Promise.allSettled([...this.inFlight.values()]);
    const timedOut = await Promise.race([
      pending.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), this.config.shutdownTimeoutMs)),
    ]);

    if (timedOut) {
      logSchedulerEvent("scheduler_shutdown_timeout", { stillRunning: [...this.inFlight.keys()] });
    } else {
      logSchedulerEvent("scheduler_stopped", {});
    }
  }
}
