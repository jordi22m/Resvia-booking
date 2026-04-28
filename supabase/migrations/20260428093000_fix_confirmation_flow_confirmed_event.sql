-- =============================================================================
-- Fix confirmation flow for public bookings
-- Goals:
-- 1) booking ends in status=confirmed
-- 2) ensure cancel/reschedule tokens exist
-- 3) enqueue booking.confirmed with resolved links
-- 4) keep booking.created for internal creation phase
-- 5) keep operations consistent in one transaction (RPC)
-- =============================================================================

-- Trigger handler: keep INSERT ignored, but for UPDATE ensure tokens exist
-- before composing webhook payload (especially booking.confirmed).
CREATE OR REPLACE FUNCTION public.handle_appointment_webhook_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  event_type         TEXT;
  v_cancel_token     TEXT;
  v_reschedule_token TEXT;
  v_slug             TEXT;
  payload            JSONB;
BEGIN
  -- booking.created is produced by create_public_booking as internal event.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status <> OLD.status THEN
      IF    NEW.status = 'confirmed'   THEN event_type := 'booking.confirmed';
      ELSIF NEW.status = 'canceled'    THEN event_type := 'booking.cancelled';
      ELSIF NEW.status = 'completed'   THEN event_type := 'booking.completed';
      ELSIF NEW.status = 'rescheduled' THEN event_type := 'booking.rescheduled';
      ELSE RETURN NEW;
      END IF;
    ELSIF NEW.date <> OLD.date OR NEW.start_time <> OLD.start_time OR NEW.end_time <> OLD.end_time THEN
      event_type := 'booking.rescheduled';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  -- Guarantee tokens exist for confirmed/rescheduled/cancel links.
  INSERT INTO public.booking_tokens (appointment_id)
  VALUES (NEW.id)
  ON CONFLICT (appointment_id) DO NOTHING;

  SELECT slug INTO v_slug
  FROM public.profiles
  WHERE user_id = NEW.user_id
  LIMIT 1;

  SELECT bt.cancel_token, bt.reschedule_token
  INTO v_cancel_token, v_reschedule_token
  FROM public.booking_tokens bt
  WHERE bt.appointment_id = NEW.id
  LIMIT 1;

  payload := jsonb_build_object(
    'event',   event_type,
    'booking', jsonb_build_object(
      'id',        NEW.id,
      'status',    NEW.status,
      'date',      NEW.date::TEXT,
      'startTime', NEW.start_time::TEXT,
      'endTime',   NEW.end_time::TEXT,
      'notes',     COALESCE(NEW.notes, '')
    ),
    'customer', (
      SELECT jsonb_build_object(
        'id',    c.id,
        'name',  c.name,
        'phone', COALESCE(c.phone, ''),
        'email', COALESCE(c.email, '')
      )
      FROM public.customers c WHERE c.id = NEW.customer_id
    ),
    'service', (
      SELECT jsonb_build_object(
        'id',       s.id,
        'name',     s.name,
        'duration', s.duration,
        'price',    s.price
      )
      FROM public.services s WHERE s.id = NEW.service_id
    ),
    'staff', (
      SELECT jsonb_build_object('id', m.id, 'name', m.name)
      FROM public.staff_members m WHERE m.id = NEW.staff_id
    ),
    'business', (
      SELECT jsonb_build_object(
        'name',  p.business_name,
        'slug',  COALESCE(p.slug, ''),
        'email', p.email,
        'phone', COALESCE(p.phone, '')
      )
      FROM public.profiles p WHERE p.user_id = NEW.user_id
    ),
    'links', jsonb_build_object(
      'booking',
        CASE WHEN v_slug IS NOT NULL
          THEN 'https://resviabooking.vercel.app/book/' || v_slug
          ELSE NULL END,
      'cancel',
        CASE WHEN v_cancel_token IS NOT NULL
          THEN 'https://resviabooking.vercel.app/booking/cancel/' || v_cancel_token
          ELSE NULL END,
      'reschedule',
        CASE WHEN v_reschedule_token IS NOT NULL
          THEN 'https://resviabooking.vercel.app/booking/reschedule/' || v_reschedule_token
          ELSE NULL END
    )
  );

  PERFORM public.enqueue_webhook_event(NEW.user_id, event_type, payload);
  RETURN NEW;
END;
$$;

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
  v_user_id             uuid;
  v_customer_id         uuid;
  v_day_of_week         int;
  v_appt_id             uuid;
  v_cancel_token        text;
  v_reschedule_token    text;
  v_is_valid_slot       boolean;
  v_has_conflict        boolean;
  v_internal_payload    jsonb;

  -- Booking rules from profile
  v_min_notice_minutes  integer;
  v_max_days_ahead      integer;
  v_allow_weekends      boolean;

  -- For validations
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

  -- Ensure token row exists and read final tokens.
  INSERT INTO public.booking_tokens (appointment_id)
  VALUES (v_appt_id)
  ON CONFLICT (appointment_id) DO NOTHING;

  SELECT cancel_token, reschedule_token
  INTO v_cancel_token, v_reschedule_token
  FROM public.booking_tokens
  WHERE appointment_id = v_appt_id
  LIMIT 1;

  -- Internal creation-phase event.
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

  -- Finalize booking in same transaction.
  -- This UPDATE triggers booking.confirmed webhook with resolved links.
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

GRANT EXECUTE ON FUNCTION public.create_public_booking(
  text, uuid, uuid, date, time, time, text, text, text, text
) TO anon, authenticated;
