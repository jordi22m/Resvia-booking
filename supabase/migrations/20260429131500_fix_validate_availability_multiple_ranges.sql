-- =============================================================================
-- Fix validate_appointment_availability for multiple availability ranges/day
-- Root cause: previous implementation could reject valid slots when a day has
-- more than one active availability interval.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_appointment_availability(
  p_user_id UUID,
  p_date DATE,
  p_start_time TIME,
  p_end_time TIME
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  day_of_week_val INTEGER;
  has_valid_window BOOLEAN;
BEGIN
  day_of_week_val := EXTRACT(DOW FROM p_date);

  SELECT EXISTS (
    SELECT 1
    FROM public.availability a
    WHERE a.user_id = p_user_id
      AND a.day_of_week = day_of_week_val
      AND COALESCE(
        (to_jsonb(a) ->> 'is_active')::boolean,
        (to_jsonb(a) ->> 'is_available')::boolean,
        true
      ) = true
      AND p_start_time >= a.start_time
      AND p_end_time <= a.end_time
  ) INTO has_valid_window;

  RETURN COALESCE(has_valid_window, FALSE);
END;
$$;

NOTIFY pgrst, 'reload schema';
