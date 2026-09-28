/**
 * Phase 8 — Deterministic responsibilities/requirements extraction.
 *
 * Why this reads raw HTML instead of `external_jobs.description`: Phase 3's
 * `stripHtml()` (normalize.ts) replaces every tag — including `<li>`,
 * `<br>`, `<p>` — with a single space before storing `description`. That is
 * correct for full-text search (Phase 7) but destroys exactly the
 * structural information (list boundaries, section headings) this
 * extractor needs to tell "Responsibilities" and "Requirements" apart. So
 * this module reads `raw_external_jobs.raw_payload` (preserved verbatim
 * since Phase 3) instead, and does its own minimal, source-aware
 * HTML-to-lines conversion — never a second copy of Phase 3's
 * normalization logic, just enough structure recovery for section
 * detection.
 *
 * Lever is a special case: its postings already come pre-split into
 * `{ text: heading, content: html }` blocks (`rawPayload.lists`), which is
 * used directly instead of heuristic heading detection.
 *
 * Conservative by design: text outside any recognized heading is dropped,
 * never guessed into a category. A posting with no recognizable structure
 * yields empty arrays — not fabricated data (see docs/intelligence.md).
 */

import { MAX_REQUIREMENTS_PER_JOB, MAX_RESPONSIBILITIES_PER_JOB, ITEM_TEXT_MAX_LENGTH } from "../constants.js";
import type { RequirementItem, ResponsibilityItem } from "../types.js";

type Section = "none" | "responsibilities" | "requirements" | "preferred";

const RESPONSIBILITIES_HEADING = /responsibilit|what you.?ll do|what you will do|\bduties\b|key responsibilities|day.to.day/i;
// "what we value" added after live-data verification found a real Lever
// posting (Palantir) using it as a preferred-qualities heading.
const PREFERRED_HEADING = /preferred|nice to have|bonus points|\ba plus\b|desired qualifications|what we value/i;
// \brequires?\b (not just "requirement") added after live-data
// verification found a real Lever posting headed "What We Require" —
// "require"/"requires" alone doesn't contain the substring "requirement".
const REQUIREMENTS_HEADING = /requirement|\brequires?\b|qualification|what you.?ll bring|what you bring|what we.?re looking for|you have\b|minimum qualifications/i;

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// Non-printing marker (ASCII 0x01) prepended to lines that came from a
// <li> element, so callers that only care about actual list items (the
// Lever path below) can distinguish them from other line breaks (<br>,
// </p>, headings). Stripped by cleanLine() before the text is ever used.
const BULLET_MARKER = String.fromCharCode(1);

/** Converts an HTML blob into trimmed, non-empty lines, marking <li> items with BULLET_MARKER. */
function htmlToLines(html: string): string[] {
  const withMarkers = html
    .replace(/<li[^>]*>/gi, "\n" + BULLET_MARKER)
    // Every other block-level boundary (open AND close) becomes a plain
    // newline — the bullet marker is ONLY for <li>, so a <li>'s own
    // content never silently merges into the next paragraph/heading/list
    // item when its closing tag is stripped.
    .replace(/<\/li>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?p[^>]*>/gi, "\n")
    .replace(/<\/?div[^>]*>/gi, "\n")
    .replace(/<\/?[uo]l[^>]*>/gi, "\n")
    .replace(/<\/?h[1-6][^>]*>/gi, "\n");
  const stripped = withMarkers.replace(/<[^>]*>/g, "");
  const decoded = decodeEntities(stripped);
  return decoded
    .split("\n")
    .map((line) => {
      const bullet = line.startsWith(BULLET_MARKER);
      const rest = (bullet ? line.slice(1) : line).replace(/\s+/g, " ").trim();
      return bullet ? BULLET_MARKER + rest : rest;
    })
    .filter((line) => (line.startsWith(BULLET_MARKER) ? line.slice(1) : line).length > 0);
}

function isBulletLine(line: string): boolean {
  return line.startsWith(BULLET_MARKER);
}

function cleanLine(line: string): string {
  return (line.startsWith(BULLET_MARKER) ? line.slice(1) : line).trim();
}

function classifyHeading(line: string): Section | null {
  const text = cleanLine(line);
  const wordCount = text.split(/\s+/).length;
  if (wordCount > 8 || text.length > 100) return null;
  if (PREFERRED_HEADING.test(text)) return "preferred";
  if (REQUIREMENTS_HEADING.test(text)) return "requirements";
  if (RESPONSIBILITIES_HEADING.test(text)) return "responsibilities";
  return null;
}

