-- 001_phase1_application_integrity.sql
-- Enforces applicant identity, foreign keys, and unique constraint on applications

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS applicant_user_id INTEGER;

UPDATE applications AS application
SET applicant_user_id = users.user_id
FROM users
WHERE application.applicant_user_id IS NULL
  AND lower(application.applicant_email) = lower(users.email);

DO $$
DECLARE
  unmatched_count INTEGER;
  duplicate_count INTEGER;
  orphan_company_count INTEGER;
  orphan_job_count INTEGER;
BEGIN
  SELECT count(*) INTO unmatched_count
  FROM applications
  WHERE applicant_user_id IS NULL;

  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT job_id, applicant_user_id
    FROM applications
    WHERE applicant_user_id IS NOT NULL
    GROUP BY job_id, applicant_user_id
    HAVING count(*) > 1
  ) duplicates;

  SELECT count(*) INTO orphan_company_count
  FROM companies company
  LEFT JOIN users recruiter ON recruiter.user_id = company.recruiter_id
  WHERE recruiter.user_id IS NULL;

  SELECT count(*) INTO orphan_job_count
  FROM jobs job
  LEFT JOIN users recruiter ON recruiter.user_id = job.posted_by_recruiter_id
  WHERE recruiter.user_id IS NULL;

  IF unmatched_count > 0 OR duplicate_count > 0 OR orphan_company_count > 0 OR orphan_job_count > 0 THEN
    RAISE EXCEPTION
      'Phase 1 migration stopped: unmatched applications %, duplicate applications %, orphan companies %, orphan jobs %',
      unmatched_count, duplicate_count, orphan_company_count, orphan_job_count;
  END IF;
END $$;

ALTER TABLE applications
  ALTER COLUMN applicant_user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_applicant_user_id_fkey'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_applicant_user_id_fkey
      FOREIGN KEY (applicant_user_id) REFERENCES users(user_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_recruiter_id_fkey'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_recruiter_id_fkey
      FOREIGN KEY (recruiter_id) REFERENCES users(user_id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_posted_by_recruiter_id_fkey'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_posted_by_recruiter_id_fkey
      FOREIGN KEY (posted_by_recruiter_id) REFERENCES users(user_id) ON DELETE RESTRICT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_job_id_applicant_email_key'
  ) THEN
    ALTER TABLE applications DROP CONSTRAINT applications_job_id_applicant_email_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_job_id_applicant_user_id_key'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_job_id_applicant_user_id_key
      UNIQUE (job_id, applicant_user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS applications_applicant_user_id_applied_at_idx
  ON applications (applicant_user_id, applied_at DESC);
