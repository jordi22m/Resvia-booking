-- =============================================================================
-- Ensure services.interval_minutes exists in drifted environments
-- =============================================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS interval_minutes INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'services_interval_minutes_non_negative'
  ) THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_interval_minutes_non_negative
      CHECK (interval_minutes IS NULL OR interval_minutes >= 0)
      NOT VALID;
  END IF;
END
$$;
