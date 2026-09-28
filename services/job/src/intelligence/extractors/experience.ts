/**
 * Phase 8 — Deterministic experience-years extraction.
 *
 * Only explicit numeric statements are extracted. Seniority titles like
 * "Senior Engineer" are NOT used to infer years of experience here — that
 * would be guessing, not extraction (see seniority.ts, which is kept
 * entirely separate). NULL means "not explicitly stated", never a guess.
 *
 * Known false-positive source (found via live-data verification —
 * see docs/intelligence.md): company/team history text like "our team was
 * formed 15+ years ago" matches the same "N+ years" shape as a genuine
 * experience requirement. Two mitigations:
 *   1. "years ago"/"years old" are excluded outright (a negative lookahead).
 *   2. When structured requirement items are available (from
 *      extractors/sections.ts), they are scanned FIRST — company-history
 *      prose almost never appears inside a requirements bullet — falling
 *      back to the full description only if no requirement item matches.
 * This is a heuristic, not a guarantee; remaining false positives are a
 * documented, accepted limitation.
 */

import type { ExperienceExtraction } from "../types.js";
import { EVIDENCE_MAX_LENGTH } from "../constants.js";

interface Pattern {
  regex: RegExp;
  build: (match: RegExpMatchArray) => { min: number | null; max: number | null };
}

// The leading \b is load-bearing: without it, a failed lookahead on
// "years ago" lets the regex engine backtrack into matching bare "year"
// (dropping the optional trailing "s") and re-check the lookahead from
// there, where it wrongly passes. \b forces the boundary to fall after a
// real word ("year" immediately followed by "s" has no boundary), so the
// engine can't sidestep the lookahead this way. Covered by
// experience.test.ts's "years ago" / "years old" cases.
const NOT_AGE_REFERENCE = "\\b(?!\\s*(?:ago|old)\\b)";

// Order matters: more specific patterns (ranges) are tried before looser
// ones (a bare "N years"), so "3-5 years" isn't first matched as just "5".
const PATTERNS: Pattern[] = [
  {
    // "3-5 years", "3 to 5 years"
    regex: new RegExp(`(\\d{1,2})\\s*(?:-|to)\\s*(\\d{1,2})\\+?\\s*years?${NOT_AGE_REFERENCE}`, "i"),
    build: (m) => ({ min: Number(m[1]), max: Number(m[2]) }),
  },
  {
    // "at least 5 years", "minimum of 5 years", "minimum 5 years"
    regex: new RegExp(`(?:at least|minimum(?: of)?)\\s*(\\d{1,2})\\+?\\s*years?${NOT_AGE_REFERENCE}`, "i"),
    build: (m) => ({ min: Number(m[1]), max: null }),
  },
  {
    // "3+ years"
    regex: new RegExp(`(\\d{1,2})\\+\\s*years?${NOT_AGE_REFERENCE}`, "i"),
    build: (m) => ({ min: Number(m[1]), max: null }),
  },
  {
    // "5 years of experience", "5 years experience", bare "5 years"
    regex: new RegExp(`(\\d{1,2})\\s*years?(?:\\s*(?:of\\s*)?experience)?${NOT_AGE_REFERENCE}`, "i"),
    build: (m) => ({ min: Number(m[1]), max: Number(m[1]) }),
  },
];

function extractSnippet(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + matchLength + 40);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return (prefix + text.slice(start, end).trim() + suffix).slice(0, EVIDENCE_MAX_LENGTH);
}

function matchIn(text: string): ExperienceExtraction | null {
  for (const pattern of PATTERNS) {
    const match = text.match(pattern.regex);
    if (match && match.index !== undefined) {
      const { min, max } = pattern.build(match);
      return { minYears: min, maxYears: max, evidence: extractSnippet(text, match.index, match[0].length) };
    }
  }
  return null;
}

/**
 * `preferredTexts` (typically structured requirement-item texts) are
 * scanned first; the general `description` is a fallback. Passing no
 * `preferredTexts` scans only `description`, same as before.
 */
export function extractExperience(description: string | null, preferredTexts: string[] = []): ExperienceExtraction {
  for (const text of preferredTexts) {
    const found = matchIn(text);
    if (found) return found;
  }

  if (!description) return { minYears: null, maxYears: null, evidence: null };

  return matchIn(description) ?? { minYears: null, maxYears: null, evidence: null };
}
