-- 006_phase7_advanced_search.sql
-- Phase 7: Advanced Search
--
-- Adds PostgreSQL full-text search to the existing `external_jobs` table.
-- No new tables, no changes to Phase 3-6 tables other than this one
-- additive column + indexes on `external_jobs` itself.

-- ---------------------------------------------------------------------------
-- search_vector: a STORED GENERATED column, not a plain column + backfill
-- script. PostgreSQL computes it for every existing row as part of this
-- ALTER TABLE (a one-time table rewrite — acceptable at current data
-- volumes; see docs/search.md for the scaling note) AND automatically for
-- every row inserted/updated afterwards by the unchanged Phase 3-6
-- ingestion pipeline (normalize -> validate -> dedupe -> persist). No
-- adapter or normalization code needed to change for this.
--
-- Weights: title (A) > role/company (B) > description/location (C), so a
-- match in the job title ranks above the same words appearing only in the
-- description.
-- ---------------------------------------------------------------------------
ALTER TABLE external_jobs ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(role, '') || ' ' || coalesce(company_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '') || ' ' || coalesce(location, '')), 'C')
  ) STORED;

-- Full-text search index. GIN is the standard choice for tsvector.
CREATE INDEX IF NOT EXISTS external_jobs_search_vector_idx
  ON external_jobs USING GIN (search_vector);

-- ---------------------------------------------------------------------------
-- Structured filter indexes.
-- external_jobs_source_idx, external_jobs_is_active_idx,
-- external_jobs_fingerprint_idx and external_jobs_last_seen_at_idx already
-- exist from Phase 3 (002_phase3_ingestion_foundation.sql) and are reused
-- as-is by search filtering on source/is_active.
-- ---------------------------------------------------------------------------

-- job_type / work_location are small, fixed, normalized vocabularies
-- (see normalize.ts's JOB_TYPE_MAP / WORK_LOCATION_MAP) — search filters on
-- them use exact equality after normalizing the user's input the same way,
-- so a plain B-tree index is directly useful (unlike location/company/role,
-- which are free text matched with ILIKE '%...%' and can't benefit from a
-- plain B-tree — see docs/search.md for that documented limitation).
CREATE INDEX IF NOT EXISTS external_jobs_job_type_idx
  ON external_jobs (job_type);
CREATE INDEX IF NOT EXISTS external_jobs_work_location_idx
  ON external_jobs (work_location);

-- The single most common query shape is "active jobs, newest first" (the
-- default browse with no filters, and the tail end of every filtered
-- browse too) — a composite index serves both the WHERE is_active = true
-- filter and the ORDER BY posted_at DESC in one index scan.
CREATE INDEX IF NOT EXISTS external_jobs_active_posted_at_idx
  ON external_jobs (is_active, posted_at DESC);

-- Salary sort/filter: salary_min/salary_max are frequently NULL (most
-- sources don't expose compensation — see Phase 4/5 docs), so a partial
-- index (only rows with a known value) keeps the index small and avoids
-- indexing rows that can never satisfy a salary filter or contribute to a
-- salary sort.
CREATE INDEX IF NOT EXISTS external_jobs_salary_min_idx
  ON external_jobs (salary_min) WHERE salary_min IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_jobs_salary_max_idx
  ON external_jobs (salary_max) WHERE salary_max IS NOT NULL;
