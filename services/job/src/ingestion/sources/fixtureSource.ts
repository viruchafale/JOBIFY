/**
 * Phase 3 — Fixture source adapter.
 *
 * Loads deterministic sample jobs from a local JSON file so the entire
 * pipeline (fetch → normalize → validate → dedupe → persist) can run with
 * no internet access. The fixture intentionally contains normal jobs,
 * in-batch duplicates (all 3 dedupe levels), malformed jobs, job-type /
 * work-location variants, HTML descriptions and messy whitespace.
 *
 * No database access here — pure fetch + shape.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { JobSourceAdapter } from "../adapter.js";
import type { RawExternalJob } from "../types.js";

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toNullableNumberOrString(value: unknown): number | string | null {
  if (typeof value === "number" || typeof value === "string") return value;
  return null;
}

export class FixtureJobSource implements JobSourceAdapter {
  readonly source = "fixture";
  private readonly fixturePath: string;
  private cache: RawExternalJob[] | null = null;

  constructor(fixturePath?: string) {
    this.fixturePath =
      fixturePath ??
      fileURLToPath(new URL("../fixtures/jobs.json", import.meta.url));
  }

  async fetchJobs(): Promise<RawExternalJob[]> {
    if (this.cache) return this.cache.map((job) => ({ ...job }));

    let parsed: unknown;
    try {
      const raw = await readFile(this.fixturePath, "utf8");
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `FixtureJobSource: failed to load fixture file: ${(error as Error).message}`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error("FixtureJobSource: fixture root must be an array.");
    }

    // Never let one malformed fixture entry break the whole fetch.
    const jobs: RawExternalJob[] = [];
    for (const entry of parsed) {
      try {
        jobs.push(this.toRawJob(entry));
      } catch {
        continue;
      }
    }
    this.cache = jobs;
    return jobs.map((job) => ({ ...job }));
  }

  private toRawJob(entry: unknown): RawExternalJob {
    const record =
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>)
        : {};

    const source =
      typeof record.source === "string" && record.source.trim() !== ""
        ? record.source.trim()
        : this.source;

    return {
      source,
      sourceJobId:
        typeof record.sourceJobId === "string" ? record.sourceJobId : "",
      sourceUrl: toNullableString(record.sourceUrl),
      applyUrl: toNullableString(record.applyUrl),
      companyName: toNullableString(record.companyName),
      title: toNullableString(record.title),
      description: toNullableString(record.description),
      location: toNullableString(record.location),
      jobType: toNullableString(record.jobType),
      workLocation: toNullableString(record.workLocation),
      role: toNullableString(record.role),
      salaryMin: toNullableNumberOrString(record.salaryMin),
      salaryMax: toNullableNumberOrString(record.salaryMax),
      salaryCurrency: toNullableString(record.salaryCurrency),
      postedAt: toNullableString(record.postedAt),
      rawPayload: entry,
    };
  }
}
