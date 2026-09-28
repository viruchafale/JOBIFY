/**
 * Phase 8 — Structured logging, same JSON shape as runner.ts/scheduler
 * logs (timestamp/level/service/component/event). Never logs API keys,
 * prompts, full job descriptions, or full model responses — only ids,
 * counts, durations, and short classification strings.
 */

const ERROR_EVENTS = new Set(["intelligence_failed", "intelligence_ai_failed"]);

export function logIntelligenceEvent(event: string, fields: Record<string, unknown> = {}): void {
  const level = ERROR_EVENTS.has(event) ? "error" : event === "intelligence_retry" ? "warn" : "info";
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "job",
      component: "intelligence",
      event,
      ...fields,
    }),
  );
}
