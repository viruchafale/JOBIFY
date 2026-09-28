/**
 * Phase 8 — AI extraction orchestration: call provider -> parse -> validate.
 *
 * Every failure mode (network, timeout, malformed JSON, schema violation)
 * is caught here and surfaced as a single AiExtractionError with a
 * `retryable` flag — the processor uses that to decide whether the job's
 * overall status becomes `retryable_failed` (transient — a future
 * reprocess might succeed) rather than a hard failure. The original job is
 * never affected either way (see processor.ts).
 */

import type { AiExtractionProvider, AiProviderInput } from "./provider.js";
import { extractJsonFromModelText, validateAiExtraction, type ValidatedAiExtraction } from "./schema.js";

export type AiFailureReason = "timeout" | "provider_failure" | "invalid_json" | "schema_validation_failed";

export class AiExtractionError extends Error {
  constructor(
    public readonly reason: AiFailureReason,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiExtractionError";
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function extractWithAi(
  provider: AiExtractionProvider,
  input: AiProviderInput,
  timeoutMs: number,
): Promise<ValidatedAiExtraction> {
  let rawText: string;
  try {
    rawText = await withTimeout(provider.generate(input), timeoutMs);
  } catch (error) {
    const message = (error as Error).message || "unknown provider error";
    const timedOut = message.includes("timed out");
    throw new AiExtractionError(
      timedOut ? "timeout" : "provider_failure",
      `AI provider "${provider.name}" failed: ${message}`,
      true, // network/timeout/provider errors are transient — worth a future retry
    );
  }

  let parsed: unknown;
  try {
    parsed = extractJsonFromModelText(rawText);
  } catch (error) {
    throw new AiExtractionError(
      "invalid_json",
      `AI provider "${provider.name}" returned invalid JSON: ${(error as Error).message}`,
      true, // a retry might get a well-formed response next time
    );
  }

  try {
    return validateAiExtraction(parsed);
  } catch (error) {
    throw new AiExtractionError(
      "schema_validation_failed",
      (error as Error).message,
      false, // the model consistently produced the wrong shape; retrying alone won't fix a prompt/schema mismatch
    );
  }
}
