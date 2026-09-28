/**
 * Phase 6 — Structured logging, matching the exact JSON shape already used
 * by runner.ts's `logIngestion()` (timestamp/level/service/component/event)
 * so scheduler logs interleave cleanly with existing ingestion logs.
 *
 * Never log credentials, cookies, tokens, or full external job payloads —
 * only counters, ids, sources, and short error messages.
 */

const ERROR_EVENTS = new Set([
  "ingestion_lock_skipped",
  "scheduler_task_error",
  "scheduler_config_error",
]);

export function logSchedulerEvent(event: string, fields: Record<string, unknown> = {}): void {
  const level =
    fields.status === "failed" || ERROR_EVENTS.has(event)
      ? "error"
      : event === "ingestion_retry"
        ? "warn"
        : "info";
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "job",
      component: "scheduler",
      event,
      ...fields,
    }),
  );
}
