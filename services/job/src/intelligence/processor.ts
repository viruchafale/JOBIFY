/**
 * Phase 8 — processJobIntelligence(): the single entry point that turns one
 * external job into a job_intelligence record.
 *
 * Pipeline: load job -> check cache (fingerprint+version) -> deterministic
 * extraction -> optional AI extraction (only if deterministic found no
 * responsibilities/requirements) -> persist. Idempotent: re-running with an
 * unchanged job and extractor version is a no-op (see the fingerprint
 * check); re-running with `force` or a changed job/version always
 * reprocesses. The original external_jobs row is never written to.
 *
 * AI failure never loses the job: deterministic fields are always
 * persisted regardless of what the AI layer did. Only the specific
 * AI-derived fields (responsibilities/requirements/summary, and ONLY when
 * deterministic extraction found nothing itself) are affected by an AI
 * failure, and the row's status becomes `retryable_failed` (transient) or
 * `failed` (schema mismatch — retrying alone won't help) so it can be
 * revisited later via `npm run intelligence:reprocess`.
 */

import type { SqlClient } from "../ingestion/repository.js";
import { EXTRACTOR_VERSION } from "./constants.js";
import { loadIntelligenceConfig, type IntelligenceConfig } from "./config.js";
import {
  beginProcessing,
  completeProcessing,
  findExistingIntelligence,
  loadJobForIntelligence,
  loadSkillTaxonomy,
  markFailed,
  replaceRequirements,
  replaceResponsibilities,
  replaceSkills,
} from "./repository.js";
import type { SkillTaxonomyEntry } from "./extractors/skills.js";
import { runDeterministicExtraction } from "./extractors/deterministic.js";
import { matchSkills } from "./extractors/skills.js";
import { GeminiExtractionProvider, type AiExtractionProvider } from "./ai/provider.js";
import { extractWithAi } from "./ai/extractor.js";
import type { IntelligenceStatus, ProcessJobIntelligenceResult, RequirementItem, ResponsibilityItem } from "./types.js";
import { logIntelligenceEvent } from "./logger.js";

export interface ProcessJobIntelligenceOptions {
  /** Ignore the fingerprint/version cache check and always reprocess. */
  force?: boolean;
  config?: IntelligenceConfig;
  /** Injectable for tests / batch reuse across many jobs (avoids re-querying per job). */
  taxonomy?: SkillTaxonomyEntry[];
  /** Injectable for tests; defaults to a real GeminiExtractionProvider when AI is needed. */
  aiProvider?: AiExtractionProvider;
}

