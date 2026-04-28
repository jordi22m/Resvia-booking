-- =============================================================================
-- Webhook dispatcher + reminder job backend alignment
-- - Ensures webhook_events keeps business/customer/appointment references
-- - Enriches enqueue_webhook_event with retry metadata and references
-- - Replaces SQL reminder cron with Edge Function reminder job
-- =============================================================================

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS event_name TEXT,
  ADD COLUMN IF NOT EXISTS attempts INTEGER,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

UPDATE public.webhook_events
SET
  delivery_status = COALESCE(delivery_status, status::text),
  event_name = COALESCE(event_name, event_type),
  attempts = COALESCE(attempts, attempt_count, 0)
WHERE delivery_status IS NULL
   OR event_name IS NULL
   OR attempts IS NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_events_business_id ON public.webhook_events(business_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_appointment_id ON public.webhook_events(appointment_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_customer_id ON public.webhook_events(customer_id);

CREATE OR REPLACE FUNCTION public.enqueue_webhook_event(
  p_user_id UUID,
  p_event_type TEXT,
  p_payload JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config_id      UUID;
  v_business_id    UUID;
  v_appointment_id UUID;
  v_customer_id    UUID;
BEGIN
  SELECT wc.id
    INTO v_config_id
    FROM public.webhook_configs wc
   WHERE wc.user_id = p_user_id
     AND wc.active = true
     AND p_event_type = ANY(wc.selected_events)
   LIMIT 1;

  IF v_config_id IS NULL THEN
    RETURN;
  END IF;

  SELECT p.id
    INTO v_business_id
    FROM public.profiles p
   WHERE p.user_id = p_user_id
   LIMIT 1;

  v_appointment_id := NULLIF(COALESCE(
    p_payload #>> '{booking,id}',
    p_payload #>> '{appointment,id}',
    p_payload ->> 'appointment_id'
  ), '')::uuid;

  v_customer_id := NULLIF(COALESCE(
    p_payload #>> '{customer,id}',
    p_payload ->> 'customer_id'
  ), '')::uuid;

  INSERT INTO public.webhook_events (
    user_id,
    business_id,
    config_id,
    appointment_id,
    customer_id,
    event_type,
    event_name,
    payload,
    status,
    delivery_status,
    attempt_count,
    attempts,
    next_retry_at
  )
  VALUES (
    p_user_id,
    v_business_id,
    v_config_id,
    v_appointment_id,
    v_customer_id,
    p_event_type,
    p_event_type,
    jsonb_set(
      jsonb_set(COALESCE(p_payload, '{}'::jsonb), '{event}', to_jsonb(p_event_type), true),
      '{timestamp}',
      to_jsonb(now()),
      true
    ),
    'pending',
    'pending',
    0,
    0,
    now()
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-appointment-reminders') THEN
    PERFORM cron.unschedule('process-appointment-reminders');
  END IF;
END;
$$;

SELECT cron.schedule(
  'process-appointment-reminders',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/process-appointment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body    := '{"limit":100,"dispatchImmediately":true}'::jsonb
  );
  $$
);
