/**
 * Phase 8 — Job Intelligence: shared types.
 *
 * Design principle (see docs/intelligence.md): the original job
 * (external_jobs.title/description/...) is never modified. Everything here
 * is DERIVED data, explicitly versioned and provenanced.
 */

export type Seniority =
  | "intern" | "entry" | "junior" | "mid" | "senior" | "staff"
  | "principal" | "lead" | "manager" | "director" | "executive" | "unknown";

export type EducationLevel =
  | "high_school" | "associate" | "bachelor" | "master" | "phd" | "bootcamp"
  | "none" | "unspecified";

export type IntelligenceStatus = "pending" | "processing" | "completed" | "failed" | "retryable_failed";

export type ExtractionSource = "deterministic" | "ai";

export type RequirementLevel = "required" | "preferred" | "mentioned";

export interface SkillMatch {
  canonicalName: string;
  skillId: number;
  category: string;
  skillType: string;
  requirementLevel: RequirementLevel;
  source: ExtractionSource;
  /** null for deterministic matches — there is no calibrated probability to report. */
  confidence: number | null;
  /** Short excerpt from the job description, never the full text. */
  evidence: string | null;
}

export interface ResponsibilityItem {
  position: number;
  text: string;
  source: ExtractionSource;
  confidence: number | null;
}

export interface RequirementItem {
  position: number;
  text: string;
  requirementLevel: "required" | "preferred";
  source: ExtractionSource;
  confidence: number | null;
}

export interface ExperienceExtraction {
  minYears: number | null;
  maxYears: number | null;
  evidence: string | null;
}

export interface SeniorityExtraction {
  seniority: Seniority;
  evidence: string | null;
}

export interface EducationExtraction {
  level: EducationLevel;
  evidence: string | null;
}

/** Everything deterministic extraction can produce from one job. */
export interface DeterministicExtractionResult {
  seniority: SeniorityExtraction;
  experience: ExperienceExtraction;
  education: EducationExtraction;
  skills: SkillMatch[];
  responsibilities: ResponsibilityItem[];
  requirements: RequirementItem[];
}

/** What the (optional) AI layer can contribute, validated before use. */
export interface AiExtractionResult {
  responsibilities: { text: string }[];
  requirements: { text: string; level: "required" | "preferred" }[];
  summary: string;
}

export interface JobIntelligenceRecord {
  id: number;
  externalJobId: number;
  extractorVersion: string;
  contentFingerprint: string;
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
  attemptCount: number;
  lastError: string | null;
  processedAt: string | null;
}

export interface ProcessJobIntelligenceResult {
  jobIntelligenceId: number;
  externalJobId: number;
  status: IntelligenceStatus;
  skipped: boolean;
  skillCount: number;
  responsibilityCount: number;
  requirementCount: number;
  aiAttempted: boolean;
  aiSucceeded: boolean;
  durationMs: number;
}