export async function processJobIntelligence(
  db: SqlClient,
  externalJobId: number,
  options: ProcessJobIntelligenceOptions = {},
): Promise<ProcessJobIntelligenceResult> {
  const startedAt = Date.now();
  const config = options.config ?? loadIntelligenceConfig(process.env);

  const job = await loadJobForIntelligence(db, externalJobId);
  if (!job) {
    throw new Error(`external job ${externalJobId} not found`);
  }

  if (!options.force) {
    const existing = await findExistingIntelligence(db, externalJobId, EXTRACTOR_VERSION);
    if (existing && existing.status === "completed" && existing.contentFingerprint === job.contentFingerprint) {
      logIntelligenceEvent("intelligence_skipped", { jobId: externalJobId, extractorVersion: EXTRACTOR_VERSION });
      return {
        jobIntelligenceId: existing.id,
        externalJobId,
        status: existing.status,
        skipped: true,
        skillCount: 0,
        responsibilityCount: 0,
        requirementCount: 0,
        aiAttempted: false,
        aiSucceeded: false,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  const jobIntelligenceId = await beginProcessing(db, externalJobId, EXTRACTOR_VERSION, job.contentFingerprint);
  logIntelligenceEvent("intelligence_started", { jobId: externalJobId, jobIntelligenceId, extractorVersion: EXTRACTOR_VERSION });

  try {
    const taxonomy = options.taxonomy ?? (await loadSkillTaxonomy(db));
    const truncatedDescription = job.description ? job.description.slice(0, config.maxDescriptionLength) : job.description;
    const jobForExtraction = { ...job, description: truncatedDescription };

    const deterministic = runDeterministicExtraction(jobForExtraction, taxonomy);

    let responsibilities: ResponsibilityItem[] = deterministic.responsibilities;
    let requirements: RequirementItem[] = deterministic.requirements;
    let summary: string | null = null;
    let summarySource: "ai" | null = null;
    let aiAttempted = false;
    let aiSucceeded = false;
    let aiError: { message: string; retryable: boolean } | null = null;

    const needsAi = config.aiEnabled && (responsibilities.length === 0 || requirements.length === 0);
    if (needsAi) {
      aiAttempted = true;
      const provider = options.aiProvider ?? new GeminiExtractionProvider(config.geminiApiKey as string, config.geminiModel);
      try {
        const aiResult = await extractWithAi(
          provider,
          { title: job.title ?? "", companyName: null, description: truncatedDescription ?? "" },
          config.aiTimeoutMs,
        );
        if (responsibilities.length === 0) {
          responsibilities = aiResult.responsibilities.map((r, i) => ({ position: i, text: r.text, source: "ai", confidence: null }));
        }
        if (requirements.length === 0) {
          requirements = aiResult.requirements.map((r, i) => ({
            position: i,
            text: r.text,
            requirementLevel: r.level,
            source: "ai",
            confidence: null,
          }));
        }
        summary = aiResult.summary;
        summarySource = "ai";
        aiSucceeded = true;
        logIntelligenceEvent("intelligence_ai_completed", { jobId: externalJobId, jobIntelligenceId });
      } catch (error) {
        const reason = (error as { reason?: string }).reason ?? "unknown";
        const retryable = (error as { retryable?: boolean }).retryable ?? false;
        aiError = { message: (error as Error).message, retryable };
        logIntelligenceEvent("intelligence_ai_failed", { jobId: externalJobId, jobIntelligenceId, reason, retryable });
      }
    }

    // If AI contributed new requirement/responsibility text, re-match skills
    // against it so skills mentioned only in AI-derived text still get the
    // correct requirement level; otherwise reuse the deterministic pass.
    const skills = aiSucceeded
      ? matchSkills({ description: jobForExtraction.description, responsibilities, requirements }, taxonomy)
      : deterministic.skills;

    const finalStatus: IntelligenceStatus =
      aiAttempted && !aiSucceeded ? (aiError?.retryable ? "retryable_failed" : "failed") : "completed";

    await completeProcessing(db, jobIntelligenceId, {
      seniority: deterministic.seniority.seniority,
      seniorityEvidence: deterministic.seniority.evidence,
      minExperienceYears: deterministic.experience.minYears,
      maxExperienceYears: deterministic.experience.maxYears,
      experienceEvidence: deterministic.experience.evidence,
      educationLevel: deterministic.education.level,
      educationEvidence: deterministic.education.evidence,
      employmentType: job.jobType,
      workArrangement: job.workLocation,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      salaryCurrency: job.salaryCurrency,
      summary,
      summarySource,
      status: finalStatus,
      lastError: aiError?.message ?? null,
    });
    await replaceSkills(db, jobIntelligenceId, skills);
    await replaceResponsibilities(db, jobIntelligenceId, responsibilities);
    await replaceRequirements(db, jobIntelligenceId, requirements);

    logIntelligenceEvent("intelligence_completed", {
      jobId: externalJobId,
      jobIntelligenceId,
      status: finalStatus,
      skillCount: skills.length,
      responsibilityCount: responsibilities.length,
      requirementCount: requirements.length,
      durationMs: Date.now() - startedAt,
    });

    return {
      jobIntelligenceId,
      externalJobId,
      status: finalStatus,
      skipped: false,
      skillCount: skills.length,
      responsibilityCount: responsibilities.length,
      requirementCount: requirements.length,
      aiAttempted,
      aiSucceeded,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = (error as Error).message || String(error);
    logIntelligenceEvent("intelligence_failed", { jobId: externalJobId, jobIntelligenceId, error: message });
    await markFailed(db, jobIntelligenceId, "failed", message);
    return {
      jobIntelligenceId,
      externalJobId,
      status: "failed",
      skipped: false,
      skillCount: 0,
      responsibilityCount: 0,
      requirementCount: 0,
      aiAttempted: false,
      aiSucceeded: false,
      durationMs: Date.now() - startedAt,
    };
  }
}
