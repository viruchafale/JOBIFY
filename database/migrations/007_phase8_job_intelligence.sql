-- 007_phase8_job_intelligence.sql
-- Phase 8: Job Intelligence
--
-- Adds a derived, versioned, explainable intelligence layer on top of the
-- existing `external_jobs` table. The original job (title/description/
-- location/salary/etc.) is never modified — intelligence is entirely
-- separate, additive data. Nothing in Phase 1-7 is touched.
--
-- Tables:
--   job_intelligence          one row per (external_job_id, extractor_version)
--   job_skills                    controlled skill taxonomy
--   job_skill_aliases             alias -> canonical skill, case-sensitivity flag
--   job_intelligence_skills   job <-> skill, with requirement level + provenance
--   job_responsibilities      structured, ordered responsibility statements
--   job_requirements          structured, ordered requirement statements

-- ---------------------------------------------------------------------------
-- job_intelligence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_intelligence (
  id SERIAL PRIMARY KEY,
  external_job_id INTEGER NOT NULL REFERENCES external_jobs(id) ON DELETE CASCADE,
  extractor_version VARCHAR(20) NOT NULL,

  -- Cache/reprocess key: the external_jobs.content_fingerprint this row was
  -- extracted from. If a job's fingerprint changes, the existing row is
  -- stale and reprocessing is warranted; if unchanged, reprocessing can be
  -- skipped (see services/job/src/intelligence/processor.ts).
  content_fingerprint CHAR(64) NOT NULL,

  seniority VARCHAR(20) NOT NULL DEFAULT 'unknown',
  seniority_evidence VARCHAR(300),

  min_experience_years SMALLINT,
  max_experience_years SMALLINT,
  experience_evidence VARCHAR(300),

  education_level VARCHAR(20) NOT NULL DEFAULT 'unspecified',
  education_evidence VARCHAR(300),

  -- Reused, not reinvented: these mirror external_jobs.job_type /
  -- work_location verbatim (provenance = structured_source). Phase 8 does
  -- not run its own employment-type/work-arrangement classifier.
  employment_type VARCHAR(50),
  work_arrangement VARCHAR(50),

  -- Reused, not reinvented: copied through from external_jobs.salary_* for
  -- convenience so a single intelligence record is self-contained.
  salary_min NUMERIC(12, 2),
  salary_max NUMERIC(12, 2),
  salary_currency VARCHAR(3),

  summary VARCHAR(600),
  -- 'ai' when generated, NULL when no summary was produced (e.g. AI disabled).
  summary_source VARCHAR(20),

  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  processed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT job_intelligence_unique UNIQUE (external_job_id, extractor_version),
  CONSTRAINT job_intelligence_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retryable_failed')),
  CONSTRAINT job_intelligence_seniority_check
    CHECK (seniority IN ('intern','entry','junior','mid','senior','staff','principal','lead','manager','director','executive','unknown')),
  CONSTRAINT job_intelligence_education_check
    CHECK (education_level IN ('high_school','associate','bachelor','master','phd','bootcamp','none','unspecified')),
  CONSTRAINT job_intelligence_summary_source_check
    CHECK (summary_source IS NULL OR summary_source = 'ai'),
  CONSTRAINT job_intelligence_experience_check
    CHECK (min_experience_years IS NULL OR max_experience_years IS NULL OR min_experience_years <= max_experience_years)
);

CREATE INDEX IF NOT EXISTS job_intelligence_external_job_id_idx ON job_intelligence (external_job_id);
CREATE INDEX IF NOT EXISTS job_intelligence_extractor_version_idx ON job_intelligence (extractor_version);
CREATE INDEX IF NOT EXISTS job_intelligence_status_idx ON job_intelligence (status);

-- ---------------------------------------------------------------------------
-- job_skills taxonomy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_skills (
  id SERIAL PRIMARY KEY,
  canonical_name VARCHAR(100) NOT NULL UNIQUE,
  category VARCHAR(30) NOT NULL,
  skill_type VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT job_skills_skill_type_check CHECK (skill_type IN ('technical', 'soft', 'domain')),
  CONSTRAINT job_skills_category_check CHECK (category IN (
    'programming_language','framework','database','cloud','devops','tool',
    'architecture','protocol','ai_ml','mobile','soft','domain'
  ))
);

