"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ExternalJobSearchResult, ExternalJobSort } from "@/type";

/**
 * Phase 7 — advanced search over external jobs.
 *
 * Search state lives in the URL (refresh persistence, sharing, back/forward,
 * bookmarking — see docs/search.md). Two update paths:
 *  - free-text fields (q, location, company, role, minSalary, maxSalary,
 *    postedAfter) are debounced as a group so a full sentence of typing
 *    doesn't fire a request per keystroke.
 *  - dropdowns (jobType, workLocation, source, sort) and pagination apply
 *    immediately — there's no "typing" concern for a <select>.
 */

const SORT_OPTIONS: { value: ExternalJobSort; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "salary_high", label: "Salary: high to low" },
  { value: "salary_low", label: "Salary: low to high" },
];

const JOB_TYPES = ["Full-time", "Part-time", "Contract", "Internship"];
const WORK_LOCATIONS = ["On-site", "Remote", "Hybrid"];
// "fixture" is intentionally excluded — it's a local test-only source, never real jobs.
const SOURCES = ["lever", "greenhouse", "ashby"];

const DEBOUNCE_MS = 400;
const PAGE_SIZE = 20;

interface TextDraft {
  q: string;
  location: string;
  company: string;
  role: string;
  minSalary: string;
  maxSalary: string;
  postedAfter: string;
}

