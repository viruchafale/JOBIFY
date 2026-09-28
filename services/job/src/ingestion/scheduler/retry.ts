/**
 * Phase 6 — Source-agnostic error classification + bounded exponential
 * backoff with jitter.
 *
 * `runIngestion()` never throws (see runner.ts) — a fetch failure is
 * captured as `summary.status === "failed"` with `summary.errorMessage`
 * being the first recorded error message. That string is the only signal
 * available for a retry decision without redesigning the adapter/runner
 * error model, so classification here is pattern-based rather than a typed
 * error hierarchy threaded through every adapter.
 *
 * Known limitation: when every company/board configured for a source fails
 * (see leverAdapter.ts / greenhouseAdapter.ts / ashbyAdapter.ts), the
 * adapter joins each company's distinct error into one message
 * ("all N companies failed: msgA; msgB"). If those sub-errors are of
 * different classes, classification below is best-effort: it favors
 * retrying (a `retryable` match anywhere in the message wins) since a
 * wasted retry attempt is bounded and cheap, while never retrying is
 * classified as `configuration` or `permanent` first when those are
 * unambiguous.
 */

export type IngestionErrorClass = "retryable" | "permanent" | "configuration" | "unknown";

const CONFIGURATION_PATTERNS = [
  /no companies configured/i,
  /no .* configured/i,
  /invalid company configuration/i,
  /invalid .* configuration/i,
];

const RETRYABLE_PATTERNS = [
  /HTTP 429/,
  /HTTP 5\d\d/,
  /timed out/i,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ENOTFOUND/,
  /EAI_AGAIN/,
  /network request failed/i,
  /network error/i,
  /socket hang up/i,
];

const PERMANENT_PATTERNS = [
  /HTTP 4\d\d/,
  /malformed response/i,
  /unknown .*(company|board|job board)/i,
];

/** Classifies an ingestion failure message. Never throws. */
export function classifyIngestionError(message: string | null | undefined): IngestionErrorClass {
  if (!message) return "unknown";
  if (CONFIGURATION_PATTERNS.some((pattern) => pattern.test(message))) return "configuration";
  if (RETRYABLE_PATTERNS.some((pattern) => pattern.test(message))) return "retryable";
  if (PERMANENT_PATTERNS.some((pattern) => pattern.test(message))) return "permanent";
  return "unknown";
}

export function isRetryableClass(errorClass: IngestionErrorClass): boolean {
  return errorClass === "retryable";
}

/**
 * Bounded exponential backoff with "equal jitter" (AWS's terminology):
 * delay is uniformly random in [cap/2, cap], where cap = min(base*2^(attempt-1), maxDelayMs).
 * Always > 0 when baseDelayMs > 0, and never exceeds maxDelayMs.
 */
export function computeBackoffDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  const half = capped / 2;
  return Math.round(half + Math.random() * half);
}
