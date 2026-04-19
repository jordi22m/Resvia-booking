DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'webhook_event_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.webhook_event_status AS ENUM ('pending', 'sent', 'failed');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES public.webhook_configs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status public.webhook_event_status NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_user_id ON public.webhook_events(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON public.webhook_events(status);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own webhook events" ON public.webhook_events;
CREATE POLICY "Users can view their own webhook events"
  ON public.webhook_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own webhook events" ON public.webhook_events;
CREATE POLICY "Users can insert their own webhook events"
  ON public.webhook_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own webhook events" ON public.webhook_events;
CREATE POLICY "Users can update their own webhook events"
  ON public.webhook_events FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own webhook events" ON public.webhook_events;
CREATE POLICY "Users can delete their own webhook events"
  ON public.webhook_events FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_webhook_events_updated_at ON public.webhook_events;
CREATE TRIGGER update_webhook_events_updated_at
  BEFORE UPDATE ON public.webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enqueue_webhook_event(
  p_user_id UUID,
  p_event_type TEXT,
  p_payload JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cfg_id UUID;
BEGIN
  SELECT id
    INTO cfg_id
    FROM public.webhook_configs
   WHERE user_id = p_user_id
     AND active = true
     AND p_event_type = ANY(selected_events)
   LIMIT 1;

  IF cfg_id IS NOT NULL THEN
    INSERT INTO public.webhook_events (user_id, config_id, event_type, payload)
    VALUES (p_user_id, cfg_id, p_event_type, p_payload);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_appointment_webhook_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  event_type TEXT;
  profile_slug TEXT;
  payload JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_type := 'booking.created';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status <> OLD.status THEN
      IF NEW.status = 'confirmed' THEN
        event_type := 'booking.confirmed';
      ELSIF NEW.status = 'canceled' THEN
        event_type := 'booking.canceled';
      ELSIF NEW.status = 'completed' THEN
        event_type := 'booking.completed';
      ELSIF NEW.status = 'rescheduled' THEN
        event_type := 'booking.rescheduled';
      ELSE
        RETURN NEW;
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

  payload := jsonb_build_object(
    'booking', jsonb_build_object(
      'id', NEW.id,
      'status', NEW.status,
      'date', NEW.date::TEXT,
      'startTime', NEW.start_time::TEXT,
      'endTime', NEW.end_time::TEXT,
      'notes', COALESCE(NEW.notes, '')
    ),
    'customer', (
      SELECT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'phone', COALESCE(c.phone, ''),
        'email', COALESCE(c.email, ''),
        'notes', COALESCE(c.notes, '')
      )
      FROM public.customers c
      WHERE c.id = NEW.customer_id
    ),
    'service', (
      SELECT jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'duration', s.duration,
        'price', s.price,
        'description', COALESCE(s.description, '')
      )
      FROM public.services s
      WHERE s.id = NEW.service_id
    ),
    'staff', (
      SELECT jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'role', COALESCE(m.role, ''),
        'email', COALESCE(m.email, ''),
        'phone', COALESCE(m.phone, '')
      )
      FROM public.staff_members m
      WHERE m.id = NEW.staff_id
    ),
    'business', (
      SELECT jsonb_build_object(
        'name', p.business_name,
        'slug', COALESCE(p.slug, ''),
        'email', p.email,
        'phone', COALESCE(p.phone, '')
      )
      FROM public.profiles p
      WHERE p.user_id = NEW.user_id
    ),
    'links', jsonb_build_object(
      'booking', CASE WHEN profile_slug IS NOT NULL AND profile_slug <> '' THEN concat('https://resviabooking.com/book/', profile_slug) ELSE NULL END,
      'cancel', CASE WHEN profile_slug IS NOT NULL AND profile_slug <> '' THEN concat('https://resviabooking.com/cancel/', NEW.id) ELSE NULL END,
      'reschedule', CASE WHEN profile_slug IS NOT NULL AND profile_slug <> '' THEN concat('https://resviabooking.com/reschedule/', NEW.id) ELSE NULL END
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

CREATE OR REPLACE FUNCTION public.handle_customer_webhook_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  payload JSONB;
BEGIN
  payload := jsonb_build_object(
    'customer', jsonb_build_object(
      'id', NEW.id,
      'name', NEW.name,
      'phone', COALESCE(NEW.phone, ''),
      'email', COALESCE(NEW.email, ''),
      'notes', COALESCE(NEW.notes, '')
    )
  );

  PERFORM public.enqueue_webhook_event(NEW.user_id, 'customer.created', payload);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_customers_webhook_event ON public.customers;
CREATE TRIGGER on_customers_webhook_event
  AFTER INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.handle_customer_webhook_event();
