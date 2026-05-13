-- =============================================================================
-- API-first multi-tenant foundation
-- - Workspace-scoped API keys stored as hashes only
-- - SECURITY DEFINER RPCs for public API operations without service_role
-- - Reuse existing booking and webhook flows through current DB primitives
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  api_key_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT api_keys_hash_not_empty CHECK (btrim(api_key_hash) <> ''),
  CONSTRAINT api_keys_permissions_object CHECK (jsonb_typeof(permissions) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_api_keys_workspace_id ON public.api_keys(workspace_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_last_used_at ON public.api_keys(last_used_at DESC NULLS LAST);
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_keys_active_workspace
  ON public.api_keys(workspace_id)
  WHERE active = true;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view workspace api keys" ON public.api_keys;
CREATE POLICY "Owners can view workspace api keys"
  ON public.api_keys FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = api_keys.workspace_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can update workspace api keys" ON public.api_keys;
CREATE POLICY "Owners can update workspace api keys"
  ON public.api_keys FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = api_keys.workspace_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = api_keys.workspace_id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can insert workspace api keys" ON public.api_keys;
CREATE POLICY "Owners can insert workspace api keys"
  ON public.api_keys FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = api_keys.workspace_id
        AND p.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.api_keys FROM anon;
GRANT SELECT ON public.api_keys TO authenticated;

CREATE OR REPLACE FUNCTION public.hash_api_key(p_api_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(extensions.digest(COALESCE(p_api_key, ''), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.generate_api_key_value()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'rv_live_' || lower(encode(gen_random_bytes(24), 'hex'))
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_api_key_info()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_api_key RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT p.id, p.user_id, p.business_name, p.slug
  INTO v_profile
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Workspace no encontrado';
  END IF;

  SELECT ak.id, ak.created_at, ak.last_used_at, ak.active, ak.permissions
  INTO v_api_key
  FROM public.api_keys ak
  WHERE ak.workspace_id = v_profile.id
    AND ak.active = true
  ORDER BY ak.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'workspace_id', v_profile.id,
    'workspace_slug', COALESCE(v_profile.slug, ''),
    'business_name', v_profile.business_name,
    'has_active_key', COALESCE(v_api_key.id IS NOT NULL, false),
    'active_key', CASE
      WHEN v_api_key.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_api_key.id,
        'created_at', v_api_key.created_at,
        'last_used_at', v_api_key.last_used_at,
        'active', v_api_key.active,
        'permissions', COALESCE(v_api_key.permissions, '{}'::jsonb)
      )
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_workspace_api_key(
  p_permissions jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_plaintext_key text;
  v_api_key_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_permissions IS NULL OR jsonb_typeof(p_permissions) <> 'object' THEN
    RAISE EXCEPTION 'permissions debe ser un objeto JSON';
  END IF;

  SELECT p.id, p.user_id, p.business_name, p.slug
  INTO v_profile
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Workspace no encontrado';
  END IF;

  UPDATE public.api_keys
  SET active = false
  WHERE workspace_id = v_profile.id
    AND active = true;

  v_plaintext_key := public.generate_api_key_value();

  INSERT INTO public.api_keys (
    workspace_id,
    api_key_hash,
    permissions,
    active
  )
  VALUES (
    v_profile.id,
    public.hash_api_key(v_plaintext_key),
    COALESCE(p_permissions, '{}'::jsonb),
    true
  )
  RETURNING id INTO v_api_key_id;

  RETURN jsonb_build_object(
    'api_key_id', v_api_key_id,
    'workspace_id', v_profile.id,
    'workspace_slug', COALESCE(v_profile.slug, ''),
    'business_name', v_profile.business_name,
    'api_key', v_plaintext_key,
    'created_at', now(),
    'permissions', COALESCE(p_permissions, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.authenticate_api_key(p_api_key text)
RETURNS TABLE (
  api_key_id uuid,
  workspace_id uuid,
  user_id uuid,
  business_name text,
  workspace_slug text,
  permissions jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
BEGIN
  IF p_api_key IS NULL OR btrim(p_api_key) = '' THEN
    RAISE EXCEPTION 'API key requerida';
  END IF;

  IF position('rv_live_' in p_api_key) <> 1 THEN
    RAISE EXCEPTION 'Formato de API key invalido';
  END IF;

  v_hash := public.hash_api_key(btrim(p_api_key));

  UPDATE public.api_keys ak
  SET last_used_at = now()
  FROM public.profiles p
  WHERE ak.workspace_id = p.id
    AND ak.api_key_hash = v_hash
    AND ak.active = true;

  RETURN QUERY
  SELECT
    ak.id,
    p.id,
    p.user_id,
    p.business_name,
    COALESCE(p.slug, ''),
    COALESCE(ak.permissions, '{}'::jsonb)
  FROM public.api_keys ak
  JOIN public.profiles p ON p.id = ak.workspace_id
  WHERE ak.api_key_hash = v_hash
    AND ak.active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'API key invalida o inactiva';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.api_get_me(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'workspace', jsonb_build_object(
      'id', p.id,
      'user_id', p.user_id,
      'business_name', p.business_name,
      'slug', COALESCE(p.slug, ''),
      'email', COALESCE(p.email, ''),
      'phone', COALESCE(p.phone, ''),
      'timezone', COALESCE(p.timezone, 'UTC'),
      'currency', COALESCE(p.currency, 'EUR'),
      'booking_enabled', COALESCE(p.booking_enabled, true),
      'booking_url', CASE
        WHEN p.slug IS NOT NULL AND btrim(p.slug) <> ''
          THEN 'https://resviabooking.vercel.app/book/' || p.slug
        ELSE NULL
      END
    )
  )
  FROM public.profiles p
  WHERE p.id = p_workspace_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.api_get_availability(
  p_workspace_id uuid,
  p_from date DEFAULT CURRENT_DATE,
  p_to date DEFAULT (CURRENT_DATE + 30)
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH profile_cte AS (
    SELECT p.id, p.user_id, p.business_name, p.slug, p.timezone, p.currency
    FROM public.profiles p
    WHERE p.id = p_workspace_id
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'workspace', (
      SELECT jsonb_build_object(
        'id', pr.id,
        'user_id', pr.user_id,
        'business_name', pr.business_name,
        'slug', COALESCE(pr.slug, ''),
        'timezone', COALESCE(pr.timezone, 'UTC'),
        'currency', COALESCE(pr.currency, 'EUR')
      )
      FROM profile_cte pr
    ),
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'weekly_availability', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'day_of_week', a.day_of_week,
          'start_time', a.start_time,
          'end_time', a.end_time,
          'is_available', COALESCE(
            (to_jsonb(a) ->> 'is_active')::boolean,
            (to_jsonb(a) ->> 'is_available')::boolean,
            true
          )
        )
        ORDER BY a.day_of_week, a.start_time
      )
      FROM public.availability a
      JOIN profile_cte pr ON pr.user_id = a.user_id
    ), '[]'::jsonb),
    'exceptions', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ae.id,
          'date', ae.exception_date,
          'is_closed', ae.is_closed,
          'start_time', ae.start_time,
          'end_time', ae.end_time,
          'reason', COALESCE(ae.reason, '')
        )
        ORDER BY ae.exception_date, ae.start_time
      )
      FROM public.availability_exceptions ae
      WHERE ae.business_id = p_workspace_id
        AND ae.exception_date BETWEEN p_from AND p_to
    ), '[]'::jsonb),
    'calendar_blocks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', cb.id,
          'type', cb.type,
          'start_time', cb.start_time,
          'end_time', cb.end_time,
          'reason', COALESCE(cb.reason, '')
        )
        ORDER BY cb.start_time
      )
      FROM public.calendar_blocks cb
      WHERE cb.business_id = (SELECT user_id FROM profile_cte)
        AND cb.start_time::date BETWEEN p_from AND p_to
    ), '[]'::jsonb),
    'services', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'duration', s.duration,
          'price', s.price,
          'active', COALESCE(s.active, true),
          'bookable_online', COALESCE(s.bookable_online, true)
        )
        ORDER BY s.name
      )
      FROM public.services s
      JOIN profile_cte pr ON pr.user_id = s.user_id
      WHERE COALESCE(s.active, true) = true
    ), '[]'::jsonb),
    'staff', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', st.id,
          'name', st.name,
          'active', COALESCE(st.active, true)
        )
        ORDER BY st.name
      )
      FROM public.staff_members st
      JOIN profile_cte pr ON pr.user_id = st.user_id
      WHERE COALESCE(st.active, true) = true
    ), '[]'::jsonb)
  )
