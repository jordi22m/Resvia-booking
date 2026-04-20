-- Robust worker queue on top of existing public.system_logs
-- Keeps current system and adds concurrent-safe processing primitives.

ALTER TABLE public.system_logs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id text;

ALTER TABLE public.system_logs
  DROP CONSTRAINT IF EXISTS system_logs_status_check;

ALTER TABLE public.system_logs
  ADD CONSTRAINT system_logs_status_check
  CHECK (status IN ('pending', 'processing', 'processed', 'error'));

CREATE INDEX IF NOT EXISTS idx_system_logs_queue_status_created
  ON public.system_logs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_system_logs_queue_processing
  ON public.system_logs(status, locked_at);

CREATE OR REPLACE FUNCTION public.get_next_events(p_limit integer)
RETURNS SETOF public.system_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(COALESCE(p_limit, 1), 1);
  v_worker_id text := COALESCE(NULLIF(current_setting('application_name', true), ''), 'worker-' || pg_backend_pid()::text);
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT s.id
    FROM public.system_logs s
    WHERE s.status = 'pending'
    ORDER BY s.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ), moved AS (
    UPDATE public.system_logs s
    SET
      status = 'processing',
      locked_at = now(),
      worker_id = v_worker_id
    FROM picked
    WHERE s.id = picked.id
    RETURNING s.*
  )
  SELECT * FROM moved;
END;
$$;

REVOKE ALL ON FUNCTION public.get_next_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_next_events(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_event_processed(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.system_logs
  SET
    status = 'processed',
    processed_at = now(),
    locked_at = NULL,
    worker_id = NULL,
    error = NULL
  WHERE id = p_event_id
    AND status IN ('processing', 'pending');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_event_processed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_event_processed(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_event_error(p_event_id uuid, p_error text)
RETURNS public.system_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.system_logs;
  v_next_attempts integer;
BEGIN
  SELECT *
  INTO v_row
  FROM public.system_logs
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found in system_logs', p_event_id;
  END IF;

  v_next_attempts := COALESCE(v_row.attempts, 0) + 1;

  UPDATE public.system_logs
  SET
    attempts = v_next_attempts,
    error = p_error,
    status = CASE WHEN v_next_attempts > 3 THEN 'error' ELSE 'pending' END,
    locked_at = NULL,
    worker_id = NULL,
    processed_at = CASE WHEN v_next_attempts > 3 THEN now() ELSE NULL END
  WHERE id = p_event_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_event_error(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_event_error(uuid, text) TO authenticated, service_role;