function readTextDraft(sp: URLSearchParams): TextDraft {
  return {
    q: sp.get("q") ?? "",
    location: sp.get("location") ?? "",
    company: sp.get("company") ?? "",
    role: sp.get("role") ?? "",
    minSalary: sp.get("minSalary") ?? "",
    maxSalary: sp.get("maxSalary") ?? "",
    postedAfter: sp.get("postedAfter") ?? "",
  };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function formatSalary(min: number | null, max: number | null, currency: string | null) {
  if (min === null && max === null) return null;
  const fmt = (n: number) => n.toLocaleString();
  const c = currency ?? "";
  if (min !== null && max !== null) return `${c} ${fmt(min)} – ${fmt(max)}`.trim();
  return `${c} ${fmt((min ?? max)!)}`.trim();
}

function JobCard({ job }: { job: ExternalJobSearchResult }) {
  return (
    <li className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{job.title}</h2>
        <span className="shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-xs uppercase text-muted-foreground">
          {job.source}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {job.company_name} · {job.location ?? "Location N/A"}
        {job.work_location ? ` · ${job.work_location}` : ""}
        {job.job_type ? ` · ${job.job_type}` : ""}
      </p>
      {formatSalary(job.salary_min, job.salary_max, job.salary_currency) && (
        <p className="mt-1 text-sm font-medium text-foreground">
          {formatSalary(job.salary_min, job.salary_max, job.salary_currency)}
        </p>
      )}
      <p className="mt-2 line-clamp-3 text-sm">{job.description}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {job.role ? `${job.role} · ` : ""}
        {job.posted_at ? `posted ${new Date(job.posted_at).toLocaleDateString()}` : "posted date unknown"}
      </p>
      <div className="mt-3 flex gap-3">
        <Link href={`/external-jobs/${job.id}`} className="inline-block text-sm font-semibold text-primary">
          View details
        </Link>
        {job.apply_url && (
          <a
            className="inline-block text-sm font-semibold text-primary"
            href={job.apply_url}
            target="_blank"
            rel="noreferrer"
          >
            Apply
          </a>
        )}
        <a
          className="inline-block text-sm text-muted-foreground underline"
          href={job.canonical_url}
          target="_blank"
          rel="noreferrer"
        >
          View source
        </a>
      </div>
    </li>
  );
}

function ExternalJobsSearchPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();

  const [textDraft, setTextDraft] = useState<TextDraft>(() => readTextDraft(searchParams));
  const debouncedText = useDebouncedValue(textDraft, DEBOUNCE_MS);

  const [items, setItems] = useState<ExternalJobSearchResult[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const jobType = searchParams.get("jobType") ?? "";
  const workLocation = searchParams.get("workLocation") ?? "";
  const source = searchParams.get("source") ?? "";
  const sort = (searchParams.get("sort") as ExternalJobSort) || "";
  const page = Number(searchParams.get("page") ?? "1") || 1;

  function pushParams(updates: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(searchParamsString);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }

  // Re-sync the local text draft when the URL changes from elsewhere
  // (back/forward navigation, an immediate-apply dropdown change, our own
  // debounced push landing) — idempotent when it already matches.
  useEffect(() => {
    setTextDraft(readTextDraft(new URLSearchParams(searchParamsString)));
  }, [searchParamsString]);

  // Commit debounced text-field changes to the URL.
  useEffect(() => {
    const current = readTextDraft(new URLSearchParams(searchParamsString));
    const changed = (Object.keys(debouncedText) as (keyof TextDraft)[]).some(
      (key) => debouncedText[key] !== current[key],
    );
    if (!changed) return;
    const next = new URLSearchParams(searchParamsString);
    for (const [key, value] of Object.entries(debouncedText)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedText]);

  // Fetch whenever the URL's search params actually change.
  useEffect(() => {
    const sp = new URLSearchParams(searchParamsString);
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.jobs
      .searchExternal({
        q: sp.get("q") || undefined,
        location: sp.get("location") || undefined,
        company: sp.get("company") || undefined,
        role: sp.get("role") || undefined,
        source: sp.get("source") || undefined,
        jobType: sp.get("jobType") || undefined,
        workLocation: sp.get("workLocation") || undefined,
        minSalary: sp.get("minSalary") ? Number(sp.get("minSalary")) : undefined,
        maxSalary: sp.get("maxSalary") ? Number(sp.get("maxSalary")) : undefined,
        postedAfter: sp.get("postedAfter") || undefined,
        sort: (sp.get("sort") as ExternalJobSort) || undefined,
        page: Number(sp.get("page") ?? "1") || 1,
        limit: PAGE_SIZE,
      })
      .then((res) => {
        if (cancelled) return;
        setItems(res.data.items);
        setPagination(res.data.pagination);
      })
      .catch((err) => {
        if (cancelled) return;
        setItems([]);
        setError(
          err?.response?.data?.message ||
            (err instanceof Error ? err.message : "Failed to search jobs. Please try again."),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [searchParamsString]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    for (const key of ["q", "location", "company", "role", "jobType", "workLocation", "source", "minSalary", "maxSalary", "postedAfter"]) {
      if (searchParams.get(key)) count += 1;
    }
    return count;
  }, [searchParams]);

  return (
    <div className="min-h-screen py-8">
      <div className="shell space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Search External Jobs</h1>
          <p className="mt-2 text-muted-foreground">
            Full-text and filtered search over jobs ingested from Lever, Greenhouse and Ashby.
          </p>
        </div>

        <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-5">
          <input
            className="h-12 w-full rounded-xl border border-border/70 bg-background px-4 text-base"
            placeholder='Search job titles, descriptions, companies… e.g. "backend engineer"'
            value={textDraft.q}
            onChange={(e) => setTextDraft((d) => ({ ...d, q: e.target.value }))}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              className="h-11 rounded-xl border border-border/70 bg-background px-3 text-sm"
              placeholder="Location (e.g. India)"
              value={textDraft.location}
              onChange={(e) => setTextDraft((d) => ({ ...d, location: e.target.value }))}
            />
            <input
              className="h-11 rounded-xl border border-border/70 bg-background px-3 text-sm"
              placeholder="Company"
              value={textDraft.company}
              onChange={(e) => setTextDraft((d) => ({ ...d, company: e.target.value }))}
            />
            <input
              className="h-11 rounded-xl border border-border/70 bg-background px-3 text-sm"
              placeholder="Role (e.g. Engineering)"
              value={textDraft.role}
              onChange={(e) => setTextDraft((d) => ({ ...d, role: e.target.value }))}
            />
            <select
              className="h-11 rounded-xl border border-border/70 bg-background px-3 text-sm"
              value={source}
              onChange={(e) => pushParams({ source: e.target.value || null })}
            >
              <option value="">All sources</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              className="h-11 rounded-xl border border-border/70 bg-background px-3 text-sm"
              value={jobType}
              onChange={(e) => pushParams({ jobType: e.target.value || null })}
            >
              <option value="">Any job type</option>
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              className="h-11 rounded-xl border border-border/70 bg-background px-3 text-sm"
              value={workLocation}
              onChange={(e) => pushParams({ workLocation: e.target.value || null })}
            >
              <option value="">Any work location</option>
              {WORK_LOCATIONS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
            <input
              className="h-11 rounded-xl border border-border/70 bg-background px-3 text-sm"
              type="number"
              min={0}
              placeholder="Min salary"
              value={textDraft.minSalary}
              onChange={(e) => setTextDraft((d) => ({ ...d, minSalary: e.target.value }))}
            />
            <input
              className="h-11 rounded-xl border border-border/70 bg-background px-3 text-sm"
              type="number"
              min={0}
              placeholder="Max salary"
              value={textDraft.maxSalary}
              onChange={(e) => setTextDraft((d) => ({ ...d, maxSalary: e.target.value }))}
            />

            <input
              className="h-11 rounded-xl border border-border/70 bg-background px-3 text-sm"
              type="date"
              value={textDraft.postedAfter}
              onChange={(e) => setTextDraft((d) => ({ ...d, postedAfter: e.target.value }))}
            />
            <select
              className="h-11 rounded-xl border border-border/70 bg-background px-3 text-sm"
              value={sort}
              onChange={(e) => pushParams({ sort: e.target.value || null }, false)}
            >
              <option value="">Sort: default</option>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {activeFilterCount > 0 && (
              <button
                type="button"
                className="h-11 rounded-xl border border-border/70 px-4 text-sm font-medium text-muted-foreground hover:bg-background"
                onClick={() => router.push(pathname)}
              >
                Clear all filters ({activeFilterCount})
              </button>
            )}
          </div>
        </div>

        <div className="text-sm text-muted-foreground">
          {!loading && !error && (
            <span>
              {pagination.total} result{pagination.total === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {loading && <p className="text-muted-foreground">Searching…</p>}
        {error && <p className="text-red-600">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="text-muted-foreground">No jobs match your search. Try broadening your filters.</p>
        )}

        {!loading && !error && items.length > 0 && (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {items.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </ul>
        )}

        {!loading && !error && pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 pt-2">
            <button
              type="button"
              className="rounded-xl border border-border/70 px-4 py-2 text-sm font-medium disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => pushParams({ page: String(page - 1) }, false)}
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              className="rounded-xl border border-border/70 px-4 py-2 text-sm font-medium disabled:opacity-40"
              disabled={page >= pagination.totalPages}
              onClick={() => pushParams({ page: String(page + 1) }, false)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExternalJobsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen py-8">
          <div className="shell">Loading…</div>
        </div>
      }
    >
      <ExternalJobsSearchPage />
    </Suspense>
  );
}
