-- =============================================================================
-- Hotfix: align webhook_events schema with deployed dispatcher expectations
-- Fixes runtime 500: column webhook_events.max_attempts does not exist
-- =============================================================================

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
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

NOTIFY pgrst, 'reload schema';
