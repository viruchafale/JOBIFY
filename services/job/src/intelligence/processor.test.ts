/**
 * Phase 8 — processJobIntelligence() integration tests against an
 * in-memory fake DB that replicates repository.ts's query semantics
 * exactly (same pattern as Phase 3/6's fake-DB test harnesses).
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { SqlClient } from "../ingestion/repository.js";
import { processJobIntelligence } from "./processor.js";
import type { IntelligenceConfig } from "./config.js";
import type { AiExtractionProvider } from "./ai/provider.js";
import type { SkillTaxonomyEntry } from "./extractors/skills.js";

const TAXONOMY: SkillTaxonomyEntry[] = [
  { skillId: 1, canonicalName: "Go", category: "programming_language", skillType: "technical", aliases: [{ alias: "Go", caseSensitive: true }] },
  { skillId: 2, canonicalName: "PostgreSQL", category: "database", skillType: "technical", aliases: [{ alias: "PostgreSQL", caseSensitive: false }] },
];

interface FakeJobRow {
  id: number;
  source: string;
  title: string | null;
  description: string | null;
  content_fingerprint: string;
  job_type: string | null;
  work_location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  raw_payload: unknown;
}

function createFakeDb(jobs: FakeJobRow[]) {
  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  const intelligence = new Map<string, Record<string, any>>();
  const skills: Record<string, any>[] = [];
  const responsibilities: Record<string, any>[] = [];
  const requirements: Record<string, any>[] = [];
  let nextId = 1;

  const key = (externalJobId: number, extractorVersion: string) => `${externalJobId}:${extractorVersion}`;

  const query = async (text: string, params: unknown[] = []): Promise<Record<string, any>[]> => {
    if (text.includes("intelligence:loadJob")) {
      const job = jobsById.get(params[0] as number);
      return job ? [job] : [];
    }
    if (text.includes("intelligence:loadTaxonomy")) return []; // tests inject taxonomy directly
    if (text.includes("intelligence:findExisting")) {
      const row = intelligence.get(key(params[0] as number, params[1] as string));
      return row ? [{ id: row.id, content_fingerprint: row.content_fingerprint, status: row.status }] : [];
    }
    if (text.includes("intelligence:beginProcessing")) {
      const [externalJobId, extractorVersion, contentFingerprint] = params as [number, string, string];
      const k = key(externalJobId, extractorVersion);
      let row = intelligence.get(k);
      if (!row) {
        row = { id: nextId++, external_job_id: externalJobId, extractor_version: extractorVersion, content_fingerprint: contentFingerprint, status: "processing", attempt_count: 1 };
        intelligence.set(k, row);
      } else {
        row.status = "processing";
        row.content_fingerprint = contentFingerprint;
        row.attempt_count += 1;
      }
      return [{ id: row.id }];
    }
    if (text.includes("intelligence:complete")) {
      const [id, seniority, seniorityEvidence, minExp, maxExp, expEvidence, eduLevel, eduEvidence, employmentType, workArrangement, salaryMin, salaryMax, salaryCurrency, summary, summarySource, status, lastError] = params;
      const row = [...intelligence.values()].find((r) => r.id === id);
      if (row) Object.assign(row, { seniority, seniority_evidence: seniorityEvidence, min_experience_years: minExp, max_experience_years: maxExp, experience_evidence: expEvidence, education_level: eduLevel, education_evidence: eduEvidence, employment_type: employmentType, work_arrangement: workArrangement, salary_min: salaryMin, salary_max: salaryMax, salary_currency: salaryCurrency, summary, summary_source: summarySource, status, last_error: lastError, processed_at: new Date().toISOString() });
      return [];
    }
    if (text.includes("intelligence:markFailed")) {
      const [id, status, error] = params as [number, string, string];
      const row = [...intelligence.values()].find((r) => r.id === id);
      if (row) Object.assign(row, { status, last_error: error });
      return [];
    }
    if (text.includes("intelligence:deleteSkills")) {
      const idx = skills.findIndex((s) => s.job_intelligence_id === params[0]);
      while (idx !== -1 && skills.some((s) => s.job_intelligence_id === params[0])) {
        const i = skills.findIndex((s) => s.job_intelligence_id === params[0]);
        skills.splice(i, 1);
      }
      return [];
    }
    if (text.includes("intelligence:insertSkill")) {
      skills.push({ job_intelligence_id: params[0], skill_id: params[1], requirement_level: params[2], source: params[3], confidence: params[4], evidence: params[5] });
      return [];
    }
    if (text.includes("intelligence:deleteResp")) {
      let i;
      while ((i = responsibilities.findIndex((r) => r.job_intelligence_id === params[0])) !== -1) responsibilities.splice(i, 1);
      return [];
    }
    if (text.includes("intelligence:insertResp")) {
      responsibilities.push({ job_intelligence_id: params[0], position: params[1], text: params[2], source: params[3], confidence: params[4] });
      return [];
    }
    if (text.includes("intelligence:deleteReq")) {
      let i;
      while ((i = requirements.findIndex((r) => r.job_intelligence_id === params[0])) !== -1) requirements.splice(i, 1);
      return [];
    }
    if (text.includes("intelligence:insertReq")) {
      requirements.push({ job_intelligence_id: params[0], position: params[1], text: params[2], requirement_level: params[3], source: params[4], confidence: params[5] });
      return [];
    }
    throw new Error(`FakeDb: unhandled query: ${text.slice(0, 80)}`);
  };

  return { query, jobsById, intelligence, skills, responsibilities, requirements } as unknown as SqlClient & {
    intelligence: Map<string, Record<string, any>>;
    skills: Record<string, any>[];
    responsibilities: Record<string, any>[];
    requirements: Record<string, any>[];
  };
}

function baseJob(overrides: Partial<FakeJobRow> = {}): FakeJobRow {
  return {
    id: 1,
    source: "greenhouse",
    title: "Senior Backend Engineer",
    description: "We build distributed systems with Go and PostgreSQL. 3+ years of experience required.",
    content_fingerprint: "fp-1",
    job_type: "Full-time",
    work_location: "Remote",
    salary_min: 150000,
    salary_max: 190000,
    salary_currency: "USD",
    raw_payload: { content: "<p>Requirements</p><ul><li>3+ years of Go experience.</li></ul>" },
    ...overrides,
  };
}

const disabledAiConfig: IntelligenceConfig = {
  aiEnabled: false,
  geminiApiKey: null,
  geminiModel: "gemini-3-flash-preview",
  maxDescriptionLength: 20000,
  batchSize: 20,
  maxConcurrency: 2,
  aiTimeoutMs: 5000,
  workerIntervalMs: 60000,
};

describe("processJobIntelligence", () => {
  it("processes a job deterministically and persists seniority/experience/skills", async () => {
    const db = createFakeDb([baseJob()]);
    const result = await processJobIntelligence(db, 1, { config: disabledAiConfig, taxonomy: TAXONOMY });

    expect(result.status).toBe("completed");
    expect(result.skipped).toBe(false);
    expect(result.skillCount).toBeGreaterThan(0);

    const row = db.intelligence.get("1:1.0");
    expect(row?.seniority).toBe("senior");
    expect(row?.min_experience_years).toBe(3);
    expect(row?.employment_type).toBe("Full-time");
    expect(row?.work_arrangement).toBe("Remote");
    expect(row?.salary_min).toBe(150000);

    const goSkill = db.skills.find((s) => s.skill_id === 1);
    expect(goSkill?.requirement_level).toBe("required"); // from the Requirements section in raw_payload
  });

  it("throws a clear error for a job that doesn't exist", async () => {
    const db = createFakeDb([]);
    await expect(processJobIntelligence(db, 999, { config: disabledAiConfig, taxonomy: TAXONOMY })).rejects.toThrow(
      /999/,
    );
  });

  it("is idempotent: reprocessing an unchanged job is skipped", async () => {
    const db = createFakeDb([baseJob()]);
    const first = await processJobIntelligence(db, 1, { config: disabledAiConfig, taxonomy: TAXONOMY });
    expect(first.skipped).toBe(false);

    const second = await processJobIntelligence(db, 1, { config: disabledAiConfig, taxonomy: TAXONOMY });
    expect(second.skipped).toBe(true);
    expect(second.jobIntelligenceId).toBe(first.jobIntelligenceId);
    expect(db.intelligence.get("1:1.0")?.attempt_count).toBe(1); // no second attempt was made
  });

  it("reprocesses when the job's content_fingerprint changes", async () => {
    const job = baseJob();
    const db = createFakeDb([job]);
    await processJobIntelligence(db, 1, { config: disabledAiConfig, taxonomy: TAXONOMY });

    job.content_fingerprint = "fp-2"; // simulate the job's normalized content changing
    job.title = "Staff Backend Engineer";
    const result = await processJobIntelligence(db, 1, { config: disabledAiConfig, taxonomy: TAXONOMY });

    expect(result.skipped).toBe(false);
    expect(db.intelligence.get("1:1.0")?.seniority).toBe("staff");
    expect(db.intelligence.get("1:1.0")?.attempt_count).toBe(2);
  });

  it("reprocesses when force=true even if nothing changed", async () => {
    const db = createFakeDb([baseJob()]);
    await processJobIntelligence(db, 1, { config: disabledAiConfig, taxonomy: TAXONOMY });
    const result = await processJobIntelligence(db, 1, { config: disabledAiConfig, taxonomy: TAXONOMY, force: true });
    expect(result.skipped).toBe(false);
    expect(db.intelligence.get("1:1.0")?.attempt_count).toBe(2);
  });

  it("does not create duplicate skill/responsibility/requirement rows on reprocess", async () => {
    const job = baseJob();
    const db = createFakeDb([job]);
    await processJobIntelligence(db, 1, { config: disabledAiConfig, taxonomy: TAXONOMY });
    job.content_fingerprint = "fp-2";
    await processJobIntelligence(db, 1, { config: disabledAiConfig, taxonomy: TAXONOMY });

    const goSkillRows = db.skills.filter((s) => s.job_intelligence_id === 1 && s.skill_id === 1);
    expect(goSkillRows).toHaveLength(1); // replaced, not duplicated
  });

  it("never fabricates experience/education when the description has no explicit statement", async () => {
    const db = createFakeDb([
      baseJob({ description: "We are a great company doing great things.", title: "Software Engineer", raw_payload: {} }),
    ]);
    await processJobIntelligence(db, 1, { config: disabledAiConfig, taxonomy: TAXONOMY });
    const row = db.intelligence.get("1:1.0");
    expect(row?.min_experience_years).toBeNull();
    expect(row?.education_level).toBe("unspecified");
    expect(row?.seniority).toBe("unknown");
  });

  describe("AI integration", () => {
    function fakeProvider(behavior: () => Promise<string>): AiExtractionProvider {
      return { name: "fake", generate: behavior };
    }
    const aiConfig: IntelligenceConfig = { ...disabledAiConfig, aiEnabled: true, geminiApiKey: "fake-key" };

    it("does not call AI when deterministic extraction already found responsibilities and requirements", async () => {
      let called = false;
      const provider = fakeProvider(async () => {
        called = true;
        return "{}";
      });
      const db = createFakeDb([
        baseJob({
          raw_payload: {
            content:
              "<p>Responsibilities</p><ul><li>Build things.</li></ul><p>Requirements</p><ul><li>3+ years of Go experience.</li></ul>",
          },
        }),
      ]);
      const result = await processJobIntelligence(db, 1, { config: aiConfig, taxonomy: TAXONOMY, aiProvider: provider });
      expect(called).toBe(false);
      expect(result.aiAttempted).toBe(false);
    });

    it("calls AI when deterministic extraction found no responsibilities/requirements, and persists its output", async () => {
      const provider = fakeProvider(async () =>
        JSON.stringify({
          responsibilities: [{ text: "Design distributed services." }],
          requirements: [{ text: "3+ years of Go experience.", level: "required" }],
          summary: "A backend role focused on distributed systems.",
        }),
      );
      const db = createFakeDb([baseJob({ raw_payload: { content: "<p>No recognizable sections here.</p>" } })]);
      const result = await processJobIntelligence(db, 1, { config: aiConfig, taxonomy: TAXONOMY, aiProvider: provider });

      expect(result.aiAttempted).toBe(true);
      expect(result.aiSucceeded).toBe(true);
      expect(result.status).toBe("completed");
      expect(db.intelligence.get("1:1.0")?.summary).toBe("A backend role focused on distributed systems.");
      expect(db.intelligence.get("1:1.0")?.summary_source).toBe("ai");
      expect(db.requirements.some((r) => r.text === "3+ years of Go experience." && r.source === "ai")).toBe(true);
    });

    it("keeps the job's deterministic fields even when AI extraction fails (job is never lost)", async () => {
      const provider = fakeProvider(async () => {
        throw new Error("ECONNRESET");
      });
      const db = createFakeDb([baseJob({ raw_payload: { content: "<p>No recognizable sections here.</p>" } })]);
      const result = await processJobIntelligence(db, 1, { config: aiConfig, taxonomy: TAXONOMY, aiProvider: provider });

      expect(result.status).toBe("retryable_failed"); // network failure -> transient
      const row = db.intelligence.get("1:1.0");
      expect(row?.seniority).toBe("senior"); // deterministic fields still persisted
      expect(row?.last_error).toMatch(/ECONNRESET/);
    });

    it("marks status 'failed' (not retryable) when AI output fails schema validation", async () => {
      const provider = fakeProvider(async () => JSON.stringify({ wrong: "shape" }));
      const db = createFakeDb([baseJob({ raw_payload: { content: "<p>No recognizable sections here.</p>" } })]);
      const result = await processJobIntelligence(db, 1, { config: aiConfig, taxonomy: TAXONOMY, aiProvider: provider });

      expect(result.status).toBe("failed");
    });

    it("a job is never dropped/deleted after an AI failure — it remains queryable with its row intact", async () => {
      const provider = fakeProvider(async () => {
        throw new Error("rate limited");
      });
      const db = createFakeDb([baseJob({ raw_payload: {} })]);
      await processJobIntelligence(db, 1, { config: aiConfig, taxonomy: TAXONOMY, aiProvider: provider });
      expect(db.intelligence.has("1:1.0")).toBe(true);
    });
  });

  describe("failure isolation", () => {
    it("an unexpected exception mid-processing marks the row failed without throwing to the caller silently losing state", async () => {
      const db = createFakeDb([baseJob()]);
      // Force an internal failure by pointing taxonomy loading to throw via a broken db after beginProcessing.
      const brokenDb: SqlClient = {
        query: async (text: string, params: unknown[] = []) => {
          if (text.includes("intelligence:beginProcessing")) return db.query(text, params);
          if (text.includes("intelligence:loadJob")) return db.query(text, params);
          if (text.includes("intelligence:findExisting")) return db.query(text, params);
          if (text.includes("intelligence:markFailed")) return db.query(text, params);
          throw new Error("simulated database failure");
        },
      };
      const result = await processJobIntelligence(brokenDb, 1, { config: disabledAiConfig, taxonomy: TAXONOMY });
      expect(result.status).toBe("failed");
    });
  });
});
