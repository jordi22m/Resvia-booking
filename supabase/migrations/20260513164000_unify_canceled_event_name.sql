-- =============================================================================
-- Unify webhook cancel event name to booking.canceled
-- - Normalizes legacy selected_events values (booking.cancelled -> booking.canceled)
-- - Keeps backward compatibility in enqueue_webhook_event for legacy listeners
-- =============================================================================

UPDATE public.webhook_configs wc
SET selected_events = (
  SELECT COALESCE(array_agg(DISTINCT evt), '{}'::text[])
  FROM unnest(array_replace(COALESCE(wc.selected_events, '{}'::text[]), 'booking.cancelled', 'booking.canceled')) AS evt
)
WHERE 'booking.cancelled' = ANY(COALESCE(wc.selected_events, '{}'::text[]));

CREATE OR REPLACE FUNCTION public.enqueue_webhook_event(
  p_user_id uuid,
  p_event_type text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_config_id uuid;
  v_business_id uuid;
  v_appointment_id uuid;
  v_customer_id uuid;
  v_event_type text;
BEGIN
  v_event_type := CASE
    WHEN p_event_type = 'booking.cancelled' THEN 'booking.canceled'
    ELSE p_event_type
  END;

  SELECT wc.id
  INTO v_config_id
  FROM public.webhook_configs wc
  WHERE wc.user_id = p_user_id
    AND wc.active = true
    AND (
      v_event_type = ANY(COALESCE(wc.selected_events, '{}'::text[]))
      OR (
        v_event_type = 'booking.canceled'
        AND 'booking.cancelled' = ANY(COALESCE(wc.selected_events, '{}'::text[]))
      )
    )
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
    v_event_type,
    v_event_type,
    jsonb_set(
      jsonb_set(COALESCE(p_payload, '{}'::jsonb), '{event}', to_jsonb(v_event_type), true),
      '{timestamp}',
      to_jsonb(now()),
      true
    ),
    'pending',
    'pending',
    0,
    0,
    now()
  )
  ON CONFLICT (appointment_id, event_type) DO NOTHING;
END;
$function$;

NOTIFY pgrst, 'reload schema';