/**
 * Phase 8 — Deterministic seniority extraction from the job title.
 *
 * The title is checked, in a fixed most-senior-first priority order, so
 * e.g. "Senior Staff Engineer" resolves to "staff" (checked before
 * "senior") rather than "senior" — a documented convention, not a claim of
 * universal truth about org ladders. Ambiguous/unlabeled titles resolve to
 * "unknown" rather than guessing.
 */

import type { Seniority, SeniorityExtraction } from "../types.js";

interface Rule {
  seniority: Seniority;
  regex: RegExp;
}

// Most senior first — first match wins.
const RULES: Rule[] = [
  { seniority: "executive", regex: /\b(vp|vice president|chief\s+\w+\s+officer|c[a-z]o|head of)\b/i },
  { seniority: "director", regex: /\bdirector\b/i },
  { seniority: "principal", regex: /\bprincipal\b/i },
  { seniority: "staff", regex: /\bstaff\b/i },
  { seniority: "lead", regex: /\blead\b/i },
  { seniority: "manager", regex: /\bmanager\b/i },
  { seniority: "senior", regex: /\b(senior|sr\.?)\b/i },
  { seniority: "mid", regex: /\b(mid[- ]level|intermediate)\b/i },
  { seniority: "junior", regex: /\b(junior|jr\.?)\b/i },
  { seniority: "entry", regex: /\b(entry[- ]level|new grad(?:uate)?)\b/i },
  { seniority: "intern", regex: /\bintern(?:ship)?\b/i },
];

export function extractSeniority(title: string | null): SeniorityExtraction {
  if (!title) return { seniority: "unknown", evidence: null };

  for (const rule of RULES) {
    const match = title.match(rule.regex);
    if (match) {
      return { seniority: rule.seniority, evidence: title.trim().slice(0, 300) };
    }
  }

  return { seniority: "unknown", evidence: null };
}
