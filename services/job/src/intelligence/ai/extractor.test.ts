import { describe, it, expect } from "vitest";
import { extractWithAi, AiExtractionError } from "./extractor.js";
import type { AiExtractionProvider, AiProviderInput } from "./provider.js";

const VALID_JSON = JSON.stringify({
  responsibilities: [{ text: "Design distributed services." }],
  requirements: [{ text: "3+ years of Go experience.", level: "required" }],
  summary: "Backend engineering role.",
});

function fakeProvider(behavior: (input: AiProviderInput) => Promise<string>): AiExtractionProvider {
  return { name: "fake", generate: behavior };
}

const INPUT: AiProviderInput = { title: "Backend Engineer", companyName: "Acme", description: "Build things." };

describe("extractWithAi", () => {
  it("returns validated output for a well-formed response", async () => {
    const provider = fakeProvider(async () => VALID_JSON);
    const result = await extractWithAi(provider, INPUT, 5000);
    expect(result.summary).toBe("Backend engineering role.");
  });

  it("classifies a provider timeout as retryable", async () => {
    const provider = fakeProvider(() => new Promise((resolve) => setTimeout(() => resolve(VALID_JSON), 200)));
    await expect(extractWithAi(provider, INPUT, 20)).rejects.toMatchObject({
      reason: "timeout",
      retryable: true,
    });
  });

  it("classifies a provider network/API failure as retryable", async () => {
    const provider = fakeProvider(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(extractWithAi(provider, INPUT, 5000)).rejects.toMatchObject({
      reason: "provider_failure",
      retryable: true,
    });
  });

  it("classifies malformed JSON as retryable", async () => {
    const provider = fakeProvider(async () => "{not valid json");
    await expect(extractWithAi(provider, INPUT, 5000)).rejects.toMatchObject({
      reason: "invalid_json",
      retryable: true,
    });
  });

  it("classifies schema validation failure as NOT retryable", async () => {
    const provider = fakeProvider(async () => JSON.stringify({ wrong: "shape" }));
    await expect(extractWithAi(provider, INPUT, 5000)).rejects.toMatchObject({
      reason: "schema_validation_failed",
      retryable: false,
    });
  });

  it("classifies an empty response (model refusal) as retryable", async () => {
    const provider = fakeProvider(async () => "");
    await expect(extractWithAi(provider, INPUT, 5000)).rejects.toMatchObject({
      reason: "invalid_json",
      retryable: true,
    });
  });

  it("throws AiExtractionError instances (not bare Error)", async () => {
    const provider = fakeProvider(async () => {
      throw new Error("boom");
    });
    await expect(extractWithAi(provider, INPUT, 5000)).rejects.toBeInstanceOf(AiExtractionError);
  });

  it("never throws an unclassified error type", async () => {
    const provider = fakeProvider(async () => JSON.stringify({ responsibilities: [], requirements: [], summary: "x".repeat(1000) }));
    try {
      await extractWithAi(provider, INPUT, 5000);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AiExtractionError);
      expect((error as AiExtractionError).reason).toBe("schema_validation_failed");
    }
  });
});
