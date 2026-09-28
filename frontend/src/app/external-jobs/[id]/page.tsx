"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ExternalJob, JobIntelligenceData } from "@/type";

/**
 * Phase 8 — external job detail page with derived intelligence.
 *
 * The original job description is always shown, unmodified, as the source
 * of truth (see docs/intelligence.md's design principle). Everything under
 * "JobiFy Intelligence" is clearly labeled as JobiFy's own derived
 * analysis, never presented as employer-supplied content.
 */

function formatSalary(min: number | null, max: number | null, currency: string | null) {
  if (min === null && max === null) return null;
  const fmt = (n: number) => n.toLocaleString();
  const c = currency ?? "";
  if (min !== null && max !== null) return `${c} ${fmt(min)} – ${fmt(max)}`.trim();
  return `${c} ${fmt((min ?? max)!)}`.trim();
}

function SkillBadge({ skill }: { skill: JobIntelligenceData["skills"][number] }) {
  const levelStyle =
    skill.requirementLevel === "required"
      ? "border-primary/60 bg-primary/10 text-primary"
      : skill.requirementLevel === "preferred"
        ? "border-border/60 bg-card text-foreground"
        : "border-border/40 bg-background text-muted-foreground";
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${levelStyle}`}>
      {skill.name}
      {skill.requirementLevel !== "mentioned" && (
        <span className="ml-1 opacity-70">({skill.requirementLevel})</span>
      )}
    </span>
  );
}

export default function ExternalJobDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [job, setJob] = useState<ExternalJob | null>(null);
  const [intelligence, setIntelligence] = useState<JobIntelligenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [intelligenceLoading, setIntelligenceLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    api.jobs
      .getExternalById(id)
      .then((data) => {
        if (!cancelled) setJob(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.message || "Failed to load this job.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    setIntelligenceLoading(true);
    api.jobs
      .getExternalIntelligence(id)
      .then((res) => {
        if (!cancelled) setIntelligence(res.data);
      })
      .catch(() => {
        // Intelligence may simply not exist yet for this job (404) — not an error state for the page.
        if (!cancelled) setIntelligence(null);
      })
      .finally(() => {
        if (!cancelled) setIntelligenceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="min-h-screen py-8">
      <div className="shell max-w-3xl space-y-6">
        <Link href="/external-jobs" className="text-sm text-muted-foreground underline">
          &larr; Back to search
        </Link>

        {loading && <p className="text-muted-foreground">Loading…</p>}
        {error && <p className="text-red-600">{error}</p>}

        {!loading && !error && job && (
          <>
            <div className="rounded-2xl border border-border/60 bg-card p-6">
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-2xl font-bold">{job.title}</h1>
                <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-xs uppercase text-muted-foreground">
                  {job.source}
                </span>
              </div>
              <p className="mt-2 text-muted-foreground">
                {job.company_name} · {job.location ?? "Location N/A"}
                {job.work_location ? ` · ${job.work_location}` : ""}
                {job.job_type ? ` · ${job.job_type}` : ""}
              </p>
              {job.apply_url && (
                <a
                  className="mt-4 inline-block rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
                  href={job.apply_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Apply on {job.source}
                </a>
              )}
            </div>

            <div className="rounded-2xl border border-border/60 bg-card p-6">
              <h2 className="text-lg font-semibold">Original job description</h2>
              <p className="mt-1 text-xs text-muted-foreground">As published by {job.company_name} on {job.source}.</p>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed">{job.description}</p>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card p-6">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">JobiFy Intelligence</h2>
                <span className="text-xs italic text-muted-foreground">Extracted by JobiFy — not written by the employer</span>
              </div>

              {intelligenceLoading && <p className="mt-4 text-sm text-muted-foreground">Analyzing…</p>}

              {!intelligenceLoading && !intelligence && (
                <p className="mt-4 text-sm text-muted-foreground">
                  JobiFy hasn&apos;t analyzed this job yet. Check back later.
                </p>
              )}

              {!intelligenceLoading && intelligence && (
                <div className="mt-4 space-y-5">
                  {intelligence.summary && (
                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground">Summary</h3>
                      <p className="mt-1 text-sm">{intelligence.summary}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <div>
                      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Seniority</h3>
                      <p className="mt-1 text-sm capitalize">{intelligence.seniority.value}</p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Experience</h3>
                      <p className="mt-1 text-sm">
                        {intelligence.experience.minYears === null
                          ? "Not specified"
                          : intelligence.experience.maxYears && intelligence.experience.maxYears !== intelligence.experience.minYears
                            ? `${intelligence.experience.minYears}–${intelligence.experience.maxYears} years`
                            : `${intelligence.experience.minYears}+ years`}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Education</h3>
                      <p className="mt-1 text-sm capitalize">{intelligence.education.level.replace(/_/g, " ")}</p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Employment type</h3>
                      <p className="mt-1 text-sm">{intelligence.employmentType ?? "Not specified"}</p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Work arrangement</h3>
                      <p className="mt-1 text-sm">{intelligence.workArrangement ?? "Not specified"}</p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Compensation</h3>
                      <p className="mt-1 text-sm">
                        {formatSalary(intelligence.compensation.min, intelligence.compensation.max, intelligence.compensation.currency) ??
                          "Not disclosed"}
                      </p>
                    </div>
                  </div>

                  {intelligence.skills.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground">Skills</h3>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {intelligence.skills.map((skill) => (
                          <SkillBadge key={skill.name} skill={skill} />
                        ))}
                      </div>
                    </div>
                  )}

                  {intelligence.requirements.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground">Requirements</h3>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                        {intelligence.requirements.map((req, i) => (
                          <li key={i}>
                            {req.text}
                            {req.level === "preferred" && (
                              <span className="ml-1 text-xs text-muted-foreground">(preferred)</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {intelligence.responsibilities.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground">Responsibilities</h3>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                        {intelligence.responsibilities.map((resp, i) => (
                          <li key={i}>{resp.text}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
