-- =============================================================================
-- Backend Enforcement: Booking Rules Validation
-- Scope: Enforce min_notice_minutes and max_days_ahead in create_public_booking RPC
-- Purpose: Server-side validation as source of truth (frontend is UX only)
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_public_booking(text, uuid, uuid, date, time, time, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_public_booking(
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
  v_user_id          uuid;
  v_customer_id      uuid;
  v_day_of_week      int;
  v_appt_id          uuid;
  v_cancel_token     text;
  v_reschedule_token text;
  v_is_valid_slot    boolean;
  v_has_conflict     boolean;
  v_payload          jsonb;
  
  -- Booking rules from profile
  v_min_notice_minutes  integer;
  v_max_days_ahead      integer;
  v_allow_weekends      boolean;
  
  -- For validations
  v_now              timestamp with time zone;
  v_booking_datetime timestamp with time zone;
  v_minutes_ahead    integer;
  v_days_ahead       integer;
  v_day_of_week_num  integer;
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

  -- =========================================================================
  -- NEW: Read booking rules from profile
  -- =========================================================================
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

  -- =========================================================================
  -- NEW: Validate min_notice_minutes
  -- =========================================================================
  v_now := now() at time zone 'UTC';
  v_booking_datetime := (p_date::timestamp + p_start_time);
  v_minutes_ahead := EXTRACT(EPOCH FROM (v_booking_datetime - v_now)) / 60;

  IF v_minutes_ahead < v_min_notice_minutes THEN
    RAISE EXCEPTION 'No hay suficiente tiempo de anticipacion. Se requiere al menos % minutos de anticipacion',
      v_min_notice_minutes;
  END IF;

  -- =========================================================================
  -- NEW: Validate max_days_ahead
  -- =========================================================================
  v_days_ahead := p_date - CURRENT_DATE;

  IF v_days_ahead > v_max_days_ahead THEN
    RAISE EXCEPTION 'La fecha de reserva excede el limite permitido. Maximo % dias adelante',
      v_max_days_ahead;
  END IF;

  -- =========================================================================
  -- NEW: Validate allow_weekends
  -- =========================================================================
  v_day_of_week_num := EXTRACT(DOW FROM p_date);
  IF NOT v_allow_weekends AND (v_day_of_week_num = 0 OR v_day_of_week_num = 6) THEN
    RAISE EXCEPTION 'Las reservas no estan permitidas en fin de semana';
  END IF;

  -- =========================================================================
  -- Existing validations (availability window + conflict check)
  -- =========================================================================
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

  -- =========================================================================
  -- Create appointment (existing logic)
  -- =========================================================================
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
  RETURNING cancel_token, reschedule_token
  INTO v_cancel_token, v_reschedule_token;

  v_payload := jsonb_build_object(
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
      SELECT jsonb_build_object('name', p.business_name, 'slug', COALESCE(p.slug,''), 'email', p.email, 'phone', COALESCE(p.phone,''))
      FROM public.profiles p WHERE p.user_id = v_user_id
    ),
    'links', jsonb_build_object(
      'booking',    'https://resviabooking.vercel.app/book/' || p_slug,
      'cancel',     'https://resviabooking.vercel.app/booking/cancel/'    || v_cancel_token,
      'reschedule', 'https://resviabooking.vercel.app/booking/reschedule/' || v_reschedule_token
    )
  );

  PERFORM public.enqueue_webhook_event(v_user_id, 'booking.created', v_payload);

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

GRANT EXECUTE ON FUNCTION public.create_public_booking(
  text, uuid, uuid, date, time, time, text, text, text, text
) TO anon, authenticated;

-- =============================================================================
-- Also update reschedule_booking_by_token to enforce the same rules
-- =============================================================================
DROP FUNCTION IF EXISTS public.reschedule_booking_by_token(text, uuid, uuid, date, time, time, text);

CREATE OR REPLACE FUNCTION public.reschedule_booking_by_token(
  p_token      text,
  p_service_id uuid,
  p_staff_id   uuid,
  p_date       date,
  p_start_time time,
  p_end_time   time,
  p_notes      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt_id           uuid;
  v_user_id           uuid;
  v_old_status        text;
  v_day_of_week       int;
  v_is_valid_slot     boolean;
  v_has_conflict      boolean;
  
  -- Booking rules from profile
  v_min_notice_minutes integer;
  v_max_days_ahead     integer;
  v_allow_weekends     boolean;
  
  -- For validations
  v_now              timestamp with time zone;
  v_booking_datetime timestamp with time zone;
  v_minutes_ahead    integer;
  v_days_ahead       integer;
  v_day_of_week_num  integer;
  
  v_cancel_token     text;
  v_reschedule_token text;
BEGIN
  SELECT appointment_id INTO v_appt_id
  FROM public.booking_tokens WHERE reschedule_token = p_token LIMIT 1;

  IF v_appt_id IS NULL THEN
    RAISE EXCEPTION 'Token de reprogramacion no encontrado';
  END IF;

  SELECT user_id, status INTO v_user_id, v_old_status
  FROM public.appointments WHERE id = v_appt_id LIMIT 1;

  IF v_old_status IN ('canceled', 'completed') THEN
    RAISE EXCEPTION 'Ya no puede reprogramarse';
  END IF;

  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'Rango horario invalido';
  END IF;

  -- =========================================================================
  -- NEW: Read booking rules from profile
  -- =========================================================================
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

  -- =========================================================================
  -- NEW: Validate min_notice_minutes for reschedule
  -- =========================================================================
  v_now := now() at time zone 'UTC';
  v_booking_datetime := (p_date::timestamp + p_start_time);
  v_minutes_ahead := EXTRACT(EPOCH FROM (v_booking_datetime - v_now)) / 60;

  IF v_minutes_ahead < v_min_notice_minutes THEN
    RAISE EXCEPTION 'No hay suficiente tiempo de anticipacion. Se requiere al menos % minutos de anticipacion',
      v_min_notice_minutes;
  END IF;

  -- =========================================================================
  -- NEW: Validate max_days_ahead for reschedule
  -- =========================================================================
  v_days_ahead := p_date - CURRENT_DATE;

  IF v_days_ahead > v_max_days_ahead THEN
    RAISE EXCEPTION 'La fecha de reserva excede el limite permitido. Maximo % dias adelante',
      v_max_days_ahead;
  END IF;

  -- =========================================================================
  -- NEW: Validate allow_weekends for reschedule
  -- =========================================================================
  v_day_of_week_num := EXTRACT(DOW FROM p_date);
  IF NOT v_allow_weekends AND (v_day_of_week_num = 0 OR v_day_of_week_num = 6) THEN
    RAISE EXCEPTION 'Las reservas no estan permitidas en fin de semana';
  END IF;

  -- Existing validations
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
      AND ap.id <> v_appt_id
      AND tsrange((ap.date + ap.start_time), (ap.date + ap.end_time), '[)')
          && tsrange((p_date + p_start_time), (p_date + p_end_time), '[)')
  ) INTO v_has_conflict;

  IF v_has_conflict THEN
    RAISE EXCEPTION 'Este horario ya no esta disponible';
  END IF;

  UPDATE public.appointments
  SET service_id = p_service_id,
      staff_id = p_staff_id,
      date = p_date,
      start_time = p_start_time,
      end_time = p_end_time,
      notes = COALESCE(p_notes, '')
  WHERE id = v_appt_id;

  SELECT cancel_token, reschedule_token INTO v_cancel_token, v_reschedule_token
  FROM public.booking_tokens WHERE appointment_id = v_appt_id LIMIT 1;

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

GRANT EXECUTE ON FUNCTION public.reschedule_booking_by_token(
  text, uuid, uuid, date, time, time, text
) TO anon, authenticated;
