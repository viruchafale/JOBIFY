/**
 * Phase 8 — Job Intelligence persistence layer.
 *
 * All SQL is parameterized. This module owns every intelligence write —
 * extractors never touch the database (same separation as Phase 3's
 * repository.ts for the ingestion pipeline).
 */

import type { SqlClient } from "../ingestion/repository.js";
import type {
  EducationLevel,
  IntelligenceStatus,
  JobIntelligenceRecord,
  RequirementItem,
  ResponsibilityItem,
  Seniority,
  SkillMatch,
} from "./types.js";
import type { SkillTaxonomyEntry } from "./extractors/skills.js";

export interface JobForIntelligence {
  id: number;
  source: string;
  title: string | null;
  description: string | null;
  contentFingerprint: string;
  jobType: string | null;
  workLocation: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  rawPayload: unknown;
}

export async function loadJobForIntelligence(db: SqlClient, externalJobId: number): Promise<JobForIntelligence | null> {
  const rows = await db.query(
    `/* intelligence:loadJob */ SELECT ej.id, ej.source, ej.title, ej.description, ej.content_fingerprint,
       ej.job_type, ej.work_location, ej.salary_min, ej.salary_max, ej.salary_currency,
       rej.raw_payload
     FROM external_jobs ej
     LEFT JOIN raw_external_jobs rej ON rej.id = ej.raw_job_id
     WHERE ej.id = $1
     LIMIT 1`,
    [externalJobId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    description: row.description,
    contentFingerprint: row.content_fingerprint,
    jobType: row.job_type,
    workLocation: row.work_location,
    salaryMin: row.salary_min === null ? null : Number(row.salary_min),
    salaryMax: row.salary_max === null ? null : Number(row.salary_max),
    salaryCurrency: row.salary_currency,
    rawPayload: row.raw_payload,
  };
}

/**
 * Keyset-paginated job ids for batch processing — never loads the whole
 * table into memory. By default only returns jobs that actually need work
 * (no completed row for the current extractor version, or the job changed
 * since it was last processed) so a periodic worker tick doesn't re-scan
 * already-done jobs; `includeUpToDate: true` (used by `--force` reprocess)
 * returns every active job regardless.
 */
export async function listPendingJobIds(
  db: SqlClient,
  afterId: number,
  limit: number,
  extractorVersion: string,
  includeUpToDate = false,
): Promise<number[]> {
  const pendingCondition = includeUpToDate
    ? ""
    : `AND (ji.id IS NULL OR ji.status != 'completed' OR ji.content_fingerprint != ej.content_fingerprint)`;
  const rows = await db.query(
    `/* intelligence:listPendingJobIds */ SELECT ej.id FROM external_jobs ej
     LEFT JOIN job_intelligence ji ON ji.external_job_id = ej.id AND ji.extractor_version = $3
     WHERE ej.id > $1 AND ej.is_active = true
     ${pendingCondition}
     ORDER BY ej.id ASC
     LIMIT $2`,
    [afterId, limit, extractorVersion],
  );
  return rows.map((r) => Number(r.id));
}

export async function loadSkillTaxonomy(db: SqlClient): Promise<SkillTaxonomyEntry[]> {
  const rows = await db.query(
    `/* intelligence:loadTaxonomy */ SELECT s.id AS skill_id, s.canonical_name, s.category, s.skill_type,
       a.alias, a.case_sensitive
     FROM job_skills s
     JOIN job_skill_aliases a ON a.skill_id = s.id
     ORDER BY s.id`,
  );
  const bySkill = new Map<number, SkillTaxonomyEntry>();
  for (const row of rows) {
    const skillId = Number(row.skill_id);
    let entry = bySkill.get(skillId);
    if (!entry) {
      entry = { skillId, canonicalName: row.canonical_name, category: row.category, skillType: row.skill_type, aliases: [] };
      bySkill.set(skillId, entry);
    }
    entry.aliases.push({ alias: row.alias, caseSensitive: row.case_sensitive });
  }
  return [...bySkill.values()];
}

export interface ExistingIntelligenceRow {
  id: number;
  contentFingerprint: string;
  status: IntelligenceStatus;
}

export async function findExistingIntelligence(
  db: SqlClient,
  externalJobId: number,
  extractorVersion: string,
): Promise<ExistingIntelligenceRow | null> {
  const rows = await db.query(
    `/* intelligence:findExisting */ SELECT id, content_fingerprint, status
     FROM job_intelligence WHERE external_job_id = $1 AND extractor_version = $2
     LIMIT 1`,
    [externalJobId, extractorVersion],
  );
  if (rows.length === 0) return null;
  return { id: rows[0].id, contentFingerprint: rows[0].content_fingerprint, status: rows[0].status };
}

/** Marks (or creates) the row as 'processing', bumping attempt_count. Returns its id. */
export async function beginProcessing(
  db: SqlClient,
  externalJobId: number,
  extractorVersion: string,
  contentFingerprint: string,
): Promise<number> {
  const rows = await db.query(
    `/* intelligence:beginProcessing */ INSERT INTO job_intelligence
       (external_job_id, extractor_version, content_fingerprint, status, attempt_count)
     VALUES ($1, $2, $3, 'processing', 1)
     ON CONFLICT (external_job_id, extractor_version) DO UPDATE
       SET status = 'processing',
           content_fingerprint = EXCLUDED.content_fingerprint,
           attempt_count = job_intelligence.attempt_count + 1,
           updated_at = NOW()
     RETURNING id`,
    [externalJobId, extractorVersion, contentFingerprint],
  );
  return Number(rows[0].id);
}

export interface CompleteIntelligenceInput {
  seniority: Seniority;
  seniorityEvidence: string | null;
  minExperienceYears: number | null;
  maxExperienceYears: number | null;
  experienceEvidence: string | null;
  educationLevel: EducationLevel;
  educationEvidence: string | null;
  employmentType: string | null;
  workArrangement: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  summary: string | null;
  summarySource: "ai" | null;
  status: IntelligenceStatus;
  lastError: string | null;
}

export async function completeProcessing(
  db: SqlClient,
  jobIntelligenceId: number,
  input: CompleteIntelligenceInput,
): Promise<void> {
  await db.query(
    `/* intelligence:complete */ UPDATE job_intelligence SET
       seniority = $2, seniority_evidence = $3,
       min_experience_years = $4, max_experience_years = $5, experience_evidence = $6,
       education_level = $7, education_evidence = $8,
       employment_type = $9, work_arrangement = $10,
       salary_min = $11, salary_max = $12, salary_currency = $13,
       summary = $14, summary_source = $15,
       status = $16, last_error = $17, processed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [
      jobIntelligenceId,
      input.seniority,
      input.seniorityEvidence,
      input.minExperienceYears,
      input.maxExperienceYears,
      input.experienceEvidence,
      input.educationLevel,
      input.educationEvidence,
      input.employmentType,
      input.workArrangement,
      input.salaryMin,
      input.salaryMax,
      input.salaryCurrency,
      input.summary,
      input.summarySource,
      input.status,
      input.lastError,
    ],
  );
}

export async function markFailed(db: SqlClient, jobIntelligenceId: number, status: IntelligenceStatus, error: string): Promise<void> {
  await db.query(
    `/* intelligence:markFailed */ UPDATE job_intelligence
     SET status = $2, last_error = $3, updated_at = NOW()
     WHERE id = $1`,
    [jobIntelligenceId, status, error.slice(0, 2000)],
  );
}

/** Replaces this job_intelligence's skill rows entirely (idempotent re-run). */
export async function replaceSkills(db: SqlClient, jobIntelligenceId: number, skills: SkillMatch[]): Promise<void> {
  await db.query(`/* intelligence:deleteSkills */ DELETE FROM job_intelligence_skills WHERE job_intelligence_id = $1`, [jobIntelligenceId]);
  for (const skill of skills) {
    await db.query(
      `/* intelligence:insertSkill */ INSERT INTO job_intelligence_skills
         (job_intelligence_id, skill_id, requirement_level, source, confidence, evidence)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (job_intelligence_id, skill_id) DO NOTHING`,
      [jobIntelligenceId, skill.skillId, skill.requirementLevel, skill.source, skill.confidence, skill.evidence],
    );
  }
}

export async function replaceResponsibilities(db: SqlClient, jobIntelligenceId: number, items: ResponsibilityItem[]): Promise<void> {
  await db.query(`/* intelligence:deleteResp */ DELETE FROM job_responsibilities WHERE job_intelligence_id = $1`, [jobIntelligenceId]);
  for (const item of items) {
    await db.query(
      `/* intelligence:insertResp */ INSERT INTO job_responsibilities
         (job_intelligence_id, position, text, source, confidence)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (job_intelligence_id, position) DO NOTHING`,
      [jobIntelligenceId, item.position, item.text, item.source, item.confidence],
    );
  }
}

export async function replaceRequirements(db: SqlClient, jobIntelligenceId: number, items: RequirementItem[]): Promise<void> {
  await db.query(`/* intelligence:deleteReq */ DELETE FROM job_requirements WHERE job_intelligence_id = $1`, [jobIntelligenceId]);
  for (const item of items) {
    await db.query(
      `/* intelligence:insertReq */ INSERT INTO job_requirements
         (job_intelligence_id, position, text, requirement_level, source, confidence)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (job_intelligence_id, position) DO NOTHING`,
      [jobIntelligenceId, item.position, item.text, item.requirementLevel, item.source, item.confidence],
    );
  }
}

// ---------------------------------------------------------------------------
// Read side (API)
// ---------------------------------------------------------------------------

export interface JobIntelligenceApiSkill {
  name: string;
  category: string;
  skillType: string;
  requirementLevel: string;
  source: string;
  confidence: number | null;
}

export interface JobIntelligenceApiResult {
  status: IntelligenceStatus;
  extractorVersion: string;
  processedAt: string | null;
  seniority: Seniority;
  seniorityEvidence: string | null;
  experience: { minYears: number | null; maxYears: number | null; evidence: string | null };
  education: { level: EducationLevel; evidence: string | null };
  employmentType: string | null;
  workArrangement: string | null;
  compensation: { min: number | null; max: number | null; currency: string | null };
  summary: string | null;
  summarySource: "ai" | null;
  skills: JobIntelligenceApiSkill[];
  responsibilities: { text: string; source: string }[];
  requirements: { text: string; level: string; source: string }[];
}

export async function getJobIntelligenceForApi(
  db: SqlClient,
  externalJobId: number,
  extractorVersion: string,
): Promise<JobIntelligenceApiResult | null> {
  const rows = await db.query(
    `/* intelligence:apiGet */ SELECT * FROM job_intelligence
     WHERE external_job_id = $1 AND extractor_version = $2
     LIMIT 1`,
    [externalJobId, extractorVersion],
  );
  if (rows.length === 0) return null;
  const ji = rows[0];

  const [skillRows, responsibilityRows, requirementRows] = await Promise.all([
    db.query(
      `/* intelligence:apiSkills */ SELECT s.canonical_name, s.category, s.skill_type,
         jis.requirement_level, jis.source, jis.confidence
       FROM job_intelligence_skills jis
       JOIN job_skills s ON s.id = jis.skill_id
       WHERE jis.job_intelligence_id = $1
       ORDER BY jis.requirement_level = 'required' DESC, jis.requirement_level = 'preferred' DESC, s.canonical_name ASC`,
      [ji.id],
    ),
    db.query(
      `/* intelligence:apiResp */ SELECT text, source FROM job_responsibilities
       WHERE job_intelligence_id = $1 ORDER BY position ASC`,
      [ji.id],
    ),
    db.query(
      `/* intelligence:apiReq */ SELECT text, requirement_level, source FROM job_requirements
       WHERE job_intelligence_id = $1 ORDER BY position ASC`,
      [ji.id],
    ),
  ]);

  return {
    status: ji.status,
    extractorVersion: ji.extractor_version,
    processedAt: ji.processed_at,
    seniority: ji.seniority,
    seniorityEvidence: ji.seniority_evidence,
    experience: {
      minYears: ji.min_experience_years,
      maxYears: ji.max_experience_years,
      evidence: ji.experience_evidence,
    },
    education: { level: ji.education_level, evidence: ji.education_evidence },
    employmentType: ji.employment_type,
    workArrangement: ji.work_arrangement,
    compensation: { min: ji.salary_min, max: ji.salary_max, currency: ji.salary_currency },
    summary: ji.summary,
    summarySource: ji.summary_source,
    skills: skillRows.map((r) => ({
      name: r.canonical_name,
      category: r.category,
      skillType: r.skill_type,
      requirementLevel: r.requirement_level,
      source: r.source,
      confidence: r.confidence,
    })),
    responsibilities: responsibilityRows.map((r) => ({ text: r.text, source: r.source })),
    requirements: requirementRows.map((r) => ({ text: r.text, level: r.requirement_level, source: r.source })),
  };
}