$$;

CREATE OR REPLACE FUNCTION public.api_list_customers(
  p_workspace_id uuid,
  p_limit integer DEFAULT 100,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH workspace_user AS (
    SELECT p.user_id
    FROM public.profiles p
    WHERE p.id = p_workspace_id
    LIMIT 1
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'phone', COALESCE(c.phone, ''),
      'email', COALESCE(c.email, ''),
      'notes', COALESCE(c.notes, ''),
      'tags', COALESCE(to_jsonb(c.tags), '[]'::jsonb),
      'created_at', c.created_at,
      'updated_at', c.updated_at
    )
    ORDER BY c.created_at DESC
  ), '[]'::jsonb)
  FROM (
    SELECT c.*
    FROM public.customers c
    WHERE c.user_id = (SELECT user_id FROM workspace_user)
      AND (
        p_search IS NULL
        OR btrim(p_search) = ''
        OR c.name ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(c.phone, '') ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(c.email, '') ILIKE '%' || btrim(p_search) || '%'
      )
    ORDER BY c.created_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 100), 1)
  ) c
$$;

CREATE OR REPLACE FUNCTION public.api_create_customer(
  p_workspace_id uuid,
  p_name text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_tags text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_customer public.customers%ROWTYPE;
  v_phone text := NULLIF(btrim(COALESCE(p_phone, '')), '');
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name es requerido';
  END IF;

  SELECT p.user_id INTO v_user_id
  FROM public.profiles p
  WHERE p.id = p_workspace_id
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Workspace no encontrado';
  END IF;

  IF v_phone IS NOT NULL THEN
    INSERT INTO public.customers (user_id, name, phone, email, notes, tags)
    VALUES (
      v_user_id,
      btrim(p_name),
      v_phone,
      COALESCE(p_email, ''),
      COALESCE(p_notes, ''),
      COALESCE(p_tags, '{}'::text[])
    )
    ON CONFLICT (user_id, phone)
    DO UPDATE SET
      name = EXCLUDED.name,
      email = CASE
        WHEN NULLIF(EXCLUDED.email, '') IS NOT NULL THEN EXCLUDED.email
        ELSE public.customers.email
      END,
      notes = CASE
        WHEN NULLIF(EXCLUDED.notes, '') IS NOT NULL THEN EXCLUDED.notes
        ELSE public.customers.notes
      END,
      tags = CASE
        WHEN COALESCE(array_length(EXCLUDED.tags, 1), 0) > 0 THEN EXCLUDED.tags
        ELSE public.customers.tags
      END,
      updated_at = now()
    RETURNING * INTO v_customer;
  ELSE
    INSERT INTO public.customers (user_id, name, phone, email, notes, tags)
    VALUES (
      v_user_id,
      btrim(p_name),
      '',
      COALESCE(p_email, ''),
      COALESCE(p_notes, ''),
      COALESCE(p_tags, '{}'::text[])
    )
    RETURNING * INTO v_customer;
  END IF;

  RETURN jsonb_build_object(
    'id', v_customer.id,
    'name', v_customer.name,
    'phone', COALESCE(v_customer.phone, ''),
    'email', COALESCE(v_customer.email, ''),
    'notes', COALESCE(v_customer.notes, ''),
    'tags', COALESCE(to_jsonb(v_customer.tags), '[]'::jsonb),
    'created_at', v_customer.created_at,
    'updated_at', v_customer.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_get_appointment_response(
  p_workspace_id uuid,
  p_appointment_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', a.id,
    'status', a.status,
    'date', a.date,
    'start_time', a.start_time,
    'end_time', a.end_time,
    'notes', COALESCE(a.notes, ''),
    'customer', jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'phone', COALESCE(c.phone, ''),
      'email', COALESCE(c.email, ''),
      'notes', COALESCE(c.notes, '')
    ),
    'service', jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'duration', s.duration,
      'price', s.price
    ),
    'staff', CASE
      WHEN st.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', st.id,
        'name', st.name
      )
    END,
    'workspace', jsonb_build_object(
      'id', p.id,
      'user_id', p.user_id,
      'business_name', p.business_name,
      'slug', COALESCE(p.slug, ''),
      'timezone', COALESCE(p.timezone, 'UTC')
    ),
    'tokens', jsonb_build_object(
      'cancel', bt.cancel_token,
      'reschedule', bt.reschedule_token
    ),
    'links', jsonb_build_object(
      'booking', CASE
        WHEN p.slug IS NOT NULL AND btrim(p.slug) <> ''
          THEN 'https://resviabooking.vercel.app/book/' || p.slug
        ELSE NULL
      END,
      'cancel', CASE
        WHEN bt.cancel_token IS NOT NULL
          THEN 'https://resviabooking.vercel.app/booking/cancel/' || bt.cancel_token
        ELSE NULL
      END,
      'reschedule', CASE
        WHEN bt.reschedule_token IS NOT NULL
          THEN 'https://resviabooking.vercel.app/booking/reschedule/' || bt.reschedule_token
        ELSE NULL
      END
    )
  )
  FROM public.appointments a
  JOIN public.customers c ON c.id = a.customer_id
  JOIN public.services s ON s.id = a.service_id
  JOIN public.profiles p ON p.user_id = a.user_id
  LEFT JOIN public.staff_members st ON st.id = a.staff_id
  LEFT JOIN public.booking_tokens bt ON bt.appointment_id = a.id
  WHERE a.id = p_appointment_id
    AND p.id = p_workspace_id
  LIMIT 1
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

