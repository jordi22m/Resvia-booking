-- =============================================================================
-- Fix reminder webhook payload to include full booking data
-- - Join customers, services and profiles when building reminder events
-- - Align reminder webhook payload with booking.created structure
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
      bt.cancel_token,
      bt.reschedule_token,
      EXTRACT(EPOCH FROM ((a.date + a.start_time) AT TIME ZONE 'UTC' - now())) / 60 AS minutes_until
    FROM public.appointments a
    JOIN public.customers c ON c.id = a.customer_id
    JOIN public.services s ON s.id = a.service_id
    JOIN public.profiles p ON p.user_id = a.user_id
    LEFT JOIN public.booking_tokens bt ON bt.appointment_id = a.id
    WHERE a.status IN ('pending', 'confirmed')
      AND (a.date + a.start_time) AT TIME ZONE 'UTC' > now()
      AND (a.date + a.start_time) AT TIME ZONE 'UTC' <= now() + interval '25 hours'
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

    -- Only proceed if an active webhook_config exists for this user with the reminder event.
    -- If no config is found, skip WITHOUT marking in appointment_reminders so that the
    -- reminder can still be dispatched once the user configures their webhook settings.
    IF NOT EXISTS (
      SELECT 1 FROM public.webhook_configs wc
      WHERE wc.user_id = rec.user_id
        AND wc.active = true
        AND v_event_type = ANY(wc.selected_events)
    ) THEN
      CONTINUE;
    END IF;

    PERFORM public.enqueue_webhook_event(rec.user_id, v_event_type, v_payload);

    -- Mark as sent only after the webhook event has been successfully enqueued.
    INSERT INTO public.appointment_reminders (appointment_id, reminder_type)
    VALUES (rec.id, REPLACE(v_event_type, 'reminder.', ''))
    ON CONFLICT (appointment_id, reminder_type) DO NOTHING;
  END LOOP;
END;
$$;

-- Allow the Edge Function (service_role) and authenticated users to call this function.
GRANT EXECUTE ON FUNCTION public.enqueue_due_reminders() TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_reminders() TO authenticated;

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
      CASE
        WHEN EXTRACT(EPOCH FROM ((a.date + a.start_time) AT TIME ZONE 'UTC' - now())) / 3600 BETWEEN 23 AND 25
          THEN 'reminder.24h'
        WHEN EXTRACT(EPOCH FROM ((a.date + a.start_time) AT TIME ZONE 'UTC' - now())) / 3600 BETWEEN 1 AND 3
          THEN 'reminder.2h'
      END AS reminder_type
    FROM public.appointments a
    JOIN public.customers c ON c.id = a.customer_id
    JOIN public.services s ON s.id = a.service_id
    JOIN public.profiles p ON p.user_id = a.user_id
    LEFT JOIN public.booking_tokens bt ON bt.appointment_id = a.id
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

NOTIFY pgrst, 'reload schema';