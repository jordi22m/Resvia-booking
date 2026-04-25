-- =============================================================================
-- Add staff_id column to availability table
-- Allows per-staff availability configuration + global fallback
-- =============================================================================

-- Add staff_id column if it doesn't exist
ALTER TABLE public.availability
ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff_members(id) ON DELETE CASCADE;

-- Update the UNIQUE constraint to allow multiple rows per day (one global, one per staff)
ALTER TABLE public.availability
DROP CONSTRAINT IF EXISTS availability_user_id_day_of_week_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_availability_user_day_staff
  ON public.availability (user_id, day_of_week, COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Create index for faster staff availability queries
CREATE INDEX IF NOT EXISTS idx_availability_staff_id
  ON public.availability (staff_id);

-- Create index for joint lookups
CREATE INDEX IF NOT EXISTS idx_availability_user_staff
  ON public.availability (user_id, staff_id, day_of_week);
