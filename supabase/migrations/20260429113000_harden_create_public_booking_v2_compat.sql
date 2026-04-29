-- =============================================================================
-- Harden create_public_booking_v2 compatibility
-- Ensures PostgREST can resolve RPC calls from different frontend payload shapes:
-- 1) Named p_* args
-- 2) Legacy named args (slug, service_id, ...)
-- 3) Single json/jsonb arg ({ payload: ... } style)
-- =============================================================================

-- Canonical v2 signature (p_*): delegate to stable base function.
CREATE OR REPLACE FUNCTION public.create_public_booking_v2(
  p_slug           text,
  p_service_id     uuid,
  p_staff_id       uuid,
  p_date           date,
  p_start_time     time,
  p_end_time       time,
  p_customer_name  text,
  p_customer_phone text,
  p_customer_email text DEFAULT NULL,
  p_notes          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.create_public_booking(
    p_slug,
    p_service_id,
    p_staff_id,
    p_date,
    p_start_time,
    p_end_time,
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    p_notes
  );
$$;

-- Legacy v2 signature used by some frontend builds.
CREATE OR REPLACE FUNCTION public.create_public_booking_v2(
  slug       text,
  service_id uuid,
  name       text,
  phone      text,
  email      text,
  date       date,
  start_time time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration_mins integer := 30;
  v_end_time time;
BEGIN
  SELECT COALESCE(s.duration, 30)
  INTO v_duration_mins
  FROM public.services s
  WHERE s.id = service_id
  LIMIT 1;

  v_end_time := (start_time + make_interval(mins => v_duration_mins))::time;

  RETURN public.create_public_booking_v2(
    slug,
    service_id,
    NULL,
    date,
    start_time,
    v_end_time,
    name,
    phone,
    email,
    NULL
  );
END;
$$;

-- JSONB wrapper for callers that send one unnamed payload object.
CREATE OR REPLACE FUNCTION public.create_public_booking_v2(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_service_id uuid;
  v_staff_id uuid;
  v_date date;
  v_start_time time;
  v_end_time time;
  v_name text;
  v_phone text;
  v_email text;
  v_notes text;
  v_duration_mins integer := 30;
  v_end_text text;
BEGIN
  v_slug := COALESCE(payload ->> 'p_slug', payload ->> 'slug');
  v_service_id := NULLIF(COALESCE(payload ->> 'p_service_id', payload ->> 'service_id'), '')::uuid;
  v_staff_id := NULLIF(COALESCE(payload ->> 'p_staff_id', payload ->> 'staff_id'), '')::uuid;
  v_date := NULLIF(COALESCE(payload ->> 'p_date', payload ->> 'date'), '')::date;
  v_start_time := NULLIF(COALESCE(payload ->> 'p_start_time', payload ->> 'start_time'), '')::time;
  v_end_text := NULLIF(COALESCE(payload ->> 'p_end_time', payload ->> 'end_time'), '');
  v_name := COALESCE(payload ->> 'p_customer_name', payload ->> 'name');
  v_phone := COALESCE(payload ->> 'p_customer_phone', payload ->> 'phone');
  v_email := COALESCE(payload ->> 'p_customer_email', payload ->> 'email');
  v_notes := COALESCE(payload ->> 'p_notes', payload ->> 'notes');

  IF v_slug IS NULL OR v_service_id IS NULL OR v_date IS NULL OR v_start_time IS NULL OR v_name IS NULL OR v_phone IS NULL THEN
    RAISE EXCEPTION 'Parametros incompletos para create_public_booking_v2(payload jsonb)';
  END IF;

  IF v_end_text IS NOT NULL THEN
    v_end_time := v_end_text::time;
  ELSE
    SELECT COALESCE(s.duration, 30)
    INTO v_duration_mins
    FROM public.services s
    WHERE s.id = v_service_id
    LIMIT 1;

    v_end_time := (v_start_time + make_interval(mins => v_duration_mins))::time;
  END IF;

  RETURN public.create_public_booking_v2(
    v_slug,
    v_service_id,
    v_staff_id,
    v_date,
    v_start_time,
    v_end_time,
    v_name,
    v_phone,
    v_email,
    v_notes
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_public_booking_v2(
  text, uuid, uuid, date, time, time, text, text, text, text
) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_public_booking_v2(
  text, uuid, text, text, text, date, time
) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_public_booking_v2(jsonb)
TO anon, authenticated;

-- Force PostgREST to refresh schema cache now.
NOTIFY pgrst, 'reload schema';
