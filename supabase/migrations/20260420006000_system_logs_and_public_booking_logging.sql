-- Robust logging and webhook queue foundation
-- Keeps booking logic intact and only adds safe logging hooks.

CREATE TABLE IF NOT EXISTS public.system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_logs_type_event_created_at
  ON public.system_logs(type, event, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_logs_created_at
  ON public.system_logs(created_at DESC);

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'system_logs'
      AND policyname = 'Users can read own system logs'
  ) THEN
    CREATE POLICY "Users can read own system logs"
      ON public.system_logs
      FOR SELECT
      TO authenticated
      USING (
        COALESCE(payload ->> 'user_id', '') = auth.uid()::text
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.enqueue_system_event(
  p_type text,
  p_event text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_error text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  INSERT INTO public.system_logs(type, event, payload, error)
  VALUES (
    COALESCE(NULLIF(trim(p_type), ''), 'event'),
    COALESCE(NULLIF(trim(p_event), ''), 'unknown'),
    COALESCE(p_payload, '{}'::jsonb),
    p_error
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_system_event(text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_system_event(text, text, jsonb, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_slug text,
  p_service_id uuid,
  p_staff_id uuid,
  p_date date,
  p_start_time time,
  p_end_time time,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_customer_id uuid;
  v_day_of_week int;
  v_appt_id uuid;
  v_is_valid_slot boolean;
  v_has_conflict boolean;
BEGIN
  SELECT pr.user_id
  INTO v_user_id
  FROM public.profiles pr
  WHERE pr.slug = p_slug
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Perfil no encontrado';
  END IF;

  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'Rango horario invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.services s
    WHERE s.id = p_service_id
      AND s.user_id = v_user_id
      AND COALESCE(s.active, true) = true
      AND COALESCE(s.bookable_online, true) = true
  ) THEN
    RAISE EXCEPTION 'Servicio no disponible para reservas online';
  END IF;

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.staff_members st
    WHERE st.id = p_staff_id
      AND st.user_id = v_user_id
      AND COALESCE(st.active, true) = true
  ) THEN
    RAISE EXCEPTION 'Profesional no disponible';
  END IF;

  v_day_of_week := EXTRACT(DOW FROM p_date);
  SELECT EXISTS (
    SELECT 1
    FROM public.availability a
    WHERE a.user_id = v_user_id
      AND a.day_of_week = v_day_of_week
      AND p_start_time >= a.start_time
      AND p_end_time <= a.end_time
      AND COALESCE(
        (to_jsonb(a) ->> 'is_active')::boolean,
        (to_jsonb(a) ->> 'is_available')::boolean,
        true
      ) = true
  )
  INTO v_is_valid_slot;

  IF NOT v_is_valid_slot THEN
    RAISE EXCEPTION 'Horario fuera de disponibilidad';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.appointments ap
    WHERE ap.user_id = v_user_id
      AND ap.date = p_date
      AND ap.status IN ('pending', 'confirmed')
      AND COALESCE(ap.staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(p_staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND tsrange((ap.date + ap.start_time), (ap.date + ap.end_time), '[)')
          && tsrange((p_date + p_start_time), (p_date + p_end_time), '[)')
  )
  INTO v_has_conflict;

  IF v_has_conflict THEN
    RAISE EXCEPTION 'Este horario ya no esta disponible';
  END IF;

  SELECT c.id
  INTO v_customer_id
  FROM public.customers c
  WHERE c.user_id = v_user_id
    AND c.phone = p_customer_phone
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (user_id, name, phone, email)
    VALUES (
      v_user_id,
      p_customer_name,
      p_customer_phone,
      COALESCE(p_customer_email, '')
    )
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.appointments (
    user_id,
    customer_id,
    service_id,
    staff_id,
    date,
    start_time,
    end_time,
    status,
    notes,
    source
  )
  VALUES (
    v_user_id,
    v_customer_id,
    p_service_id,
    p_staff_id,
    p_date,
    p_start_time,
    p_end_time,
    'pending',
    COALESCE(p_notes, ''),
    'public'
  )
  RETURNING id INTO v_appt_id;

  -- Queue business event for n8n consumption
  PERFORM public.enqueue_system_event(
    'webhook',
    'booking.created',
    jsonb_build_object(
      'appointment_id', v_appt_id,
      'user_id', v_user_id,
      'service_id', p_service_id,
      'staff_id', p_staff_id,
      'date', p_date,
      'start_time', p_start_time,
      'end_time', p_end_time,
      'customer_name', p_customer_name,
      'customer_phone', p_customer_phone,
      'source', 'public'
    ),
    NULL
  );

  RETURN v_appt_id;
EXCEPTION
  WHEN exclusion_violation THEN
    BEGIN
      PERFORM public.enqueue_system_event(
        'error',
        'booking.create_public_booking.exclusion_violation',
        jsonb_build_object(
          'slug', p_slug,
          'service_id', p_service_id,
          'staff_id', p_staff_id,
          'date', p_date,
          'start_time', p_start_time,
          'end_time', p_end_time
        ),
        SQLERRM
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RAISE EXCEPTION 'Este horario ya no esta disponible';

  WHEN OTHERS THEN
    BEGIN
      PERFORM public.enqueue_system_event(
        'error',
        'booking.create_public_booking.error',
        jsonb_build_object(
          'slug', p_slug,
          'service_id', p_service_id,
          'staff_id', p_staff_id,
          'date', p_date,
          'start_time', p_start_time,
          'end_time', p_end_time,
          'customer_phone', p_customer_phone
        ),
        SQLERRM
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_public_booking(
  text, uuid, uuid, date, time, time, text, text, text, text
) TO anon, authenticated;
