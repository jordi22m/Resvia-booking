-- =============================================================================
-- Allow multiple availability ranges per day for global and staff schedules
-- Fixes 409 conflicts when saving morning + afternoon ranges on the same day
-- =============================================================================

-- Remove exact duplicate rows before tightening the new unique index.
DELETE FROM public.availability
WHERE id NOT IN (
  SELECT DISTINCT ON (
    user_id,
    day_of_week,
    start_time,
    end_time,
    COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) id
  FROM public.availability
  ORDER BY
    user_id,
    day_of_week,
    start_time,
    end_time,
    COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid),
    created_at DESC
);

DROP INDEX IF EXISTS uq_availability_user_day_staff;

CREATE UNIQUE INDEX uq_availability_user_day_staff_time
  ON public.availability (
    user_id,
    day_of_week,
    start_time,
    end_time,
    COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );