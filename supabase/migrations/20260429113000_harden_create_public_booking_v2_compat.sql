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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id             uuid;
  v_customer_id         uuid;
  v_day_of_week         int;
  v_appt_id             uuid;
  v_cancel_token        text;
  v_reschedule_token    text;
  v_is_valid_slot       boolean;
  v_has_conflict        boolean;
  v_internal_payload    jsonb;

  v_min_notice_minutes  integer;
  v_max_days_ahead      integer;
  v_allow_weekends      boolean;

  v_now                 timestamp with time zone;
  v_booking_datetime    timestamp with time zone;
  v_minutes_ahead       integer;
  v_days_ahead          integer;
  v_day_of_week_num     integer;
BEGIN
  SELECT pr.user_id INTO v_user_id
  FROM public.profiles pr WHERE pr.slug = p_slug LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Perfil no encontrado';
  END IF;

  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'Rango horario invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.services s
    WHERE s.id = p_service_id AND s.user_id = v_user_id
      AND COALESCE(s.active, true) = true
      AND COALESCE(s.bookable_online, true) = true
  ) THEN
    RAISE EXCEPTION 'Servicio no disponible para reservas online';
  END IF;

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.staff_members st
    WHERE st.id = p_staff_id AND st.user_id = v_user_id
      AND COALESCE(st.active, true) = true
  ) THEN
    RAISE EXCEPTION 'Profesional no disponible';
  END IF;

  SELECT
    COALESCE(min_notice_minutes, 0),
    COALESCE(max_days_ahead, 60),
    COALESCE(allow_weekends, true)
  INTO
    v_min_notice_minutes,
    v_max_days_ahead,
    v_allow_weekends
  FROM public.profiles
  WHERE user_id = v_user_id
  LIMIT 1;

  v_now := now() at time zone 'UTC';
  v_booking_datetime := (p_date::timestamp + p_start_time);
  v_minutes_ahead := EXTRACT(EPOCH FROM (v_booking_datetime - v_now)) / 60;

  IF v_minutes_ahead < v_min_notice_minutes THEN
    RAISE EXCEPTION 'No hay suficiente tiempo de anticipacion. Se requiere al menos % minutos de anticipacion',
      v_min_notice_minutes;
  END IF;

  v_days_ahead := p_date - CURRENT_DATE;

  IF v_days_ahead > v_max_days_ahead THEN
    RAISE EXCEPTION 'La fecha de reserva excede el limite permitido. Maximo % dias adelante',
      v_max_days_ahead;
  END IF;

  v_day_of_week_num := EXTRACT(DOW FROM p_date);
  IF NOT v_allow_weekends AND (v_day_of_week_num = 0 OR v_day_of_week_num = 6) THEN
    RAISE EXCEPTION 'Las reservas no estan permitidas en fin de semana';
  END IF;

  v_day_of_week := EXTRACT(DOW FROM p_date);
  SELECT EXISTS (
    SELECT 1 FROM public.availability a
    WHERE a.user_id = v_user_id
      AND a.day_of_week = v_day_of_week
      AND p_start_time >= a.start_time
      AND p_end_time <= a.end_time
      AND COALESCE(
        (to_jsonb(a) ->> 'is_active')::boolean,
        (to_jsonb(a) ->> 'is_available')::boolean,
        true
      ) = true
  ) INTO v_is_valid_slot;

  IF NOT v_is_valid_slot THEN
    RAISE EXCEPTION 'Horario fuera de disponibilidad';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.appointments ap
    WHERE ap.user_id = v_user_id
      AND ap.date = p_date
      AND ap.status IN ('pending', 'confirmed')
      AND COALESCE(ap.staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(p_staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND tsrange((ap.date + ap.start_time), (ap.date + ap.end_time), '[)')
          && tsrange((p_date + p_start_time), (p_date + p_end_time), '[)')
  ) INTO v_has_conflict;

  IF v_has_conflict THEN
    RAISE EXCEPTION 'Este horario ya no esta disponible';
  END IF;

  SELECT c.id INTO v_customer_id
  FROM public.customers c
  WHERE c.user_id = v_user_id AND c.phone = p_customer_phone
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (user_id, name, phone, email)
    VALUES (v_user_id, p_customer_name, p_customer_phone, COALESCE(p_customer_email, ''))
    RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.appointments (
    user_id, customer_id, service_id, staff_id,
    date, start_time, end_time, status, notes
  )
  VALUES (
    v_user_id, v_customer_id, p_service_id, p_staff_id,
    p_date, p_start_time, p_end_time, 'pending', COALESCE(p_notes, '')
  )
  RETURNING id INTO v_appt_id;

  INSERT INTO public.booking_tokens (appointment_id)
  VALUES (v_appt_id)
  ON CONFLICT (appointment_id) DO NOTHING;

  SELECT cancel_token, reschedule_token
  INTO v_cancel_token, v_reschedule_token
  FROM public.booking_tokens
  WHERE appointment_id = v_appt_id
  LIMIT 1;

  v_internal_payload := jsonb_build_object(
    'event', 'booking.created',
    'booking', jsonb_build_object(
      'id',        v_appt_id,
      'status',    'pending',
      'date',      p_date::TEXT,
      'startTime', p_start_time::TEXT,
      'endTime',   p_end_time::TEXT,
      'notes',     COALESCE(p_notes, '')
    ),
    'customer', jsonb_build_object(
      'name',  p_customer_name,
      'phone', p_customer_phone,
      'email', COALESCE(p_customer_email, '')
    ),
    'service', (
      SELECT jsonb_build_object('id', s.id, 'name', s.name, 'duration', s.duration, 'price', s.price)
      FROM public.services s WHERE s.id = p_service_id
    ),
    'business', (
      SELECT jsonb_build_object('name', p.business_name, 'slug', COALESCE(p.slug, ''), 'email', p.email, 'phone', COALESCE(p.phone, ''))
      FROM public.profiles p WHERE p.user_id = v_user_id
    ),
    'links', jsonb_build_object(
      'booking',    'https://resviabooking.vercel.app/book/' || p_slug,
      'cancel',     'https://resviabooking.vercel.app/booking/cancel/' || v_cancel_token,
      'reschedule', 'https://resviabooking.vercel.app/booking/reschedule/' || v_reschedule_token
    )
  );

  PERFORM public.enqueue_webhook_event(v_user_id, 'booking.created', v_internal_payload);

  UPDATE public.appointments
  SET status = 'confirmed'
  WHERE id = v_appt_id
    AND status <> 'confirmed';

  RETURN jsonb_build_object(
    'id',               v_appt_id,
    'cancel_token',     v_cancel_token,
    'reschedule_token', v_reschedule_token
  );

EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Este horario ya no esta disponible';
END;
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
