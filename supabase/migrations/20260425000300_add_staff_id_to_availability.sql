-- =============================================================================
-- Add staff_id column to availability table
-- Allows per-staff availability configuration + global fallback
-- =============================================================================

-- Add staff_id column if it doesn't exist
ALTER TABLE public.availability
ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES public.staff_members(id) ON DELETE CASCADE;

-- Drop old constraint and indexes if they exist
ALTER TABLE public.availability
DROP CONSTRAINT IF EXISTS availability_user_id_day_of_week_key;

DROP INDEX IF EXISTS uq_availability_user_day_staff;
DROP INDEX IF EXISTS idx_availability_staff_id;
DROP INDEX IF EXISTS idx_availability_user_staff;

-- AGGRESSIVE: Remove ALL duplicates except the one with the HIGHEST id (most recent insert)
-- This ensures we keep one and only one row per (user_id, day_of_week, staff_id)
DELETE FROM public.availability
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, day_of_week, COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid))
    id
  FROM public.availability
  ORDER BY user_id, day_of_week, COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid), created_at DESC
);

-- Create UNIQUE index to allow multiple rows per day (one global, one per staff)
CREATE UNIQUE INDEX uq_availability_user_day_staff
  ON public.availability (user_id, day_of_week, COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Create index for faster staff availability queries
CREATE INDEX idx_availability_staff_id
  ON public.availability (staff_id);

-- Create index for joint lookups
CREATE INDEX idx_availability_user_staff
  ON public.availability (user_id, staff_id, day_of_week);
