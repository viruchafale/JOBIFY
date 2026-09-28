/**
 * Phase 7 — Search parameter validation + query-building tests.
 *
 * Validation tests exercise parseExternalJobSearchParams() directly (pure,
 * no DB). Query-building tests exercise searchExternalJobs() against an
 * in-memory fake DB that records the exact SQL text + params it was called
 * with, so WHERE/ORDER BY/params construction is verified without a real
 * database (real-Postgres verification — including EXPLAIN — is covered in
 * the Phase 7 implementation report).
 */

import { describe, it, expect } from "vitest";
import type { SqlClient } from "./repository.js";
import { parseExternalJobSearchParams, searchExternalJobs } from "./search.js";

const KNOWN_SOURCES = ["fixture", "lever", "greenhouse", "ashby"];

describe("parseExternalJobSearchParams", () => {
  it("applies defaults with no params", () => {
    const params = parseExternalJobSearchParams({}, KNOWN_SOURCES);
    expect(params.page).toBe(1);
    expect(params.limit).toBe(20);
    expect(params.active).toBe(true);
    expect(params.sort).toBe("newest"); // no q -> newest, not relevance
    expect(params.q).toBeUndefined();
  });

  it("accepts a valid q and defaults sort to relevance", () => {
    const params = parseExternalJobSearchParams({ q: "backend engineer" }, KNOWN_SOURCES);
    expect(params.q).toBe("backend engineer");
    expect(params.sort).toBe("relevance");
  });

  it("treats an empty/whitespace-only q as no query", () => {
    const params = parseExternalJobSearchParams({ q: "   " }, KNOWN_SOURCES);
    expect(params.q).toBeUndefined();
    expect(params.sort).toBe("newest");
  });

  it("rejects an oversized q", () => {
    expect(() => parseExternalJobSearchParams({ q: "a".repeat(201) }, KNOWN_SOURCES)).toThrow(
      /at most 200 characters/,
    );
  });

  it("rejects a negative page", () => {
    expect(() => parseExternalJobSearchParams({ page: "-1" }, KNOWN_SOURCES)).toThrow(/'page'/);
  });

  it("rejects a zero page", () => {
    expect(() => parseExternalJobSearchParams({ page: "0" }, KNOWN_SOURCES)).toThrow(/'page'/);
  });

  it("rejects a non-integer page", () => {
    expect(() => parseExternalJobSearchParams({ page: "1.5" }, KNOWN_SOURCES)).toThrow(/'page'/);
  });

  it("rejects a negative or zero limit", () => {
    expect(() => parseExternalJobSearchParams({ limit: "0" }, KNOWN_SOURCES)).toThrow(/'limit'/);
    expect(() => parseExternalJobSearchParams({ limit: "-5" }, KNOWN_SOURCES)).toThrow(/'limit'/);
  });

  it("rejects a limit above the maximum", () => {
    expect(() => parseExternalJobSearchParams({ limit: "1000000" }, KNOWN_SOURCES)).toThrow(/'limit'/);
    expect(() => parseExternalJobSearchParams({ limit: "101" }, KNOWN_SOURCES)).toThrow(/'limit'/);
  });

  it("accepts the maximum limit", () => {
    const params = parseExternalJobSearchParams({ limit: "100" }, KNOWN_SOURCES);
    expect(params.limit).toBe(100);
  });

  it("rejects an invalid salary", () => {
    expect(() => parseExternalJobSearchParams({ minSalary: "not-a-number" }, KNOWN_SOURCES)).toThrow(
      /'minSalary'/,
    );
    expect(() => parseExternalJobSearchParams({ minSalary: "-100" }, KNOWN_SOURCES)).toThrow(/'minSalary'/);
  });

  it("rejects minSalary > maxSalary", () => {
    expect(() =>
      parseExternalJobSearchParams({ minSalary: "200000", maxSalary: "100000" }, KNOWN_SOURCES),
    ).toThrow(/salary range/);
  });

  it("accepts a valid salary range", () => {
    const params = parseExternalJobSearchParams({ minSalary: "80000", maxSalary: "150000" }, KNOWN_SOURCES);
    expect(params.minSalary).toBe(80000);
    expect(params.maxSalary).toBe(150000);
  });

  it("rejects an invalid date", () => {
    expect(() => parseExternalJobSearchParams({ postedAfter: "not-a-date" }, KNOWN_SOURCES)).toThrow(
      /'postedAfter'/,
    );
  });

  it("rejects postedAfter > postedBefore", () => {
    expect(() =>
      parseExternalJobSearchParams(
        { postedAfter: "2026-09-24", postedBefore: "2026-09-01" },
        KNOWN_SOURCES,
      ),
    ).toThrow(/date range/);
  });

  it("accepts a valid date range", () => {
    const params = parseExternalJobSearchParams(
      { postedAfter: "2026-09-01", postedBefore: "2026-09-24" },
      KNOWN_SOURCES,
    );
    expect(params.postedAfter).toBe(new Date("2026-09-01").toISOString());
  });

  it("rejects an invalid sort", () => {
    expect(() => parseExternalJobSearchParams({ sort: "banana" }, KNOWN_SOURCES)).toThrow(/'sort'/);
  });

  it("accepts every valid sort value", () => {
    for (const sort of ["relevance", "newest", "oldest", "salary_high", "salary_low"]) {
      const params = parseExternalJobSearchParams({ q: "x", sort }, KNOWN_SOURCES);
      expect(params.sort).toBe(sort);
    }
  });

  it("falls back from relevance to newest when sort=relevance but q is absent", () => {
    const params = parseExternalJobSearchParams({ sort: "relevance" }, KNOWN_SOURCES);
    expect(params.sort).toBe("newest");
  });

  it("rejects a malformed boolean for active", () => {
    expect(() => parseExternalJobSearchParams({ active: "yes" }, KNOWN_SOURCES)).toThrow(/'active'/);
  });

  it("accepts active=true and active=false", () => {
    expect(parseExternalJobSearchParams({ active: "true" }, KNOWN_SOURCES).active).toBe(true);
    expect(parseExternalJobSearchParams({ active: "false" }, KNOWN_SOURCES).active).toBe(false);
  });

  it("rejects an unknown source", () => {
    expect(() => parseExternalJobSearchParams({ source: "workday" }, KNOWN_SOURCES)).toThrow(
      /unknown source "workday"/,
    );
  });

  it("accepts a single known source", () => {
    const params = parseExternalJobSearchParams({ source: "lever" }, KNOWN_SOURCES);
    expect(params.source).toEqual(["lever"]);
  });

  it("accepts a comma-separated list of known sources", () => {
    const params = parseExternalJobSearchParams({ source: "lever,greenhouse" }, KNOWN_SOURCES);
    expect(params.source).toEqual(["lever", "greenhouse"]);
  });

  it("rejects an invalid jobType (not a recognized enum value)", () => {
    expect(() => parseExternalJobSearchParams({ jobType: "banana-time" }, KNOWN_SOURCES)).toThrow(
      /'jobType'/,
    );
  });

  it("normalizes jobType to the canonical stored value", () => {
    const params = parseExternalJobSearchParams({ jobType: "full-time" }, KNOWN_SOURCES);
    expect(params.jobType).toBe("Full-time");
    const params2 = parseExternalJobSearchParams({ jobType: "FULL TIME" }, KNOWN_SOURCES);
    expect(params2.jobType).toBe("Full-time");
  });

  it("rejects an invalid workLocation", () => {
    expect(() => parseExternalJobSearchParams({ workLocation: "outer-space" }, KNOWN_SOURCES)).toThrow(
      /'workLocation'/,
    );
  });

  it("normalizes workLocation to the canonical stored value", () => {
    const params = parseExternalJobSearchParams({ workLocation: "remote" }, KNOWN_SOURCES);
    expect(params.workLocation).toBe("Remote");
  });

  it("trims and ignores empty text filters", () => {
    const params = parseExternalJobSearchParams({ location: "  ", company: "" }, KNOWN_SOURCES);
    expect(params.location).toBeUndefined();
    expect(params.company).toBeUndefined();
  });

  it("rejects an oversized text filter", () => {
    expect(() => parseExternalJobSearchParams({ location: "a".repeat(201) }, KNOWN_SOURCES)).toThrow(
      /'location'/,
    );
  });
});

// ---------------------------------------------------------------------------
// Query-building tests against a fake DB that just records calls.
// ---------------------------------------------------------------------------
function createRecordingDb(rows: Record<string, any>[] = []): SqlClient & { calls: { text: string; params: unknown[] }[] } {
  const calls: { text: string; params: unknown[] }[] = [];
  const query = async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (text.includes("search:count")) return [{ total: rows.length }];
    if (text.includes("search:select")) return rows;
    throw new Error(`unexpected query: ${text}`);
  };
  return { query, calls };
}

describe("searchExternalJobs (query construction)", () => {
  it("always filters by is_active (default true)", async () => {
    const db = createRecordingDb([{ id: 1 }]);
    const params = parseExternalJobSearchParams({}, KNOWN_SOURCES);
    await searchExternalJobs(db, params);
    const countCall = db.calls.find((c) => c.text.includes("search:count"))!;
    expect(countCall.text).toContain("is_active = $1");
    expect(countCall.params[0]).toBe(true);
  });

  it("combines q + location + workLocation + source with AND semantics", async () => {
    const db = createRecordingDb([{ id: 1 }]);
    const params = parseExternalJobSearchParams(
      { q: "backend engineer", location: "India", workLocation: "remote", source: "lever" },
      KNOWN_SOURCES,
    );
    await searchExternalJobs(db, params);
    const countCall = db.calls.find((c) => c.text.includes("search:count"))!;
    expect(countCall.text).toMatch(/is_active = \$1 AND search_vector @@ websearch_to_tsquery\('english', \$2\) AND location ILIKE \$3.*AND source = ANY\(\$4::text\[\]\).*AND work_location = \$5/s);
    expect(countCall.params).toEqual([true, "backend engineer", "%India%", ["lever"], "Remote"]);
  });

  it("uses ts_rank for ORDER BY when sort=relevance, reusing the q value", async () => {
    const db = createRecordingDb([{ id: 1 }]);
    const params = parseExternalJobSearchParams({ q: "backend" }, KNOWN_SOURCES);
    await searchExternalJobs(db, params);
    const selectCall = db.calls.find((c) => c.text.includes("search:select"))!;
    expect(selectCall.text).toContain("ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', $3)) DESC, id DESC");
    // params: [active, q, q-again-for-rank, limit, offset]
    expect(selectCall.params).toEqual([true, "backend", "backend", 20, 0]);
  });

  it("orders by posted_at DESC NULLS LAST for sort=newest", async () => {
    const db = createRecordingDb([{ id: 1 }]);
    const params = parseExternalJobSearchParams({ sort: "newest" }, KNOWN_SOURCES);
    await searchExternalJobs(db, params);
    const selectCall = db.calls.find((c) => c.text.includes("search:select"))!;
    expect(selectCall.text).toContain("ORDER BY posted_at DESC NULLS LAST, id DESC");
  });

  it("orders by posted_at ASC NULLS LAST for sort=oldest", async () => {
    const db = createRecordingDb([{ id: 1 }]);
    const params = parseExternalJobSearchParams({ sort: "oldest" }, KNOWN_SOURCES);
    await searchExternalJobs(db, params);
    const selectCall = db.calls.find((c) => c.text.includes("search:select"))!;
    expect(selectCall.text).toContain("ORDER BY posted_at ASC NULLS LAST, id ASC");
  });

  it("orders by salary_max DESC for sort=salary_high and salary_min ASC for sort=salary_low", async () => {
    const db1 = createRecordingDb([{ id: 1 }]);
    await searchExternalJobs(db1, parseExternalJobSearchParams({ sort: "salary_high" }, KNOWN_SOURCES));
    expect(db1.calls.find((c) => c.text.includes("search:select"))!.text).toContain(
      "ORDER BY salary_max DESC NULLS LAST, id DESC",
    );

    const db2 = createRecordingDb([{ id: 1 }]);
    await searchExternalJobs(db2, parseExternalJobSearchParams({ sort: "salary_low" }, KNOWN_SOURCES));
    expect(db2.calls.find((c) => c.text.includes("search:select"))!.text).toContain(
      "ORDER BY salary_min ASC NULLS LAST, id ASC",
    );
  });

  it("applies salary overlap semantics: minSalary against salary_max, maxSalary against salary_min", async () => {
    const db = createRecordingDb([{ id: 1 }]);
    const params = parseExternalJobSearchParams({ minSalary: "100000", maxSalary: "200000" }, KNOWN_SOURCES);
    await searchExternalJobs(db, params);
    const countCall = db.calls.find((c) => c.text.includes("search:count"))!;
    expect(countCall.text).toContain("salary_max >= $2");
    expect(countCall.text).toContain("salary_min <= $3");
    expect(countCall.params).toEqual([true, 100000, 200000]);
  });

  it("applies postedAfter/postedBefore against posted_at", async () => {
    const db = createRecordingDb([{ id: 1 }]);
    const params = parseExternalJobSearchParams(
      { postedAfter: "2026-09-01", postedBefore: "2026-09-24" },
      KNOWN_SOURCES,
    );
    await searchExternalJobs(db, params);
    const countCall = db.calls.find((c) => c.text.includes("search:count"))!;
    expect(countCall.text).toContain("posted_at >= $2::timestamptz");
    expect(countCall.text).toContain("posted_at <= $3::timestamptz");
  });

  it("paginates with LIMIT/OFFSET derived from page and limit", async () => {
    const db = createRecordingDb([{ id: 1 }]);
    const params = parseExternalJobSearchParams({ page: "3", limit: "10" }, KNOWN_SOURCES);
    await searchExternalJobs(db, params);
    const selectCall = db.calls.find((c) => c.text.includes("search:select"))!;
    const lastTwoParams = selectCall.params.slice(-2);
    expect(lastTwoParams).toEqual([10, 20]); // limit=10, offset=(3-1)*10=20
  });

  it("skips the SELECT entirely when the count is 0", async () => {
    const db = createRecordingDb([]); // count will report 0
    const params = parseExternalJobSearchParams({ q: "nonexistent-xyz" }, KNOWN_SOURCES);
    const result = await searchExternalJobs(db, params);
    expect(result).toEqual({ items: [], total: 0 });
    expect(db.calls.some((c) => c.text.includes("search:select"))).toBe(false);
  });

  it("returns items and total from a non-empty result", async () => {
    const db = createRecordingDb([{ id: 1, title: "Backend Engineer" }, { id: 2, title: "Backend Lead" }]);
    const result = await searchExternalJobs(db, parseExternalJobSearchParams({}, KNOWN_SOURCES));
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
  });
});
