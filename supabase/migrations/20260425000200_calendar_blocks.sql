-- =============================================================================
-- Calendar Blocks: blocked ranges and closed days
-- Types supported: booking (reserved), blocked (manual lock), closed (day closure)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.calendar_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('booking', 'blocked', 'closed')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calendar_blocks_time_chk CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_calendar_blocks_business_start
  ON public.calendar_blocks (business_id, start_time);

CREATE INDEX IF NOT EXISTS idx_calendar_blocks_business_end
  ON public.calendar_blocks (business_id, end_time);

ALTER TABLE public.calendar_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own calendar blocks" ON public.calendar_blocks;
CREATE POLICY "Users can view own calendar blocks"
  ON public.calendar_blocks FOR SELECT
  USING (business_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own calendar blocks" ON public.calendar_blocks;
CREATE POLICY "Users can insert own calendar blocks"
  ON public.calendar_blocks FOR INSERT
  WITH CHECK (business_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own calendar blocks" ON public.calendar_blocks;
CREATE POLICY "Users can update own calendar blocks"
  ON public.calendar_blocks FOR UPDATE
  USING (business_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own calendar blocks" ON public.calendar_blocks;
CREATE POLICY "Users can delete own calendar blocks"
  ON public.calendar_blocks FOR DELETE
  USING (business_id = auth.uid());

DROP POLICY IF EXISTS "Public can view calendar blocks for active booking" ON public.calendar_blocks;
CREATE POLICY "Public can view calendar blocks for active booking"
  ON public.calendar_blocks FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = calendar_blocks.business_id
        AND p.booking_enabled = true
    )
  );

GRANT SELECT ON public.calendar_blocks TO anon, authenticated;

DROP TRIGGER IF EXISTS update_calendar_blocks_updated_at ON public.calendar_blocks;
CREATE TRIGGER update_calendar_blocks_updated_at
  BEFORE UPDATE ON public.calendar_blocks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.validate_appointment_calendar_blocks()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_start_ts TIMESTAMP;
  v_end_ts   TIMESTAMP;
  v_conflict BOOLEAN;
BEGIN
  IF NEW.status NOT IN ('pending', 'confirmed') THEN
    RETURN NEW;
  END IF;

  v_start_ts := (NEW.date + NEW.start_time);
  v_end_ts := (NEW.date + NEW.end_time);

  SELECT EXISTS (
    SELECT 1
    FROM public.calendar_blocks cb
    WHERE cb.business_id = NEW.user_id
      AND cb.type IN ('blocked', 'closed')
      AND tsrange(cb.start_time, cb.end_time, '[)') && tsrange(v_start_ts, v_end_ts, '[)')
  ) INTO v_conflict;

  IF v_conflict THEN
    RAISE EXCEPTION 'Horario bloqueado o dia cerrado';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_appointment_calendar_blocks ON public.appointments;
CREATE TRIGGER trg_validate_appointment_calendar_blocks
  BEFORE INSERT OR UPDATE OF date, start_time, end_time, status
  ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_appointment_calendar_blocks();
