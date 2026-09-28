/**
 * Phase 8 — Deterministic skill extraction against the data-driven taxonomy
 * (job_skills + job_skill_aliases tables — see migration 007 and
 * intelligence/repository.ts's loadSkillTaxonomy()). No skill name is ever
 * hard-coded in extraction logic; everything comes from the taxonomy.
 *
 * requirement_level is decided by WHERE a skill's alias is found, not by
 * mere presence in the description: a match inside a `job_requirements`
 * item inherits that item's level (required/preferred); a match only in
 * the general description text is "mentioned" — never inferred as
 * required/preferred just because the technology is named somewhere.
 *
 * False-positive control: short/common-English-word aliases (e.g. "Go",
 * "REST", "ML") are flagged `case_sensitive` in the taxonomy and matched
 * with exact case + word boundaries, so "go the extra mile" doesn't match
 * the Go programming language (see migration 007 and skills.test.ts).
 */

import { EVIDENCE_MAX_LENGTH, MAX_SKILLS_PER_JOB } from "../constants.js";
import type { RequirementItem, ResponsibilityItem, SkillMatch } from "../types.js";

export interface SkillAliasEntry {
  alias: string;
  caseSensitive: boolean;
}

export interface SkillTaxonomyEntry {
  skillId: number;
  canonicalName: string;
  category: string;
  skillType: string;
  aliases: SkillAliasEntry[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSnippet(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + matchLength + 30);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return (prefix + text.slice(start, end).trim() + suffix).slice(0, EVIDENCE_MAX_LENGTH);
}

/** Finds the first match of any alias of `entry` inside `text`, if any. */
function findFirstMatch(text: string, entry: SkillTaxonomyEntry): { evidence: string } | null {
  for (const alias of entry.aliases) {
    const pattern = new RegExp(`\\b${escapeRegExp(alias.alias)}\\b`, alias.caseSensitive ? "" : "i");
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      return { evidence: extractSnippet(text, match.index, match[0].length) };
    }
  }
  return null;
}

const LEVEL_RANK: Record<SkillMatch["requirementLevel"], number> = {
  mentioned: 0,
  preferred: 1,
  required: 2,
};

export function matchSkills(
  input: {
    description: string | null;
    responsibilities: ResponsibilityItem[];
    requirements: RequirementItem[];
  },
  taxonomy: SkillTaxonomyEntry[],
): SkillMatch[] {
  const results = new Map<number, SkillMatch>();

  const consider = (entry: SkillTaxonomyEntry, text: string, level: SkillMatch["requirementLevel"]) => {
    const found = findFirstMatch(text, entry);
    if (!found) return;
    const existing = results.get(entry.skillId);
    if (!existing || LEVEL_RANK[level] > LEVEL_RANK[existing.requirementLevel]) {
      results.set(entry.skillId, {
        canonicalName: entry.canonicalName,
        skillId: entry.skillId,
        category: entry.category,
        skillType: entry.skillType,
        requirementLevel: level,
        source: "deterministic",
        confidence: null,
        evidence: existing?.evidence ?? found.evidence,
      });
    } else if (existing.evidence === null) {
      existing.evidence = found.evidence;
    }
  };

  for (const entry of taxonomy) {
    // Highest-signal sources first: requirement items carry an explicit
    // required/preferred level; the general description only ever yields
    // "mentioned".
    for (const requirement of input.requirements) {
      consider(entry, requirement.text, requirement.requirementLevel);
    }
    for (const responsibility of input.responsibilities) {
      consider(entry, responsibility.text, "mentioned");
    }
    if (input.description) {
      consider(entry, input.description, "mentioned");
    }
  }

  return [...results.values()].slice(0, MAX_SKILLS_PER_JOB);
}
