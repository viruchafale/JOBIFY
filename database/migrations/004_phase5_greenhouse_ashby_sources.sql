-- 004_phase5_greenhouse_ashby_sources.sql
-- Phase 5: Multi-Source Ingestion — Greenhouse + Ashby
--
-- Seeds `greenhouse` and `ashby` into the Phase 3 `external_job_sources`
-- registry. No schema changes: Greenhouse/Ashby jobs live in the existing
-- `external_jobs`, `raw_external_jobs` and `ingestion_runs` tables
-- introduced in 002_phase3_ingestion_foundation.sql, exactly like Lever
-- (003_phase4_lever_source.sql).

INSERT INTO external_job_sources (source, display_name, source_type, base_url, enabled, policy_url)
VALUES (
  'greenhouse',
  'Greenhouse',
  'api',
  'https://boards-api.greenhouse.io/v1/boards',
  true,
  'https://www.greenhouse.io/privacy-policy'
)
ON CONFLICT (source) DO NOTHING;

INSERT INTO external_job_sources (source, display_name, source_type, base_url, enabled, policy_url)
VALUES (
  'ashby',
  'Ashby',
  'api',
  'https://api.ashbyhq.com/posting-api/job-board',
  true,
  'https://www.ashbyhq.com/privacy'
)
ON CONFLICT (source) DO NOTHING;