CREATE OR REPLACE FUNCTION public.api_cancel_appointment(
  p_workspace_id uuid,
  p_appointment_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancel_token text;
BEGIN
  SELECT bt.cancel_token INTO v_cancel_token
  FROM public.appointments a
  JOIN public.profiles p ON p.user_id = a.user_id
  JOIN public.booking_tokens bt ON bt.appointment_id = a.id
  WHERE a.id = p_appointment_id
    AND p.id = p_workspace_id
  LIMIT 1;

  IF v_cancel_token IS NULL THEN
    RAISE EXCEPTION 'Appointment no encontrado o sin token de cancelacion';
  END IF;

  PERFORM public.cancel_booking_by_token(v_cancel_token, p_reason);

  RETURN public.api_get_appointment_response(p_workspace_id, p_appointment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_reschedule_appointment(
  p_workspace_id uuid,
  p_appointment_id uuid,
  p_service_id uuid DEFAULT NULL,
  p_staff_id uuid DEFAULT NULL,
  p_date date DEFAULT NULL,
  p_start_time time DEFAULT NULL,
  p_end_time time DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reschedule_token text;
  v_current RECORD;
  v_service_id uuid;
  v_staff_id uuid;
  v_date date;
  v_start_time time;
  v_end_time time;
  v_duration_mins integer := 30;
BEGIN
  SELECT
    a.service_id,
    a.staff_id,
    a.date,
    a.start_time,
    a.end_time,
    a.notes,
    bt.reschedule_token
  INTO v_current
  FROM public.appointments a
  JOIN public.profiles p ON p.user_id = a.user_id
  JOIN public.booking_tokens bt ON bt.appointment_id = a.id
  WHERE a.id = p_appointment_id
    AND p.id = p_workspace_id
  LIMIT 1;

  IF v_current.reschedule_token IS NULL THEN
    RAISE EXCEPTION 'Appointment no encontrado o sin token de reprogramacion';
  END IF;

  v_service_id := COALESCE(p_service_id, v_current.service_id);
  v_staff_id := COALESCE(p_staff_id, v_current.staff_id);
  v_date := COALESCE(p_date, v_current.date);
  v_start_time := COALESCE(p_start_time, v_current.start_time);
  v_end_time := p_end_time;

  IF v_end_time IS NULL THEN
    SELECT COALESCE(s.duration, 30)
    INTO v_duration_mins
    FROM public.services s
    WHERE s.id = v_service_id
    LIMIT 1;

    v_end_time := (v_start_time + make_interval(mins => v_duration_mins))::time;
  END IF;

  v_reschedule_token := v_current.reschedule_token;

  PERFORM public.reschedule_booking_by_token(
    v_reschedule_token,
    v_service_id,
    v_staff_id,
    v_date,
    v_start_time,
    v_end_time,
    COALESCE(p_notes, v_current.notes)
  );

  RETURN public.api_get_appointment_response(p_workspace_id, p_appointment_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_workspace_api_key_info() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_workspace_api_key(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_api_key(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_get_me(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_get_availability(uuid, date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_list_customers(uuid, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_customer(uuid, text, text, text, text, text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_get_appointment_response(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_appointment(uuid, uuid, uuid, date, time, time, uuid, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_cancel_appointment(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_reschedule_appointment(uuid, uuid, uuid, uuid, date, time, time, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';