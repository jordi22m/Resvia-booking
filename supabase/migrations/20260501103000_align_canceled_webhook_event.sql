-- =============================================================================
-- Align canceled webhook event spelling with appointment status
-- - Keep database enum as 'canceled'
-- - Emit booking.canceled instead of booking.cancelled
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

NOTIFY pgrst, 'reload schema';
