-- 002_phase3_ingestion_foundation.sql
-- Phase 3: Job Ingestion Foundation
--
-- Introduces a source-agnostic ingestion model that is intentionally separate
-- from the recruiter-created `jobs` table. External jobs and recruiter jobs
-- represent different domains (sourced vs. user-created) and must not be mixed.
--
-- Tables:
--   external_job_sources  known sources + policy metadata
--   ingestion_runs        one row per ingestion execution (observability)
--   raw_external_jobs     immutable source payloads for debugging/reprocessing
--   external_jobs         normalized, deduplicated jobs (read model)

-- ---------------------------------------------------------------------------
-- external_job_sources
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_job_sources (
  id SERIAL PRIMARY KEY,
  source VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  source_type VARCHAR(50) NOT NULL DEFAULT 'api',
  base_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  policy_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- ingestion_runs
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ingestion_run_status') THEN
    CREATE TYPE ingestion_run_status AS ENUM ('running', 'completed', 'failed', 'partial');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id SERIAL PRIMARY KEY,
  source VARCHAR(100) NOT NULL,
  status ingestion_run_status NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS ingestion_runs_source_started_at_idx
  ON ingestion_runs (source, started_at DESC);

-- ---------------------------------------------------------------------------
-- raw_external_jobs (immutable source payloads)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_external_jobs (
  id SERIAL PRIMARY KEY,
  source VARCHAR(100) NOT NULL,
  source_job_id VARCHAR(255) NOT NULL,
  raw_payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ingestion_run_id INTEGER REFERENCES ingestion_runs(id) ON DELETE SET NULL
);

-- Same raw job re-fetched within one run is stored once.
CREATE UNIQUE INDEX IF NOT EXISTS raw_external_jobs_source_job_run_uidx
  ON raw_external_jobs (source, source_job_id, ingestion_run_id);
CREATE INDEX IF NOT EXISTS raw_external_jobs_source_job_idx
  ON raw_external_jobs (source, source_job_id);
CREATE INDEX IF NOT EXISTS raw_external_jobs_run_idx
  ON raw_external_jobs (ingestion_run_id);

-- ---------------------------------------------------------------------------
-- external_jobs (normalized read model)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_jobs (
  id SERIAL PRIMARY KEY,
  source VARCHAR(100) NOT NULL,
  source_job_id VARCHAR(255) NOT NULL,
  canonical_url TEXT NOT NULL,
  apply_url TEXT,
  company_name VARCHAR(255) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  location VARCHAR(255),
  job_type VARCHAR(50),
  work_location VARCHAR(50),
  role VARCHAR(255),
  salary_min NUMERIC(12,2),
  salary_max NUMERIC(12,2),
  salary_currency VARCHAR(3),
  posted_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT true,
  content_fingerprint CHAR(64) NOT NULL,
  raw_job_id INTEGER REFERENCES raw_external_jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT external_jobs_source_job_id_uidx UNIQUE (source, source_job_id),
  CONSTRAINT external_jobs_canonical_url_uidx UNIQUE (canonical_url)
);

-- Lookup hot paths: dedupe (fingerprint), listing (active/recency), identity.
CREATE INDEX IF NOT EXISTS external_jobs_source_idx
  ON external_jobs (source);
CREATE INDEX IF NOT EXISTS external_jobs_fingerprint_idx
  ON external_jobs (content_fingerprint);
CREATE INDEX IF NOT EXISTS external_jobs_is_active_idx
  ON external_jobs (is_active);
CREATE INDEX IF NOT EXISTS external_jobs_last_seen_at_idx
  ON external_jobs (last_seen_at DESC);

-- ---------------------------------------------------------------------------
-- Seed: the local fixture source (no network access required).
-- Real sources (Lever, ...) are seeded by their own Phase 4+ migrations.
-- ---------------------------------------------------------------------------
INSERT INTO external_job_sources (source, display_name, source_type, enabled, policy_url)
VALUES ('fixture', 'Fixture (local deterministic test source)', 'fixture', true, NULL)
ON CONFLICT (source) DO NOTHING;