CREATE TABLE IF NOT EXISTS job_skill_aliases (
  id SERIAL PRIMARY KEY,
  skill_id INTEGER NOT NULL REFERENCES job_skills(id) ON DELETE CASCADE,
  alias VARCHAR(100) NOT NULL,
  -- Generated so uniqueness/lookup is always case-insensitive regardless of
  -- how the alias was typed; `case_sensitive` (below) separately controls
  -- whether *matching against job text* requires exact case (see "Go" vs
  -- "go" in docs/intelligence.md).
  alias_lower VARCHAR(100) GENERATED ALWAYS AS (LOWER(alias)) STORED,
  case_sensitive BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT job_skill_aliases_alias_lower_unique UNIQUE (alias_lower)
);

CREATE INDEX IF NOT EXISTS job_skill_aliases_skill_id_idx ON job_skill_aliases (skill_id);

-- ---------------------------------------------------------------------------
-- job_intelligence_skills
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_intelligence_skills (
  id SERIAL PRIMARY KEY,
  job_intelligence_id INTEGER NOT NULL REFERENCES job_intelligence(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES job_skills(id) ON DELETE CASCADE,
  -- 'required'/'preferred' only when the source wording actually supports
  -- it (see docs/intelligence.md); otherwise 'mentioned' — never inferred
  -- from a bare technology mention alone.
  requirement_level VARCHAR(20) NOT NULL DEFAULT 'mentioned',
  source VARCHAR(20) NOT NULL,
  -- NULL for deterministic matches (there is no calibrated probability to
  -- report); 0..1 only for AI-sourced skills, if ever added in a later
  -- extractor version.
  confidence REAL,
  evidence VARCHAR(200),
  CONSTRAINT job_intelligence_skills_unique UNIQUE (job_intelligence_id, skill_id),
  CONSTRAINT job_intelligence_skills_requirement_level_check
    CHECK (requirement_level IN ('required', 'preferred', 'mentioned')),
  CONSTRAINT job_intelligence_skills_source_check CHECK (source IN ('deterministic', 'ai')),
  CONSTRAINT job_intelligence_skills_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS job_intelligence_skills_job_intelligence_id_idx ON job_intelligence_skills (job_intelligence_id);
CREATE INDEX IF NOT EXISTS job_intelligence_skills_skill_id_idx ON job_intelligence_skills (skill_id);

-- ---------------------------------------------------------------------------
-- job_responsibilities / job_requirements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_responsibilities (
  id SERIAL PRIMARY KEY,
  job_intelligence_id INTEGER NOT NULL REFERENCES job_intelligence(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text VARCHAR(500) NOT NULL,
  source VARCHAR(20) NOT NULL,
  confidence REAL,
  CONSTRAINT job_responsibilities_unique UNIQUE (job_intelligence_id, position),
  CONSTRAINT job_responsibilities_source_check CHECK (source IN ('deterministic', 'ai')),
  CONSTRAINT job_responsibilities_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);
CREATE INDEX IF NOT EXISTS job_responsibilities_job_intelligence_id_idx ON job_responsibilities (job_intelligence_id);

CREATE TABLE IF NOT EXISTS job_requirements (
  id SERIAL PRIMARY KEY,
  job_intelligence_id INTEGER NOT NULL REFERENCES job_intelligence(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text VARCHAR(500) NOT NULL,
  requirement_level VARCHAR(20) NOT NULL DEFAULT 'required',
  source VARCHAR(20) NOT NULL,
  confidence REAL,
  CONSTRAINT job_requirements_unique UNIQUE (job_intelligence_id, position),
  CONSTRAINT job_requirements_level_check CHECK (requirement_level IN ('required', 'preferred')),
  CONSTRAINT job_requirements_source_check CHECK (source IN ('deterministic', 'ai')),
  CONSTRAINT job_requirements_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);
CREATE INDEX IF NOT EXISTS job_requirements_job_intelligence_id_idx ON job_requirements (job_intelligence_id);

-- ---------------------------------------------------------------------------
-- Seed taxonomy. Data-driven per docs/intelligence.md — extraction code
-- queries these tables; nothing is hard-coded as `if (text.includes(...))`
-- scattered through the codebase. Chosen from patterns actually observed in
-- live-ingested Lever/Greenhouse/Ashby postings during Phase 4-7
-- verification, not an attempt to enumerate every skill in existence.
-- ---------------------------------------------------------------------------
INSERT INTO job_skills (canonical_name, category, skill_type) VALUES
  ('Go', 'programming_language', 'technical'),
  ('Python', 'programming_language', 'technical'),
  ('Java', 'programming_language', 'technical'),
  ('JavaScript', 'programming_language', 'technical'),
  ('TypeScript', 'programming_language', 'technical'),
  ('Ruby', 'programming_language', 'technical'),
  ('C++', 'programming_language', 'technical'),
  ('C#', 'programming_language', 'technical'),
  ('Rust', 'programming_language', 'technical'),
  ('PHP', 'programming_language', 'technical'),
  ('Swift', 'programming_language', 'technical'),
  ('Kotlin', 'programming_language', 'technical'),
  ('SQL', 'programming_language', 'technical'),

  ('React', 'framework', 'technical'),
  ('Next.js', 'framework', 'technical'),
  ('Vue', 'framework', 'technical'),
  ('Angular', 'framework', 'technical'),
  ('Node.js', 'framework', 'technical'),
  ('Django', 'framework', 'technical'),
  ('FastAPI', 'framework', 'technical'),
  ('Express', 'framework', 'technical'),
  ('Ruby on Rails', 'framework', 'technical'),
  ('Spring Boot', 'framework', 'technical'),
  ('React Native', 'framework', 'technical'),

  ('PostgreSQL', 'database', 'technical'),
  ('MySQL', 'database', 'technical'),
  ('MongoDB', 'database', 'technical'),
  ('Redis', 'database', 'technical'),
  ('DynamoDB', 'database', 'technical'),
  ('Elasticsearch', 'database', 'technical'),
  ('Cassandra', 'database', 'technical'),
  ('SQLite', 'database', 'technical'),

  ('AWS', 'cloud', 'technical'),
  ('Google Cloud Platform', 'cloud', 'technical'),
  ('Azure', 'cloud', 'technical'),

  ('Docker', 'devops', 'technical'),
  ('Kubernetes', 'devops', 'technical'),
  ('Terraform', 'devops', 'technical'),
  ('Ansible', 'devops', 'technical'),
  ('Jenkins', 'devops', 'technical'),
  ('CI/CD', 'devops', 'technical'),
  ('GitHub Actions', 'devops', 'technical'),

  ('Microservices', 'architecture', 'technical'),
  ('Distributed Systems', 'architecture', 'technical'),
  ('System Design', 'architecture', 'technical'),
  ('REST', 'architecture', 'technical'),
  ('GraphQL', 'architecture', 'technical'),

  ('gRPC', 'protocol', 'technical'),
  ('Kafka', 'protocol', 'technical'),
  ('RabbitMQ', 'protocol', 'technical'),
  ('WebSocket', 'protocol', 'technical'),

  ('Machine Learning', 'ai_ml', 'technical'),
  ('Deep Learning', 'ai_ml', 'technical'),
  ('Natural Language Processing', 'ai_ml', 'technical'),
  ('TensorFlow', 'ai_ml', 'technical'),
  ('PyTorch', 'ai_ml', 'technical'),

  ('iOS', 'mobile', 'technical'),
  ('Android', 'mobile', 'technical'),

  ('Git', 'tool', 'technical'),
  ('Linux', 'tool', 'technical'),
  ('Figma', 'tool', 'technical'),

  ('Communication Skills', 'soft', 'soft'),
  ('Leadership', 'soft', 'soft'),
  ('Problem Solving', 'soft', 'soft'),
  ('Teamwork', 'soft', 'soft'),
  ('Attention To Detail', 'soft', 'soft'),

  ('Agile', 'domain', 'domain'),
  ('Scrum', 'domain', 'domain'),
  ('Fintech', 'domain', 'domain'),
  ('Healthcare', 'domain', 'domain')
ON CONFLICT (canonical_name) DO NOTHING;

-- Aliases. `case_sensitive = true` marks short/common-English-word skill
-- names (see docs/intelligence.md §False positives) where case-insensitive
-- matching would produce unacceptable false positives in ordinary prose
-- (e.g. bare "go"/"rest"/"ml" as English words, not the technology).
INSERT INTO job_skill_aliases (skill_id, alias, case_sensitive)
SELECT s.id, a.alias, a.case_sensitive
FROM (VALUES
  ('Go', 'Go', true),
  ('Go', 'Golang', false),
  ('Python', 'Python', false),
  ('Java', 'Java', false),
  ('JavaScript', 'JavaScript', false),
  ('JavaScript', 'JS', true),
  ('TypeScript', 'TypeScript', false),
  ('TypeScript', 'TS', true),
  ('Ruby', 'Ruby', false),
  ('C++', 'C++', false),
  ('C#', 'C#', false),
  ('Rust', 'Rust', false),
  ('PHP', 'PHP', true),
  ('Swift', 'Swift', false),
  ('Kotlin', 'Kotlin', false),
  ('SQL', 'SQL', true),

  ('React', 'React', false),
  ('React', 'React.js', false),
  ('React', 'ReactJS', false),
  ('Next.js', 'Next.js', false),
  ('Next.js', 'NextJS', false),
  ('Vue', 'Vue', false),
  ('Vue', 'Vue.js', false),
  ('Angular', 'Angular', false),
  ('Node.js', 'Node.js', false),
  ('Node.js', 'Node', false),
  ('Node.js', 'NodeJS', false),
  ('Django', 'Django', false),
  ('FastAPI', 'FastAPI', false),
  ('Express', 'Express.js', false),
  ('Express', 'ExpressJS', false),
  ('Express', 'Express', true),
  ('Ruby on Rails', 'Ruby on Rails', false),
  ('Ruby on Rails', 'Rails', true),
  ('Spring Boot', 'Spring Boot', false),
  ('React Native', 'React Native', false),

  ('PostgreSQL', 'PostgreSQL', false),
  ('PostgreSQL', 'Postgres', false),
  ('PostgreSQL', 'psql', true),
  ('MySQL', 'MySQL', false),
  ('MongoDB', 'MongoDB', false),
  ('MongoDB', 'Mongo', false),
  ('Redis', 'Redis', false),
  ('DynamoDB', 'DynamoDB', false),
  ('Elasticsearch', 'Elasticsearch', false),
  ('Cassandra', 'Cassandra', false),
  ('SQLite', 'SQLite', false),

  ('AWS', 'AWS', true),
  ('AWS', 'Amazon Web Services', false),
  ('Google Cloud Platform', 'GCP', true),
  ('Google Cloud Platform', 'Google Cloud Platform', false),
  ('Google Cloud Platform', 'Google Cloud', false),
  ('Azure', 'Azure', false),
  ('Azure', 'Microsoft Azure', false),

  ('Docker', 'Docker', false),
  ('Kubernetes', 'Kubernetes', false),
  ('Kubernetes', 'K8s', true),
  ('Terraform', 'Terraform', false),
  ('Ansible', 'Ansible', false),
  ('Jenkins', 'Jenkins', false),
  ('CI/CD', 'CI/CD', true),
  ('CI/CD', 'Continuous Integration', false),
  ('CI/CD', 'Continuous Deployment', false),
  ('GitHub Actions', 'GitHub Actions', false),

  ('Microservices', 'Microservices', false),
  ('Distributed Systems', 'Distributed Systems', false),
  ('System Design', 'System Design', false),
  ('REST', 'REST', true),
  ('REST', 'RESTful', false),
  ('REST', 'REST API', false),
  ('GraphQL', 'GraphQL', false),

  ('gRPC', 'gRPC', false),
  ('Kafka', 'Kafka', false),
  ('Kafka', 'Apache Kafka', false),
  ('RabbitMQ', 'RabbitMQ', false),
  ('WebSocket', 'WebSocket', false),
  ('WebSocket', 'WebSockets', false),

  ('Machine Learning', 'Machine Learning', false),
  ('Machine Learning', 'ML', true),
  ('Deep Learning', 'Deep Learning', false),
  ('Natural Language Processing', 'Natural Language Processing', false),
  ('Natural Language Processing', 'NLP', true),
  ('TensorFlow', 'TensorFlow', false),
  ('PyTorch', 'PyTorch', false),

  ('iOS', 'iOS', true),
  ('Android', 'Android', false),

  ('Git', 'Git', true),
  ('Linux', 'Linux', false),
  ('Figma', 'Figma', false),

  ('Communication Skills', 'communication skills', false),
  ('Communication Skills', 'excellent communication', false),
  ('Leadership', 'leadership skills', false),
  ('Leadership', 'team leadership', false),
  ('Problem Solving', 'problem solving', false),
  ('Problem Solving', 'problem-solving skills', false),
  ('Teamwork', 'teamwork', false),
  ('Teamwork', 'team player', false),
  ('Attention To Detail', 'attention to detail', false),

  ('Agile', 'Agile', true),
  ('Scrum', 'Scrum', false),
  ('Fintech', 'Fintech', false),
  ('Healthcare', 'Healthcare', false)
) AS a(canonical_name, alias, case_sensitive)
JOIN job_skills s ON s.canonical_name = a.canonical_name
ON CONFLICT (alias_lower) DO NOTHING;
