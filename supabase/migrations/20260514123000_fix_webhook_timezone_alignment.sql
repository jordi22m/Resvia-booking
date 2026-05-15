-- =============================================================================
-- Fix timezone alignment in webhook payloads and reminder scheduling
-- - Compute reminder windows using each business timezone (not forced UTC)
-- - Add explicit datetime/timezone fields to webhook payloads
-- - Keep existing booking.startTime/endTime fields for backward compatibility
-- =============================================================================

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
  v_timezone         TEXT;
  v_effective_tz     TEXT;
  v_starts_at_utc    TIMESTAMPTZ;
  v_ends_at_utc      TIMESTAMPTZ;
  payload            JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status <> OLD.status THEN
      IF    NEW.status = 'confirmed'   THEN event_type := 'booking.confirmed';
      ELSIF NEW.status = 'canceled'    THEN event_type := 'booking.canceled';
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

  INSERT INTO public.booking_tokens (appointment_id)
  VALUES (NEW.id)
  ON CONFLICT (appointment_id) DO NOTHING;

  SELECT p.slug, NULLIF(btrim(p.timezone), '')
  INTO v_slug, v_timezone
  FROM public.profiles p
  WHERE p.user_id = NEW.user_id
  LIMIT 1;

  v_effective_tz := COALESCE(v_timezone, 'UTC');

  SELECT bt.cancel_token, bt.reschedule_token
  INTO v_cancel_token, v_reschedule_token
  FROM public.booking_tokens bt
  WHERE bt.appointment_id = NEW.id
  LIMIT 1;

  v_starts_at_utc := (NEW.date::timestamp + NEW.start_time) AT TIME ZONE v_effective_tz;
  v_ends_at_utc := (NEW.date::timestamp + NEW.end_time) AT TIME ZONE v_effective_tz;

  payload := jsonb_build_object(
    'event', event_type,
    'booking', jsonb_build_object(
      'id', NEW.id,
      'status', NEW.status,
      'date', NEW.date::TEXT,
      'startTime', NEW.start_time::TEXT,
      'endTime', NEW.end_time::TEXT,
      'notes', COALESCE(NEW.notes, '')
    ),
    'datetime', jsonb_build_object(
      'date', NEW.date::TEXT,
      'start_time', NEW.start_time::TEXT,
      'end_time', NEW.end_time::TEXT,
      'timezone', v_effective_tz,
      'starts_at_utc', to_char(v_starts_at_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'ends_at_utc', to_char(v_ends_at_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'starts_at_local', to_char(v_starts_at_utc AT TIME ZONE v_effective_tz, 'YYYY-MM-DD"T"HH24:MI:SS'),
      'ends_at_local', to_char(v_ends_at_utc AT TIME ZONE v_effective_tz, 'YYYY-MM-DD"T"HH24:MI:SS')
    ),
    'timezone', v_effective_tz,
    'customer', (
      SELECT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'phone', COALESCE(c.phone, ''),
        'email', COALESCE(c.email, '')
      )
      FROM public.customers c WHERE c.id = NEW.customer_id
    ),
    'service', (
      SELECT jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'duration', s.duration,
        'price', s.price
      )
      FROM public.services s WHERE s.id = NEW.service_id
    ),
    'staff', (
      SELECT jsonb_build_object('id', m.id, 'name', m.name)
      FROM public.staff_members m WHERE m.id = NEW.staff_id
    ),
    'business', (
      SELECT jsonb_build_object(
        'name', p.business_name,
        'slug', COALESCE(p.slug, ''),
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

CREATE OR REPLACE FUNCTION public.enqueue_due_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_event_type TEXT;
  v_payload JSONB;
  v_base_url TEXT := 'https://resviabooking.vercel.app';
BEGIN
  FOR rec IN
    SELECT
      a.id,
      a.user_id,
      a.date,
      a.start_time,
      a.end_time,
      a.notes,
      a.status,
      a.customer_id,
      a.service_id,
      a.staff_id,
      c.name AS customer_name,
      c.phone AS customer_phone,
      c.email AS customer_email,
      s.name AS service_name,
      s.duration AS service_duration,
      s.price AS service_price,
      p.id AS business_id,
      p.business_name,
      p.slug,
      p.email AS business_email,
      p.phone AS business_phone,
      COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC') AS timezone,
      bt.cancel_token,
      bt.reschedule_token,
      ((a.date::timestamp + a.start_time) AT TIME ZONE COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC')) AS starts_at_utc,
      ((a.date::timestamp + a.end_time) AT TIME ZONE COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC')) AS ends_at_utc,
      EXTRACT(
        EPOCH FROM (
          ((a.date::timestamp + a.start_time) AT TIME ZONE COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC')) - now()
        )
      ) / 60 AS minutes_until
    FROM public.appointments a
    JOIN public.customers c ON c.id = a.customer_id
    JOIN public.services s ON s.id = a.service_id
    JOIN public.profiles p ON p.user_id = a.user_id
    LEFT JOIN public.booking_tokens bt ON bt.appointment_id = a.id
    WHERE a.status IN ('pending', 'confirmed')
      AND ((a.date::timestamp + a.start_time) AT TIME ZONE COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC')) > now()
      AND ((a.date::timestamp + a.start_time) AT TIME ZONE COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC')) <= now() + interval '25 hours'
  LOOP
    IF rec.minutes_until BETWEEN 23 * 60 AND 25 * 60 THEN
      v_event_type := 'reminder.24h';
    ELSIF rec.minutes_until BETWEEN 1 * 60 AND 3 * 60 THEN
      v_event_type := 'reminder.2h';
    ELSE
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.appointment_reminders ar
      WHERE ar.appointment_id = rec.id
        AND ar.reminder_type = REPLACE(v_event_type, 'reminder.', '')
    ) THEN
      CONTINUE;
    END IF;

    v_payload := jsonb_build_object(
      'reminder_type', v_event_type,
      'booking', jsonb_build_object(
        'id', rec.id,
        'status', rec.status,
        'date', rec.date::TEXT,
        'startTime', rec.start_time::TEXT,
        'endTime', rec.end_time::TEXT,
        'notes', COALESCE(rec.notes, '')
      ),
      'datetime', jsonb_build_object(
        'date', rec.date::TEXT,
        'start_time', rec.start_time::TEXT,
        'end_time', rec.end_time::TEXT,
        'timezone', rec.timezone,
        'starts_at_utc', to_char(rec.starts_at_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'ends_at_utc', to_char(rec.ends_at_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'starts_at_local', to_char(rec.starts_at_utc AT TIME ZONE rec.timezone, 'YYYY-MM-DD"T"HH24:MI:SS'),
        'ends_at_local', to_char(rec.ends_at_utc AT TIME ZONE rec.timezone, 'YYYY-MM-DD"T"HH24:MI:SS')
      ),
      'timezone', rec.timezone,
      'customer', jsonb_build_object(
        'id', rec.customer_id,
        'name', rec.customer_name,
        'phone', COALESCE(rec.customer_phone, ''),
        'email', COALESCE(rec.customer_email, '')
      ),
      'service', jsonb_build_object(
        'id', rec.service_id,
        'name', rec.service_name,
        'duration', rec.service_duration,
        'price', rec.service_price
      ),
      'business', jsonb_build_object(
        'id', rec.business_id,
        'name', rec.business_name,
        'slug', COALESCE(rec.slug, ''),
        'email', COALESCE(rec.business_email, ''),
        'phone', COALESCE(rec.business_phone, '')
      ),
      'links', jsonb_build_object(
        'booking', CASE
          WHEN rec.slug IS NOT NULL AND btrim(rec.slug) <> ''
            THEN v_base_url || '/book/' || rec.slug
          ELSE NULL
        END,
        'cancel', CASE
          WHEN rec.cancel_token IS NOT NULL
            THEN v_base_url || '/booking/cancel/' || rec.cancel_token
          ELSE NULL
        END,
        'reschedule', CASE
          WHEN rec.reschedule_token IS NOT NULL
            THEN v_base_url || '/booking/reschedule/' || rec.reschedule_token
          ELSE NULL
        END
      ),
      'reminder', jsonb_build_object(
        'type', REPLACE(v_event_type, 'reminder.', ''),
        'minutes_until', rec.minutes_until
      )
    );

    IF NOT EXISTS (
      SELECT 1 FROM public.webhook_configs wc
      WHERE wc.user_id = rec.user_id
        AND wc.active = true
        AND v_event_type = ANY(wc.selected_events)
    ) THEN
      CONTINUE;
    END IF;

    PERFORM public.enqueue_webhook_event(rec.user_id, v_event_type, v_payload);

    INSERT INTO public.appointment_reminders (appointment_id, reminder_type)
    VALUES (rec.id, REPLACE(v_event_type, 'reminder.', ''))
    ON CONFLICT (appointment_id, reminder_type) DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_due_reminders(p_limit int DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_base_url TEXT := 'https://resviabooking.vercel.app';
BEGIN
  SELECT jsonb_agg(row_to_json(r)) INTO v_result
  FROM (
    SELECT
      a.id AS appointment_id,
      a.user_id,
      a.customer_id,
      a.service_id,
      p.id AS business_id,
      a.date::TEXT AS date,
      a.start_time::TEXT AS start_time,
      a.end_time::TEXT AS end_time,
      a.status,
      COALESCE(a.notes, '') AS notes,
      c.name AS customer_name,
      COALESCE(c.phone, '') AS customer_phone,
      COALESCE(c.email, '') AS customer_email,
      s.name AS service_name,
      s.duration AS service_duration,
      s.price AS service_price,
      p.business_name,
      COALESCE(p.slug, '') AS business_slug,
      COALESCE(p.email, '') AS business_email,
      COALESCE(p.phone, '') AS business_phone,
      COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC') AS timezone,
      CASE
        WHEN p.slug IS NOT NULL AND btrim(p.slug) <> ''
          THEN v_base_url || '/book/' || p.slug
        ELSE NULL
      END AS booking_url,
      CASE
        WHEN bt.cancel_token IS NOT NULL
          THEN v_base_url || '/booking/cancel/' || bt.cancel_token
        ELSE NULL
      END AS cancel_url,
      CASE
        WHEN bt.reschedule_token IS NOT NULL
          THEN v_base_url || '/booking/reschedule/' || bt.reschedule_token
        ELSE NULL
      END AS reschedule_url,
      to_char((((a.date::timestamp + a.start_time) AT TIME ZONE COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC')) AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS starts_at_utc,
      to_char((((a.date::timestamp + a.start_time) AT TIME ZONE COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC')) AT TIME ZONE COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC')), 'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at_local,
      CASE
        WHEN EXTRACT(
          EPOCH FROM (
            ((a.date::timestamp + a.start_time) AT TIME ZONE COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC')) - now()
          )
        ) / 3600 BETWEEN 23 AND 25
          THEN 'reminder.24h'
        WHEN EXTRACT(
          EPOCH FROM (
            ((a.date::timestamp + a.start_time) AT TIME ZONE COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC')) - now()
          )
        ) / 3600 BETWEEN 1 AND 3
          THEN 'reminder.2h'
      END AS reminder_type
    FROM public.appointments a
    JOIN public.customers c ON c.id = a.customer_id
    JOIN public.services s ON s.id = a.service_id
    JOIN public.profiles p ON p.user_id = a.user_id
    LEFT JOIN public.booking_tokens bt ON bt.appointment_id = a.id
    WHERE a.status IN ('pending', 'confirmed')
      AND ((a.date::timestamp + a.start_time) AT TIME ZONE COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC')) > now()
      AND ((a.date::timestamp + a.start_time) AT TIME ZONE COALESCE(NULLIF(btrim(p.timezone), ''), 'UTC')) <= now() + interval '25 hours'
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

GRANT EXECUTE ON FUNCTION public.enqueue_due_reminders() TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_reminders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_reminders(int) TO authenticated;

NOTIFY pgrst, 'reload schema';
