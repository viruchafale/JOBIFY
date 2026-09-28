/**
 * Phase 8 — Deterministic education-requirement extraction.
 *
 * Only the job posting's own text is used. A company's typical hiring
 * pattern is never inferred — only explicit wording in this specific
 * posting counts.
 */

import type { EducationExtraction, EducationLevel } from "../types.js";
import { EVIDENCE_MAX_LENGTH } from "../constants.js";

interface Rule {
  level: EducationLevel;
  regex: RegExp;
}

// Most advanced first — first match wins (a posting asking for "Master's
// or PhD" resolves to the more specific/advanced "phd" match only if PhD
// text is actually present; otherwise "master").
const RULES: Rule[] = [
  { level: "phd", regex: /\b(ph\.?d\.?|doctorate)\b/i },
  { level: "master", regex: /\b(master'?s degree|m\.?s\.?\s*degree|mba)\b/i },
  { level: "bachelor", regex: /\b(bachelor'?s degree|b\.?s\.?\s*degree|b\.?a\.?\s*degree|undergraduate degree)\b/i },
  { level: "associate", regex: /\bassociate'?s degree\b/i },
  { level: "bootcamp", regex: /\bbootcamp\b/i },
  { level: "high_school", regex: /\bhigh school diploma\b/i },
  { level: "none", regex: /\b(no degree (?:is )?required|degree not required)\b/i },
];

function extractSnippet(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + matchLength + 40);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return (prefix + text.slice(start, end).trim() + suffix).slice(0, EVIDENCE_MAX_LENGTH);
}

export function extractEducation(description: string | null): EducationExtraction {
  if (!description) return { level: "unspecified", evidence: null };

  for (const rule of RULES) {
    const match = description.match(rule.regex);
    if (match && match.index !== undefined) {
      return {
        level: rule.level,
        evidence: extractSnippet(description, match.index, match[0].length),
      };
    }
  }

  return { level: "unspecified", evidence: null };
}
