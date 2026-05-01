-- =============================================================================
-- Fix unique_booking constraint to ignore canceled appointments
-- - Drop the full unique constraint that blocks canceled slots
-- - Replace with a partial unique index on active bookings only
-- =============================================================================

-- Drop the existing full unique constraint (if it exists).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'unique_booking'
      AND conrelid = 'public.appointments'::regclass
  ) THEN
    ALTER TABLE public.appointments DROP CONSTRAINT unique_booking;
  END IF;
END
$$;

-- Drop any previous version of the partial index (idempotent).
DROP INDEX IF EXISTS public.unique_booking_active;

-- Create a partial unique index: only pending/confirmed appointments block a slot.
CREATE UNIQUE INDEX unique_booking_active
  ON public.appointments (user_id, date, start_time)
  WHERE status IN ('pending', 'confirmed');

NOTIFY pgrst, 'reload schema';
