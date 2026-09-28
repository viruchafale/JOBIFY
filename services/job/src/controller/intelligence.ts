/**
 * Phase 8 — Read-only job intelligence API.
 *
 * Serves already-computed intelligence; never triggers processing itself
 * (processing is a batch/worker concern — see intelligence/processor.ts).
 * Never exposes internal processing errors, raw AI prompts, or raw model
 * responses — only the validated, structured result.
 */

import { sql } from "../utils/db.js";
import ErrorHandler from "../utils/errorHandler.js";
import { TryCatch } from "../utils/TryCatch.js";
import { getJobIntelligenceForApi } from "../intelligence/repository.js";
import { EXTRACTOR_VERSION } from "../intelligence/constants.js";
import { getExternalJobById } from "../ingestion/repository.js";

export const getJobIntelligenceHandler = TryCatch(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    throw new ErrorHandler(400, "Invalid external job id.");
  }

  const job = await getExternalJobById(sql as any, id);
  if (!job) {
    throw new ErrorHandler(404, "External job not found.");
  }

  const intelligence = await getJobIntelligenceForApi(sql as any, id, EXTRACTOR_VERSION);
  if (!intelligence) {
    throw new ErrorHandler(404, "Intelligence has not been generated for this job yet.");
  }

  // "processing"/"pending" rows exist but have nothing meaningful to show
  // yet; treat them the same as not-found rather than returning partial/
  // stale-looking data.
  if (intelligence.status === "pending" || intelligence.status === "processing") {
    throw new ErrorHandler(404, "Intelligence has not been generated for this job yet.");
  }

  res.json({
    data: {
      status: intelligence.status,
      extractorVersion: intelligence.extractorVersion,
      processedAt: intelligence.processedAt,
      seniority: {
        value: intelligence.seniority,
        evidence: intelligence.seniorityEvidence,
      },
      experience: intelligence.experience,
      education: intelligence.education,
      employmentType: intelligence.employmentType,
      workArrangement: intelligence.workArrangement,
      compensation: intelligence.compensation,
      summary: intelligence.summary,
      summarySource: intelligence.summarySource,
      skills: intelligence.skills.map((s) => ({
        name: s.name,
        category: s.category,
        skillType: s.skillType,
        requirementLevel: s.requirementLevel,
        source: s.source,
      })),
      responsibilities: intelligence.responsibilities,
      requirements: intelligence.requirements,
    },
  });
});
