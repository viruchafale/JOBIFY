/**
 * Phase 6 — Error classification + backoff tests. Pure functions, no timers.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { classifyIngestionError, computeBackoffDelayMs, isRetryableClass } from "./retry.js";

describe("classifyIngestionError", () => {
  it("classifies null/undefined as unknown", () => {
    expect(classifyIngestionError(null)).toBe("unknown");
    expect(classifyIngestionError(undefined)).toBe("unknown");
  });

  it.each(["HTTP 429", "HTTP 500", "HTTP 502", "HTTP 503", "HTTP 504"])(
    "classifies %s as retryable",
    (message) => {
      expect(classifyIngestionError(`fetch_failed: ${message} error`)).toBe("retryable");
    },
  );

  it.each(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "request timed out after 10000ms", "socket hang up"])(
    "classifies network error %s as retryable",
    (message) => {
      expect(classifyIngestionError(message)).toBe("retryable");
    },
  );

  it.each(["HTTP 400", "HTTP 401", "HTTP 403", "HTTP 404"])(
    "classifies %s as permanent",
    (message) => {
      expect(classifyIngestionError(`Greenhouse API rejected the request (${message})`)).toBe("permanent");
    },
  );

  it("classifies malformed responses as permanent", () => {
    expect(classifyIngestionError("malformed response: expected an object with a 'jobs' array")).toBe(
      "permanent",
    );
  });

  it("classifies missing/invalid configuration as configuration", () => {
    expect(classifyIngestionError("LeverAdapter: no companies configured. Set LEVER_COMPANIES...")).toBe(
      "configuration",
    );
    expect(classifyIngestionError("invalid company configuration (empty slug)")).toBe("configuration");
  });

  it("classifies an unrecognized message as unknown", () => {
    expect(classifyIngestionError("something completely unexpected happened")).toBe("unknown");
  });

  it("prioritizes retryable (429) over permanent (4xx) when a message could match both patterns", () => {
    expect(classifyIngestionError("Lever API rejected the request (HTTP 429)")).toBe("retryable");
  });
});

describe("isRetryableClass", () => {
  it("is true only for 'retryable'", () => {
    expect(isRetryableClass("retryable")).toBe(true);
    expect(isRetryableClass("permanent")).toBe(false);
    expect(isRetryableClass("configuration")).toBe(false);
    expect(isRetryableClass("unknown")).toBe(false);
  });
});

describe("computeBackoffDelayMs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("grows exponentially with attempt, before hitting the cap", () => {
    vi.spyOn(Math, "random").mockReturnValue(1); // upper bound of jitter each time
    expect(computeBackoffDelayMs(1, 1000, 30000)).toBe(1000); // cap=1000, half=500, +500*1=1000
    expect(computeBackoffDelayMs(2, 1000, 30000)).toBe(2000); // cap=2000
    expect(computeBackoffDelayMs(3, 1000, 30000)).toBe(4000); // cap=4000
  });

  it("never exceeds maxDelayMs", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(computeBackoffDelayMs(10, 1000, 30000)).toBe(30000);
  });

  it("jitter is bounded between half the cap and the cap", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const lower = computeBackoffDelayMs(3, 1000, 30000); // cap=4000 -> lower bound 2000
    expect(lower).toBe(2000);

    vi.spyOn(Math, "random").mockReturnValue(1);
    const upper = computeBackoffDelayMs(3, 1000, 30000);
    expect(upper).toBe(4000);
  });

  it("is always non-negative and an integer", () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const delay = computeBackoffDelayMs(attempt, 1000, 30000);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(delay)).toBe(true);
    }
  });
});
