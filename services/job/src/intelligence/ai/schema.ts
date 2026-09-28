/**
 * Phase 8 — Strict schema for AI extraction output.
 *
 * Untrusted model output is NEVER persisted without passing this. Uses zod
 * (already a job-service dependency, previously unused) rather than
 * hand-rolled validation — exactly the kind of untrusted-JSON boundary it's
 * built for. `.strict()` everywhere rejects unexpected fields a model might
 * add; explicit `.max()`/`.min()` bound every string/array length so
 * oversized or empty values are rejected, not silently truncated or
 * accepted.
 */

import { z } from "zod";
import { ITEM_TEXT_MAX_LENGTH, MAX_REQUIREMENTS_PER_JOB, MAX_RESPONSIBILITIES_PER_JOB, SUMMARY_MAX_LENGTH } from "../constants.js";

export const AiResponsibilitySchema = z
  .object({
    text: z.string().min(1).max(ITEM_TEXT_MAX_LENGTH),
  })
  .strict();

export const AiRequirementSchema = z
  .object({
    text: z.string().min(1).max(ITEM_TEXT_MAX_LENGTH),
    level: z.enum(["required", "preferred"]),
  })
  .strict();

export const AiExtractionSchema = z
  .object({
    responsibilities: z.array(AiResponsibilitySchema).max(MAX_RESPONSIBILITIES_PER_JOB),
    requirements: z.array(AiRequirementSchema).max(MAX_REQUIREMENTS_PER_JOB),
    summary: z.string().min(1).max(SUMMARY_MAX_LENGTH),
  })
  .strict();

export type ValidatedAiExtraction = z.infer<typeof AiExtractionSchema>;

export class AiSchemaValidationError extends Error {
  constructor(public readonly issues: string) {
    super(`AI extraction output failed schema validation: ${issues}`);
    this.name = "AiSchemaValidationError";
  }
}

/**
 * Strips common LLM markdown-fence wrapping (```json ... ```) and parses
 * JSON. Throws a plain Error (never crashes the caller) on malformed JSON —
 * this is untrusted external output, not a programming error.
 */
export function extractJsonFromModelText(rawText: string | null | undefined): unknown {
  if (!rawText || rawText.trim() === "") {
    throw new Error("model returned an empty response");
  }
  const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("model response was not valid JSON");
  }
}

/** Parses + validates in one step. Throws AiSchemaValidationError on failure. */
export function validateAiExtraction(parsed: unknown): ValidatedAiExtraction {
  const result = AiExtractionSchema.safeParse(parsed);
  if (!result.success) {
    throw new AiSchemaValidationError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return result.data;
}
