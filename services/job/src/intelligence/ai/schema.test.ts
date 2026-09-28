import { describe, it, expect } from "vitest";
import { extractJsonFromModelText, validateAiExtraction, AiSchemaValidationError } from "./schema.js";

const VALID = {
  responsibilities: [{ text: "Design distributed services." }],
  requirements: [{ text: "3+ years of Go experience.", level: "required" }],
  summary: "Backend engineering role focused on distributed systems.",
};

describe("extractJsonFromModelText", () => {
  it("parses plain JSON", () => {
    expect(extractJsonFromModelText(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("strips markdown code fences", () => {
    const wrapped = "```json\n" + JSON.stringify(VALID) + "\n```";
    expect(extractJsonFromModelText(wrapped)).toEqual(VALID);
  });

  it("throws a plain Error for malformed JSON", () => {
    expect(() => extractJsonFromModelText("{not valid json")).toThrow(/not valid JSON/);
  });

  it("throws for an empty response (model refusal / empty completion)", () => {
    expect(() => extractJsonFromModelText("")).toThrow(/empty response/);
    expect(() => extractJsonFromModelText(null)).toThrow(/empty response/);
    expect(() => extractJsonFromModelText(undefined)).toThrow(/empty response/);
  });

  it("throws for a model refusal wrapped as prose, not JSON", () => {
    expect(() => extractJsonFromModelText("I cannot assist with that request.")).toThrow(/not valid JSON/);
  });
});

describe("validateAiExtraction", () => {
  it("accepts valid output", () => {
    expect(() => validateAiExtraction(VALID)).not.toThrow();
  });

  it("rejects a missing required field", () => {
    const { summary, ...missingSummary } = VALID;
    expect(() => validateAiExtraction(missingSummary)).toThrow(AiSchemaValidationError);
  });

  it("rejects an unexpected top-level field (strict schema)", () => {
    expect(() => validateAiExtraction({ ...VALID, systemPrompt: "leaked" })).toThrow(AiSchemaValidationError);
  });

  it("rejects an unexpected field inside a requirement item", () => {
    const malformed = { ...VALID, requirements: [{ text: "x", level: "required", extra: "field" }] };
    expect(() => validateAiExtraction(malformed)).toThrow(AiSchemaValidationError);
  });

  it("rejects an invalid enum value for requirement level", () => {
    const malformed = { ...VALID, requirements: [{ text: "x", level: "nice-to-have" }] };
    expect(() => validateAiExtraction(malformed)).toThrow(AiSchemaValidationError);
  });

  it("rejects an oversized summary", () => {
    const malformed = { ...VALID, summary: "x".repeat(1000) };
    expect(() => validateAiExtraction(malformed)).toThrow(AiSchemaValidationError);
  });

  it("rejects an oversized requirement/responsibility text", () => {
    const malformed = { ...VALID, requirements: [{ text: "x".repeat(1000), level: "required" }] };
    expect(() => validateAiExtraction(malformed)).toThrow(AiSchemaValidationError);
  });

  it("rejects an empty-string summary", () => {
    expect(() => validateAiExtraction({ ...VALID, summary: "" })).toThrow(AiSchemaValidationError);
  });

  it("rejects too many responsibilities/requirements (oversized array)", () => {
    const tooMany = Array.from({ length: 50 }, () => ({ text: "x" }));
    expect(() => validateAiExtraction({ ...VALID, responsibilities: tooMany })).toThrow(AiSchemaValidationError);
  });

  it("rejects a completely wrong shape (e.g. a bare array or string)", () => {
    expect(() => validateAiExtraction([1, 2, 3])).toThrow(AiSchemaValidationError);
    expect(() => validateAiExtraction("just a string")).toThrow(AiSchemaValidationError);
    expect(() => validateAiExtraction(null)).toThrow(AiSchemaValidationError);
  });

  it("rejects wrong types (e.g. numeric text field)", () => {
    expect(() => validateAiExtraction({ ...VALID, responsibilities: [{ text: 12345 }] })).toThrow(
      AiSchemaValidationError,
    );
  });

  it("accepts empty arrays for responsibilities/requirements (model found none)", () => {
    expect(() => validateAiExtraction({ responsibilities: [], requirements: [], summary: "A role." })).not.toThrow();
  });
});
