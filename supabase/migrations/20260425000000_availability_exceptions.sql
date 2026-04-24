-- =============================================================================
-- Availability Exceptions: Block dates or override weekly availability
-- Scope: Date-specific availability overrides (holidays, special hours, etc.)
-- Multi-tenant key: business_id (references public.profiles.id)
-- =============================================================================

-- 1) TABLE: availability_exceptions -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.availability_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-tenant key (business)
  business_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Date this exception applies to (YYYY-MM-DD format)
  exception_date DATE NOT NULL,

  -- If true, business is completely closed on this date
  is_closed BOOLEAN NOT NULL DEFAULT false,

  -- Custom availability window for this date (only used if is_closed = false)
  -- If null, uses normal weekly availability for this day
  start_time TIME,
  end_time TIME,

  -- Reason/description (optional)
  reason TEXT,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT availability_exceptions_times_chk
    CHECK (
      is_closed = true OR (start_time IS NULL AND end_time IS NULL) OR
      (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
    )
);

-- 2) INDEXES ------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_availability_exceptions_business_date
  ON public.availability_exceptions (business_id, exception_date);

CREATE INDEX IF NOT EXISTS idx_availability_exceptions_business_date
  ON public.availability_exceptions (business_id, exception_date DESC);

CREATE INDEX IF NOT EXISTS idx_availability_exceptions_date_range
  ON public.availability_exceptions (business_id, exception_date)
  WHERE is_closed = false;

-- 3) RLS ------------------------------------------------------------------
ALTER TABLE public.availability_exceptions ENABLE ROW LEVEL SECURITY;

-- Tenant isolation through business owner (profiles.user_id)
DROP POLICY IF EXISTS "Users can view own exceptions" ON public.availability_exceptions;
CREATE POLICY "Users can view own exceptions"
  ON public.availability_exceptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = availability_exceptions.business_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own exceptions" ON public.availability_exceptions;
CREATE POLICY "Users can insert own exceptions"
  ON public.availability_exceptions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = availability_exceptions.business_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own exceptions" ON public.availability_exceptions;
CREATE POLICY "Users can update own exceptions"
  ON public.availability_exceptions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = availability_exceptions.business_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete own exceptions" ON public.availability_exceptions;
CREATE POLICY "Users can delete own exceptions"
  ON public.availability_exceptions FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = availability_exceptions.business_id
        AND p.user_id = auth.uid()
    )
  );

-- 4) UPDATED_AT TRIGGER --------------------------------------------------
DROP TRIGGER IF EXISTS update_availability_exceptions_updated_at ON public.availability_exceptions;
CREATE TRIGGER update_availability_exceptions_updated_at
  BEFORE UPDATE ON public.availability_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) GRANT PUBLIC READ ACCESS FOR BOOKING PAGE ------------------------------
-- Public bookings need to read exceptions to check if date is blocked
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated;

GRANT SELECT ON public.availability_exceptions TO anon, authenticated;

-- Create RLS policy for public access (via slug/business_id lookup)
DROP POLICY IF EXISTS "Public can view exceptions via slug" ON public.availability_exceptions;
CREATE POLICY "Public can view exceptions via slug"
  ON public.availability_exceptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = availability_exceptions.business_id
        AND p.booking_enabled = true
    )
  );