export interface ExtractedSections {
  responsibilities: ResponsibilityItem[];
  requirements: RequirementItem[];
}

/** Core line-walking algorithm, shared by every HTML shape below. */
function extractFromLines(lines: string[]): ExtractedSections {
  const responsibilities: ResponsibilityItem[] = [];
  const requirements: RequirementItem[] = [];
  let current: Section = "none";

  for (const rawLine of lines) {
    const heading = classifyHeading(rawLine);
    if (heading) {
      current = heading;
      continue;
    }
    if (current === "none") continue;

    const text = cleanLine(rawLine).slice(0, ITEM_TEXT_MAX_LENGTH);
    if (!text) continue;

    if (current === "responsibilities") {
      if (responsibilities.length >= MAX_RESPONSIBILITIES_PER_JOB) continue;
      responsibilities.push({ position: responsibilities.length, text, source: "deterministic", confidence: null });
    } else if (current === "requirements") {
      if (requirements.length >= MAX_REQUIREMENTS_PER_JOB) continue;
      requirements.push({ position: requirements.length, text, requirementLevel: "required", source: "deterministic", confidence: null });
    } else if (current === "preferred") {
      if (requirements.length >= MAX_REQUIREMENTS_PER_JOB) continue;
      requirements.push({ position: requirements.length, text, requirementLevel: "preferred", source: "deterministic", confidence: null });
    }
  }

  return { responsibilities, requirements };
}

/** Generic path: a single HTML blob (Greenhouse's `content`, Ashby's `descriptionHtml`, Lever's `description` fallback, fixtures). */
export function extractSectionsFromHtml(html: string | null | undefined): ExtractedSections {
  if (!html || typeof html !== "string") return { responsibilities: [], requirements: [] };
  return extractFromLines(htmlToLines(html));
}

/** Lever path: postings arrive pre-split into `{ text: heading, content: html }` blocks. */
export function extractSectionsFromLeverLists(
  lists: { text?: unknown; content?: unknown }[] | null | undefined,
): ExtractedSections {
  if (!Array.isArray(lists)) return { responsibilities: [], requirements: [] };

  const responsibilities: ResponsibilityItem[] = [];
  const requirements: RequirementItem[] = [];

  for (const block of lists) {
    const heading = typeof block.text === "string" ? block.text : "";
    const content = typeof block.content === "string" ? block.content : "";
    if (!content) continue;

    let section: Section | null = classifyHeading(heading);
    // Lever's list heading is sometimes the role title itself, not a
    // section label. In that case fall back to treating the list's own
    // <li> items as responsibilities only if the heading doesn't look like
    // a requirements/preferred section — conservative default.
    if (section === null) {
      section = REQUIREMENTS_HEADING.test(heading) ? "requirements" : "responsibilities";
    }

    const lines = htmlToLines(content).filter(isBulletLine);
    for (const line of lines) {
      const text = cleanLine(line).slice(0, ITEM_TEXT_MAX_LENGTH);
      if (!text) continue;
      if (section === "responsibilities" && responsibilities.length < MAX_RESPONSIBILITIES_PER_JOB) {
        responsibilities.push({ position: responsibilities.length, text, source: "deterministic", confidence: null });
      } else if ((section === "requirements" || section === "preferred") && requirements.length < MAX_REQUIREMENTS_PER_JOB) {
        requirements.push({
          position: requirements.length,
          text,
          requirementLevel: section === "preferred" ? "preferred" : "required",
          source: "deterministic",
          confidence: null,
        });
      }
    }
  }

  return { responsibilities, requirements };
}

interface RawPayloadLike {
  lists?: unknown;
  descriptionHtml?: unknown;
  content?: unknown;
  description?: unknown;
}

/** Chooses the right extraction path for a given source's raw payload shape. */
export function extractSectionsFromRawPayload(source: string, rawPayload: unknown): ExtractedSections {
  if (typeof rawPayload !== "object" || rawPayload === null) {
    return { responsibilities: [], requirements: [] };
  }
  const payload = rawPayload as RawPayloadLike;

  if (source === "lever" && Array.isArray(payload.lists)) {
    const result = extractSectionsFromLeverLists(payload.lists as { text?: unknown; content?: unknown }[]);
    if (result.responsibilities.length > 0 || result.requirements.length > 0) return result;
    // Fall through to the generic path if Lever's lists didn't yield anything.
  }

  const html =
    (typeof payload.descriptionHtml === "string" && payload.descriptionHtml) ||
    (typeof payload.content === "string" && payload.content) ||
    (typeof payload.description === "string" && payload.description) ||
    null;

  return extractSectionsFromHtml(html);
}
