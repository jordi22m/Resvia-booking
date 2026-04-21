-- =============================================================================
-- Fix: links.cancel y links.reschedule llegan null en booking.created
--
-- Causa: el trigger on_appointments_webhook_event dispara en INSERT ANTES de
-- que create_public_booking inserte la fila en booking_tokens.
--
-- Solución:
--   1. El trigger ignora INSERT (ya no encola booking.created)
--   2. create_public_booking encola booking.created manualmente DESPUÉS de
--      insertar los tokens, con links reales.
--   3. El trigger sigue encola UPDATE (canceled, rescheduled, confirmed, etc.)
-- =============================================================================

-- 1. Trigger: ignorar INSERT, solo procesar UPDATE de estado/fecha
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
  -- booking.created lo gestiona create_public_booking directamente
  -- para asegurar que los tokens ya existen cuando se construye el payload
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

  SELECT slug INTO v_slug FROM public.profiles WHERE user_id = NEW.user_id LIMIT 1;

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

DROP TRIGGER IF EXISTS on_appointments_webhook_event ON public.appointments;
CREATE TRIGGER on_appointments_webhook_event
  AFTER INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.handle_appointment_webhook_event();

-- =============================================================================
-- 2. create_public_booking: encola booking.created con links reales
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

  -- Insertar cita (el trigger de INSERT ya NO encola webhook)
  INSERT INTO public.appointments (
    user_id, customer_id, service_id, staff_id,
    date, start_time, end_time, status, notes
  )
  VALUES (
    v_user_id, v_customer_id, p_service_id, p_staff_id,
    p_date, p_start_time, p_end_time, 'pending', COALESCE(p_notes, '')
  )
  RETURNING id INTO v_appt_id;

  -- Generar tokens DESPUÉS de insertar la cita
  INSERT INTO public.booking_tokens (appointment_id)
  VALUES (v_appt_id)
  RETURNING cancel_token, reschedule_token
  INTO v_cancel_token, v_reschedule_token;

  -- Construir payload completo con links reales
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

  -- Encolar webhook booking.created con links reales
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
