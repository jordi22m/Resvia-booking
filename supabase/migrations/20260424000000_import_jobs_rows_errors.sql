-- =============================================================================
-- Import infrastructure (phase 1): jobs, rows, errors
-- Scope: database only (no backend logic)
-- Multi-tenant key: business_id (references public.profiles.id)
-- =============================================================================

-- 1) ENUMS --------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_job_status') THEN
    CREATE TYPE public.import_job_status AS ENUM (
      'uploaded',
      'mapping_required',
      'dry_run_ready',
      'validated',
      'importing',
      'completed',
      'partial',
      'failed',
      'cancelled'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_source_type') THEN
    CREATE TYPE public.import_source_type AS ENUM (
      'csv',
      'xlsx',
      'google_calendar',
      'api',
      'manual'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_row_status') THEN
    CREATE TYPE public.import_row_status AS ENUM (
      'parsed',
      'valid',
      'invalid',
      'needs_review',
      'ready_to_import',
      'imported',
      'updated',
      'linked',
      'skipped_duplicate',
      'conflict',
      'error'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_entity_type') THEN
    CREATE TYPE public.import_entity_type AS ENUM (
      'client',
      'appointment',
      'service',
      'mixed',
      'unknown'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_error_severity') THEN
    CREATE TYPE public.import_error_severity AS ENUM (
      'warning',
      'error',
      'fatal'
    );
  END IF;
END
$$;

-- 2) TABLE: import_jobs -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-tenant partition key (business in RESVIA)
  business_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- User who started the job
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  source_type public.import_source_type NOT NULL,
  source_ref TEXT,
  source_filename TEXT,

  -- Idempotency / dedup markers
  file_sha256 TEXT,
  idempotency_key TEXT,
  source_sync_cursor TEXT,

  status public.import_job_status NOT NULL DEFAULT 'uploaded',

  -- Retry control / operability
  attempt_no INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  retry_of_job_id UUID REFERENCES public.import_jobs(id) ON DELETE SET NULL,

  -- Counters for preview + final result
  total_rows INTEGER NOT NULL DEFAULT 0,
  parsed_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  needs_review_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  updated_rows INTEGER NOT NULL DEFAULT 0,
  linked_rows INTEGER NOT NULL DEFAULT 0,
  skipped_duplicate_rows INTEGER NOT NULL DEFAULT 0,
  conflict_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,

  -- Metadata and diagnostics
  timezone_hint TEXT,
  mapping_version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,

  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT import_jobs_file_sha256_chk
    CHECK (file_sha256 IS NULL OR length(file_sha256) >= 32),
  CONSTRAINT import_jobs_attempt_chk
    CHECK (attempt_no >= 1 AND max_attempts >= 1 AND attempt_no <= max_attempts),
  CONSTRAINT import_jobs_counters_non_negative_chk
    CHECK (
      total_rows >= 0
      AND parsed_rows >= 0
      AND valid_rows >= 0
      AND invalid_rows >= 0
      AND needs_review_rows >= 0
      AND imported_rows >= 0
      AND updated_rows >= 0
      AND linked_rows >= 0
      AND skipped_duplicate_rows >= 0
      AND conflict_rows >= 0
      AND error_rows >= 0
    ),
  CONSTRAINT import_jobs_finished_after_started_chk
    CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

ALTER TABLE public.import_jobs
  ADD CONSTRAINT uq_import_jobs_id_business UNIQUE (id, business_id);

-- 3) TABLE: import_rows -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  job_id UUID NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  row_number INTEGER NOT NULL,
  entity_type public.import_entity_type NOT NULL DEFAULT 'unknown',
  status public.import_row_status NOT NULL DEFAULT 'parsed',

  -- Raw and transformed payloads for traceability
  raw_payload JSONB NOT NULL,
  normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Mapping / quality details
  mapping_confidence NUMERIC(5,4),
  needs_review BOOLEAN NOT NULL DEFAULT false,
  review_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Idempotency fields (row-level and cross-source)
  source_system TEXT,
  external_record_id TEXT,
  external_row_id TEXT,
  row_hash TEXT,
  canonical_fingerprint TEXT,

  -- Link to resolved domain entities (optional at this phase)
  resolved_client_id UUID,
  resolved_service_id UUID,
  resolved_staff_id UUID,
  resolved_appointment_id UUID,

  -- Retry / worker diagnostics
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  worker_id TEXT,
  locked_at TIMESTAMPTZ,

  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT import_rows_row_number_chk CHECK (row_number > 0),
  CONSTRAINT import_rows_attempt_count_chk CHECK (attempt_count >= 0),
  CONSTRAINT import_rows_mapping_confidence_chk
    CHECK (mapping_confidence IS NULL OR (mapping_confidence >= 0 AND mapping_confidence <= 1)),
  CONSTRAINT fk_import_rows_job_business
    FOREIGN KEY (job_id, business_id)
    REFERENCES public.import_jobs(id, business_id)
    ON DELETE CASCADE
);

ALTER TABLE public.import_rows
  ADD CONSTRAINT uq_import_rows_id_job UNIQUE (id, job_id);

-- 4) TABLE: import_errors -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  job_id UUID NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
  row_id UUID REFERENCES public.import_rows(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  severity public.import_error_severity NOT NULL DEFAULT 'error',
  error_code TEXT NOT NULL,
  field_name TEXT,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,

  is_retriable BOOLEAN NOT NULL DEFAULT false,
  retry_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT import_errors_retry_count_chk CHECK (retry_count >= 0),
  CONSTRAINT fk_import_errors_job_business
    FOREIGN KEY (job_id, business_id)
    REFERENCES public.import_jobs(id, business_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_import_errors_row_job
    FOREIGN KEY (row_id, job_id)
    REFERENCES public.import_rows(id, job_id)
    ON DELETE CASCADE
);

-- 5) INDEXES -----------------------------------------------------------------
-- import_jobs
CREATE INDEX IF NOT EXISTS idx_import_jobs_business_status_created
  ON public.import_jobs (business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_jobs_business_created
  ON public.import_jobs (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_jobs_source_type
  ON public.import_jobs (source_type);

CREATE INDEX IF NOT EXISTS idx_import_jobs_file_sha256
  ON public.import_jobs (business_id, file_sha256)
  WHERE file_sha256 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_jobs_business_idempotency
  ON public.import_jobs (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_import_jobs_retry_of
  ON public.import_jobs (retry_of_job_id)
  WHERE retry_of_job_id IS NOT NULL;

-- import_rows
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_rows_job_row_number
  ON public.import_rows (job_id, row_number);

CREATE INDEX IF NOT EXISTS idx_import_rows_job_status
  ON public.import_rows (job_id, status);

CREATE INDEX IF NOT EXISTS idx_import_rows_business_status
  ON public.import_rows (business_id, status);

CREATE INDEX IF NOT EXISTS idx_import_rows_job_entity_status
  ON public.import_rows (job_id, entity_type, status);

CREATE INDEX IF NOT EXISTS idx_import_rows_next_retry
  ON public.import_rows (next_retry_at)
  WHERE next_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_import_rows_external_key
  ON public.import_rows (business_id, source_system, external_record_id)
  WHERE source_system IS NOT NULL AND external_record_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_rows_job_external_row
  ON public.import_rows (job_id, external_row_id)
  WHERE external_row_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_rows_job_fingerprint
  ON public.import_rows (job_id, canonical_fingerprint)
  WHERE canonical_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_import_rows_row_hash
  ON public.import_rows (job_id, row_hash)
  WHERE row_hash IS NOT NULL;

-- import_errors
CREATE INDEX IF NOT EXISTS idx_import_errors_job_created
  ON public.import_errors (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_errors_row
  ON public.import_errors (row_id)
  WHERE row_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_import_errors_business_severity
  ON public.import_errors (business_id, severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_import_errors_code
  ON public.import_errors (job_id, error_code);

-- 6) RLS ---------------------------------------------------------------------
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_errors ENABLE ROW LEVEL SECURITY;

-- Tenant isolation through business owner (profiles.user_id)
DROP POLICY IF EXISTS "Users can view own import jobs" ON public.import_jobs;
CREATE POLICY "Users can view own import jobs"
  ON public.import_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = import_jobs.business_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own import jobs" ON public.import_jobs;
CREATE POLICY "Users can insert own import jobs"
  ON public.import_jobs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = import_jobs.business_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own import jobs" ON public.import_jobs;
CREATE POLICY "Users can update own import jobs"
  ON public.import_jobs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = import_jobs.business_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view own import rows" ON public.import_rows;
CREATE POLICY "Users can view own import rows"
  ON public.import_rows FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = import_rows.business_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own import rows" ON public.import_rows;
CREATE POLICY "Users can insert own import rows"
  ON public.import_rows FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = import_rows.business_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own import rows" ON public.import_rows;
CREATE POLICY "Users can update own import rows"
  ON public.import_rows FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = import_rows.business_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view own import errors" ON public.import_errors;
CREATE POLICY "Users can view own import errors"
  ON public.import_errors FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = import_errors.business_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own import errors" ON public.import_errors;
CREATE POLICY "Users can insert own import errors"
  ON public.import_errors FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = import_errors.business_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own import errors" ON public.import_errors;
CREATE POLICY "Users can update own import errors"
  ON public.import_errors FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = import_errors.business_id
        AND p.user_id = auth.uid()
    )
  );

-- 7) UPDATED_AT TRIGGERS -----------------------------------------------------
-- Uses existing helper function: public.update_updated_at_column()
DROP TRIGGER IF EXISTS update_import_jobs_updated_at ON public.import_jobs;
CREATE TRIGGER update_import_jobs_updated_at
  BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_import_rows_updated_at ON public.import_rows;
CREATE TRIGGER update_import_rows_updated_at
  BEFORE UPDATE ON public.import_rows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
