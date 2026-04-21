-- =============================================================================
-- Sistema de recordatorios automáticos 24h y 2h antes de cada cita
-- Los recordatorios se encolan como webhook_events y n8n los consume
-- =============================================================================

-- 1. Tabla para rastrear qué recordatorios ya se enviaron (evita duplicados)
CREATE TABLE IF NOT EXISTS public.appointment_reminders (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id UUID        NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  reminder_type  TEXT        NOT NULL CHECK (reminder_type IN ('24h', '2h')),
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (appointment_id, reminder_type)
);

CREATE INDEX IF NOT EXISTS idx_appt_reminders_appt ON public.appointment_reminders(appointment_id);

-- =============================================================================
-- 2. Función que busca citas pendientes con recordatorio pendiente y las encola
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enqueue_due_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_event_type TEXT;
  v_payload    JSONB;
  v_cancel_token     TEXT;
  v_reschedule_token TEXT;
  v_slug             TEXT;
BEGIN
  -- Buscar citas pendientes/confirmadas en ventana 24h o 2h
  FOR rec IN
    SELECT
      a.id,
      a.user_id,
      a.date,
      a.start_time,
      a.end_time,
      a.notes,
      a.customer_id,
      a.service_id,
      a.staff_id,
      a.status,
      -- Cuántos minutos faltan hasta la cita (en la timezone del negocio, simplificamos con UTC+0 por defecto)
      EXTRACT(EPOCH FROM ((a.date + a.start_time) AT TIME ZONE 'UTC' - now())) / 60 AS minutes_until
    FROM public.appointments a
    WHERE a.status IN ('pending', 'confirmed')
      -- Ventana total: entre 2 minutos antes del umbral y el umbral exacto
      AND (a.date + a.start_time) AT TIME ZONE 'UTC' > now()
      AND (a.date + a.start_time) AT TIME ZONE 'UTC' <= now() + interval '25 hours'
  LOOP
    -- Determinar qué tipo de recordatorio corresponde
    IF rec.minutes_until BETWEEN 23 * 60 AND 25 * 60 THEN
      v_event_type := 'reminder.24h';
    ELSIF rec.minutes_until BETWEEN 1 * 60 AND 3 * 60 THEN
      v_event_type := 'reminder.2h';
    ELSE
      CONTINUE;
    END IF;

    -- Saltar si ya se envió este recordatorio para esta cita
    IF EXISTS (
      SELECT 1 FROM public.appointment_reminders ar
      WHERE ar.appointment_id = rec.id
        AND ar.reminder_type = REPLACE(v_event_type, 'reminder.', '')
    ) THEN
      CONTINUE;
    END IF;

    -- Obtener datos extra
    SELECT slug INTO v_slug FROM public.profiles WHERE user_id = rec.user_id LIMIT 1;
    SELECT bt.cancel_token, bt.reschedule_token
    INTO v_cancel_token, v_reschedule_token
    FROM public.booking_tokens bt WHERE bt.appointment_id = rec.id LIMIT 1;

    v_payload := jsonb_build_object(
      'reminder_type', v_event_type,
      'booking', jsonb_build_object(
        'id',        rec.id,
        'status',    rec.status,
        'date',      rec.date::TEXT,
        'startTime', rec.start_time::TEXT,
        'endTime',   rec.end_time::TEXT
      ),
      'customer', (
        SELECT jsonb_build_object(
          'id',    c.id,
          'name',  c.name,
          'phone', COALESCE(c.phone, ''),
          'email', COALESCE(c.email, '')
        )
        FROM public.customers c WHERE c.id = rec.customer_id
      ),
      'service', (
        SELECT jsonb_build_object(
          'id',       s.id,
          'name',     s.name,
          'duration', s.duration,
          'price',    s.price
        )
        FROM public.services s WHERE s.id = rec.service_id
      ),
      'business', (
        SELECT jsonb_build_object(
          'name',  p.business_name,
          'slug',  COALESCE(p.slug, ''),
          'phone', COALESCE(p.phone, '')
        )
        FROM public.profiles p WHERE p.user_id = rec.user_id
      ),
      'links', jsonb_build_object(
        'cancel',     CASE WHEN v_cancel_token IS NOT NULL
                       THEN 'https://resviabooking.vercel.app/booking/cancel/' || v_cancel_token
                       ELSE NULL END,
        'reschedule', CASE WHEN v_reschedule_token IS NOT NULL
                       THEN 'https://resviabooking.vercel.app/booking/reschedule/' || v_reschedule_token
                       ELSE NULL END
      )
    );

    -- Encolar el evento de recordatorio
    PERFORM public.enqueue_webhook_event(rec.user_id, v_event_type, v_payload);

    -- Marcar como enviado para evitar duplicados
    INSERT INTO public.appointment_reminders (appointment_id, reminder_type)
    VALUES (rec.id, REPLACE(v_event_type, 'reminder.', ''))
    ON CONFLICT (appointment_id, reminder_type) DO NOTHING;

  END LOOP;
END;
$$;

-- =============================================================================
-- 3. RPC pública get_due_reminders (para el hook existente en la app)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_due_reminders(p_limit int DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(r)) INTO v_result
  FROM (
    SELECT
      a.id             AS appointment_id,
      a.user_id,
      a.date::TEXT     AS date,
      a.start_time::TEXT AS start_time,
      a.status,
      c.name           AS customer_name,
      c.phone          AS customer_phone,
      c.email          AS customer_email,
      s.name           AS service_name,
      CASE
        WHEN EXTRACT(EPOCH FROM ((a.date + a.start_time) AT TIME ZONE 'UTC' - now())) / 3600 BETWEEN 23 AND 25
          THEN 'reminder.24h'
        WHEN EXTRACT(EPOCH FROM ((a.date + a.start_time) AT TIME ZONE 'UTC' - now())) / 3600 BETWEEN 1 AND 3
          THEN 'reminder.2h'
      END AS reminder_type
    FROM public.appointments a
    JOIN public.customers c ON c.id = a.customer_id
    JOIN public.services  s ON s.id = a.service_id
    WHERE a.status IN ('pending', 'confirmed')
      AND (a.date + a.start_time) AT TIME ZONE 'UTC' > now()
      AND (a.date + a.start_time) AT TIME ZONE 'UTC' <= now() + interval '25 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.appointment_reminders ar
        WHERE ar.appointment_id = a.id
          AND ar.reminder_type IN ('24h', '2h')
      )
    ORDER BY a.date, a.start_time
    LIMIT p_limit
  ) r;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_due_reminders(int) TO authenticated;

-- =============================================================================
-- 4. RPC mark_reminder_sent (para el hook existente en la app)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mark_reminder_sent(
  p_appointment_id uuid,
  p_reminder_type  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.appointment_reminders (appointment_id, reminder_type)
  VALUES (p_appointment_id, REPLACE(p_reminder_type, 'reminder.', ''))
  ON CONFLICT (appointment_id, reminder_type) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_reminder_sent(uuid, text) TO authenticated;

-- =============================================================================
-- 5. pg_cron: procesar recordatorios cada 15 minutos
-- =============================================================================
SELECT cron.schedule(
  'process-appointment-reminders',
  '*/15 * * * *',
  $$ SELECT public.enqueue_due_reminders(); $$
);
