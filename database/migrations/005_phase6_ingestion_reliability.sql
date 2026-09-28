-- 005_phase6_ingestion_reliability.sql
-- Phase 6: Scheduling + Ingestion Reliability
--
-- Adds:
--   1. Audit metadata on the existing ingestion_runs table (trigger_type,
--      attempt, scheduled_for, duration_ms) — additive, no redesign.
--   2. ingestion_locks — a persistent DB-backed lease lock, one row per
--      source, used instead of a session-level advisory lock because the
--      job service talks to Postgres over Neon's stateless HTTP driver
--      (@neondatabase/serverless `neon()`), which does not guarantee the
--      same underlying connection stays alive for an entire ingestion run.
--   3. ingestion_source_health — one row per source, updated after every
--      ingestion attempt (see services/job/src/ingestion/scheduler/health.ts
--      for the exact semantics of each field).
--
-- No changes to external_jobs / raw_external_jobs / external_job_sources.
-- Stale-job detection (Phase 6) is derived entirely from existing
-- ingestion_runs history + external_jobs.last_seen_at — no schema change
-- needed for that (see services/job/src/ingestion/scheduler/staleJobs.ts).

-- ---------------------------------------------------------------------------
-- ingestion_runs: additive audit columns
-- ---------------------------------------------------------------------------
ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS trigger_type VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_runs_trigger_type_check'
  ) THEN
    ALTER TABLE ingestion_runs
      ADD CONSTRAINT ingestion_runs_trigger_type_check
      CHECK (trigger_type IN ('manual', 'scheduled', 'retry'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_runs_attempt_check'
  ) THEN
    ALTER TABLE ingestion_runs
      ADD CONSTRAINT ingestion_runs_attempt_check
      CHECK (attempt >= 1);
  END IF;
END $$;

-- Speeds up the stale-job correlated subquery (COUNT of completed runs for
-- a source that started after a given job's last_seen_at).
CREATE INDEX IF NOT EXISTS ingestion_runs_source_status_started_idx
  ON ingestion_runs (source, status, started_at);

-- ---------------------------------------------------------------------------
-- ingestion_locks — one active lock per source (lease with TTL)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_locks (
  source VARCHAR(100) PRIMARY KEY REFERENCES external_job_sources(source) ON DELETE CASCADE,
  owner_id VARCHAR(255) NOT NULL,
  locked_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ingestion_locks_locked_until_idx
  ON ingestion_locks (locked_until);

-- ---------------------------------------------------------------------------
-- ingestion_source_health — one row per source, updated after every attempt
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_source_health (
  source VARCHAR(100) PRIMARY KEY REFERENCES external_job_sources(source) ON DELETE CASCADE,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_status ingestion_run_status,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  total_runs INTEGER NOT NULL DEFAULT 0,
  total_successes INTEGER NOT NULL DEFAULT 0,
  total_failures INTEGER NOT NULL DEFAULT 0,
  last_duration_ms INTEGER,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ingestion_source_health_consecutive_failures_check CHECK (consecutive_failures >= 0),
  CONSTRAINT ingestion_source_health_total_runs_check CHECK (total_runs >= 0)
);
