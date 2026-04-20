-- Webhook reliability and traceability improvements
-- Keeps existing architecture (webhook_events queue + send-webhook dispatcher).

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS response_status integer,
  ADD COLUMN IF NOT EXISTS response_body text,
  ADD COLUMN IF NOT EXISTS correlation_id uuid NOT NULL DEFAULT gen_random_uuid();

UPDATE public.webhook_events
SET next_retry_at = COALESCE(next_retry_at, created_at)
WHERE next_retry_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_events_status_next_retry
  ON public.webhook_events(status, next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS idx_webhook_events_correlation_id
  ON public.webhook_events(correlation_id);

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
    INSERT INTO public.webhook_events (
      user_id,
      config_id,
      event_type,
      payload,
      status,
      next_retry_at
    )
    VALUES (
      p_user_id,
      cfg_id,
      p_event_type,
      p_payload,
      'pending',
      now()
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_webhook_event(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.webhook_events
  SET
    status = 'pending',
    last_error = NULL,
    next_retry_at = now(),
    updated_at = now()
  WHERE id = p_event_id
    AND user_id = auth.uid()
    AND status = 'failed'
    AND attempt_count < max_attempts;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.retry_webhook_event(uuid) TO authenticated;
