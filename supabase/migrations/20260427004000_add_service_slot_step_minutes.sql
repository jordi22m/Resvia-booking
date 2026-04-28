-- =============================================================================
-- Add per-service slot step while preserving compatibility with interval_minutes
-- =============================================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS slot_step_minutes INTEGER;

UPDATE public.services
SET slot_step_minutes = COALESCE(slot_step_minutes, interval_minutes)
WHERE slot_step_minutes IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'services_slot_step_minutes_non_negative'
  ) THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_slot_step_minutes_non_negative
      CHECK (slot_step_minutes IS NULL OR slot_step_minutes >= 0)
      NOT VALID;
  END IF;
END
$$;
