-- 003_phase4_lever_source.sql
-- Phase 4: Live Lever Ingestion
--
-- Seeds the `lever` row into the Phase 3 `external_job_sources` registry.
-- No schema changes: Lever jobs live in the existing `external_jobs`,
-- `raw_external_jobs` and `ingestion_runs` tables introduced in
-- 002_phase3_ingestion_foundation.sql.

INSERT INTO external_job_sources (source, display_name, source_type, base_url, enabled, policy_url)
VALUES (
  'lever',
  'Lever',
  'api',
  'https://api.lever.co/v0/postings',
  true,
  'https://www.lever.co/privacy/'
)
ON CONFLICT (source) DO NOTHING;
