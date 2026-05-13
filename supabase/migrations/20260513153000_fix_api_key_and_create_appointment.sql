-- =============================================================================
-- Fixes for API-first public API stability
-- - hash_api_key must use extensions.digest for reproducible environments
-- - api_create_appointment must not read unassigned record when customer_id is null
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hash_api_key(p_api_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(extensions.digest(COALESCE(p_api_key, ''), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.api_create_appointment(
  p_workspace_id uuid,
  p_service_id uuid,
  p_staff_id uuid DEFAULT NULL,
  p_date date DEFAULT NULL,
  p_start_time time DEFAULT NULL,
  p_end_time time DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_phone text DEFAULT NULL,
  p_customer_email text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_customer RECORD;
  v_name text;
  v_phone text;
  v_email text;
  v_result jsonb;
  v_appointment_id uuid;
BEGIN
  IF p_service_id IS NULL OR p_date IS NULL OR p_start_time IS NULL THEN
    RAISE EXCEPTION 'service_id, date y start_time son requeridos';
  END IF;

  SELECT p.id, p.user_id, p.slug
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = p_workspace_id
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Workspace no encontrado';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT c.id, c.name, c.phone, c.email
    INTO v_customer
    FROM public.customers c
    WHERE c.id = p_customer_id
      AND c.user_id = v_profile.user_id
    LIMIT 1;

    IF v_customer.id IS NULL THEN
      RAISE EXCEPTION 'customer_id no pertenece a este workspace';
    END IF;
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_customer_name, '')), '');
  v_phone := NULLIF(btrim(COALESCE(p_customer_phone, '')), '');
  v_email := NULLIF(btrim(COALESCE(p_customer_email, '')), '');

  IF p_customer_id IS NOT NULL THEN
    v_name := COALESCE(v_name, v_customer.name);
    v_phone := COALESCE(v_phone, NULLIF(btrim(COALESCE(v_customer.phone, '')), ''));
    v_email := COALESCE(v_email, NULLIF(btrim(COALESCE(v_customer.email, '')), ''));
  END IF;

  IF v_name IS NULL OR v_phone IS NULL THEN
    RAISE EXCEPTION 'customer.name y customer.phone son requeridos';
  END IF;

  v_result := public.create_public_booking_v2(
    v_profile.slug,
    p_service_id,
    p_staff_id,
    p_date,
    p_start_time,
    COALESCE(
      p_end_time,
      (
        p_start_time + make_interval(mins => COALESCE(
          (SELECT s.duration FROM public.services s WHERE s.id = p_service_id LIMIT 1),
          30
        ))
      )::time
    ),
    v_name,
    v_phone,
    v_email,
    p_notes
  );

  v_appointment_id := COALESCE(
    NULLIF(v_result ->> 'id', '')::uuid,
    NULLIF(v_result ->> 'appointment_id', '')::uuid
  );

  RETURN public.api_get_appointment_response(p_workspace_id, v_appointment_id);
END;
$$;

NOTIFY pgrst, 'reload schema';