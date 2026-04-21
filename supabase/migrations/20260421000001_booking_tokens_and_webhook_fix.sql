-- =============================================================================
-- 1. Tabla booking_tokens para enlaces de cancelar/reprogramar
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.booking_tokens (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id   UUID        NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,
  cancel_token     TEXT        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  reschedule_token TEXT        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.booking_tokens ENABLE ROW LEVEL SECURITY;

-- Solo accesible via funciones SECURITY DEFINER
CREATE INDEX IF NOT EXISTS idx_booking_tokens_cancel   ON public.booking_tokens(cancel_token);
CREATE INDEX IF NOT EXISTS idx_booking_tokens_reschedule ON public.booking_tokens(reschedule_token);
CREATE INDEX IF NOT EXISTS idx_booking_tokens_appt     ON public.booking_tokens(appointment_id);

-- =============================================================================
-- 2. create_public_booking ahora devuelve JSONB con tokens
-- =============================================================================
DROP FUNCTION IF EXISTS public.create_public_booking(text, uuid, uuid, date, time, time, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_slug          text,
  p_service_id    uuid,
  p_staff_id      uuid,
  p_date          date,
  p_start_time    time,
  p_end_time      time,
  p_customer_name text,
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
  v_user_id       uuid;
  v_customer_id   uuid;
  v_day_of_week   int;
  v_appt_id       uuid;
  v_cancel_token  text;
  v_reschedule_token text;
  v_is_valid_slot boolean;
  v_has_conflict  boolean;
BEGIN
  SELECT pr.user_id INTO v_user_id
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
    SELECT 1 FROM public.services s
    WHERE s.id = p_service_id
      AND s.user_id = v_user_id
      AND COALESCE(s.active, true) = true
      AND COALESCE(s.bookable_online, true) = true
  ) THEN
    RAISE EXCEPTION 'Servicio no disponible para reservas online';
  END IF;

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.staff_members st
    WHERE st.id = p_staff_id
      AND st.user_id = v_user_id
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

  INSERT INTO public.appointments (
    user_id, customer_id, service_id, staff_id,
    date, start_time, end_time, status, notes
  )
  VALUES (
    v_user_id, v_customer_id, p_service_id, p_staff_id,
    p_date, p_start_time, p_end_time, 'pending', COALESCE(p_notes, '')
  )
  RETURNING id INTO v_appt_id;

  -- Generar tokens de cancelar / reprogramar
  INSERT INTO public.booking_tokens (appointment_id)
  VALUES (v_appt_id)
  RETURNING cancel_token, reschedule_token
  INTO v_cancel_token, v_reschedule_token;

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
-- 3. get_booking_by_token — acceso público por token
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_booking_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'appointment_id', a.id,
    'business_name',  p.business_name,
    'business_slug',  p.slug,
    'service_name',   s.name,
    'date',           a.date::text,
    'start_time',     a.start_time::text,
    'status',         a.status
  ) INTO v_result
  FROM public.booking_tokens bt
  JOIN public.appointments a ON a.id = bt.appointment_id
  JOIN public.profiles p     ON p.user_id = a.user_id
  JOIN public.services s     ON s.id = a.service_id
  WHERE bt.cancel_token = p_token OR bt.reschedule_token = p_token
  LIMIT 1;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_booking_by_token(text) TO anon, authenticated;

-- =============================================================================
-- 4. cancel_booking_by_token
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_booking_by_token(p_token text, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt_id uuid;
BEGIN
  SELECT bt.appointment_id INTO v_appt_id
  FROM public.booking_tokens bt
  WHERE bt.cancel_token = p_token
  LIMIT 1;

  IF v_appt_id IS NULL THEN
    RAISE EXCEPTION 'Token inválido o no encontrado';
  END IF;

  UPDATE public.appointments
  SET status = 'canceled', notes = COALESCE(p_reason, notes)
  WHERE id = v_appt_id
    AND status NOT IN ('canceled', 'completed');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_booking_by_token(text, text) TO anon, authenticated;

-- =============================================================================
-- 5. mark_booking_rescheduled_by_token
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mark_booking_rescheduled_by_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt_id uuid;
BEGIN
  SELECT bt.appointment_id INTO v_appt_id
  FROM public.booking_tokens bt
  WHERE bt.reschedule_token = p_token
  LIMIT 1;

  IF v_appt_id IS NULL THEN
    RAISE EXCEPTION 'Token inválido o no encontrado';
  END IF;

  UPDATE public.appointments
  SET status = 'rescheduled'
  WHERE id = v_appt_id
    AND status NOT IN ('canceled', 'completed', 'rescheduled');
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_booking_rescheduled_by_token(text) TO anon, authenticated;

-- =============================================================================
-- 6. Actualizar handle_appointment_webhook_event
--    - Corregir spelling: 'canceled' → 'cancelled'
--    - Incluir tokens reales en los links del payload
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_appointment_webhook_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  event_type       TEXT;
  profile_slug     TEXT;
  v_cancel_token   TEXT;
  v_reschedule_token TEXT;
  payload          JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_type := 'booking.created';
  ELSIF TG_OP = 'UPDATE' THEN
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

  SELECT slug INTO profile_slug FROM public.profiles WHERE user_id = NEW.user_id LIMIT 1;

  -- Obtener tokens (pueden no existir para reservas antiguas)
  SELECT bt.cancel_token, bt.reschedule_token
  INTO v_cancel_token, v_reschedule_token
  FROM public.booking_tokens bt
  WHERE bt.appointment_id = NEW.id
  LIMIT 1;

  payload := jsonb_build_object(
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
      SELECT jsonb_build_object(
        'id',   m.id,
        'name', m.name
      )
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
      'booking',    CASE WHEN profile_slug IS NOT NULL THEN 'https://resviabooking.vercel.app/book/' || profile_slug ELSE NULL END,
      'cancel',     CASE WHEN v_cancel_token IS NOT NULL THEN 'https://resviabooking.vercel.app/booking/cancel/' || v_cancel_token ELSE NULL END,
      'reschedule', CASE WHEN v_reschedule_token IS NOT NULL THEN 'https://resviabooking.vercel.app/booking/reschedule/' || v_reschedule_token ELSE NULL END
    )
  );

  PERFORM public.enqueue_webhook_event(NEW.user_id, event_type, payload);
  RETURN NEW;
END;
$$;

-- Recrear trigger (por si acaso)
DROP TRIGGER IF EXISTS on_appointments_webhook_event ON public.appointments;
CREATE TRIGGER on_appointments_webhook_event
  AFTER INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.handle_appointment_webhook_event();
