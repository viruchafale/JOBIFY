/**
 * Phase 8 — Combines every deterministic extractor into one pass. This is
 * the ONLY thing processor.ts calls for the deterministic layer; it never
 * calls individual extractors directly, so the deterministic pipeline's
 * composition is defined in exactly one place.
 */

import type { DeterministicExtractionResult } from "../types.js";
import type { JobForIntelligence } from "../repository.js";
import type { SkillTaxonomyEntry } from "./skills.js";
import { extractExperience } from "./experience.js";
import { extractSeniority } from "./seniority.js";
import { extractEducation } from "./education.js";
import { extractSectionsFromRawPayload } from "./sections.js";
import { matchSkills } from "./skills.js";

export function runDeterministicExtraction(
  job: JobForIntelligence,
  taxonomy: SkillTaxonomyEntry[],
): DeterministicExtractionResult {
  const seniority = extractSeniority(job.title);
  const sections = extractSectionsFromRawPayload(job.source, job.rawPayload);
  // Requirement bullets are scanned before the general description — see
  // experience.ts's docstring for why (avoids matching company/team-history
  // prose like "formed 15+ years ago" as a candidate experience requirement).
  const experience = extractExperience(
    job.description,
    sections.requirements.map((r) => r.text),
  );
  const education = extractEducation(job.description);
  const skills = matchSkills(
    { description: job.description, responsibilities: sections.responsibilities, requirements: sections.requirements },
    taxonomy,
  );

  return {
    seniority,
    experience,
    education,
    skills,
    responsibilities: sections.responsibilities,
    requirements: sections.requirements,
  };
}
