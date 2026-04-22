-- =============================================================================
-- Fix RPC token signatures for public cancel/reschedule flows
-- - Removes ambiguous UUID overloads
-- - Keeps a single TEXT-based contract for booking token RPCs
-- - Idempotent and safe to run multiple times
-- =============================================================================

-- 1) Drop legacy/ambiguous overloads first
DROP FUNCTION IF EXISTS public.get_booking_by_token(uuid);
DROP FUNCTION IF EXISTS public.cancel_booking_by_token(uuid, text);
DROP FUNCTION IF EXISTS public.cancel_booking_by_token(uuid);
DROP FUNCTION IF EXISTS public.mark_booking_rescheduled_by_token(uuid);

-- 2) Recreate canonical TEXT signatures
DROP FUNCTION IF EXISTS public.get_booking_by_token(text);
CREATE OR REPLACE FUNCTION public.get_booking_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'appointment_id', a.id,
    'business_name',  p.business_name,
    'business_slug',  p.slug,
    'service_name',   s.name,
    'date',           a.date::text,
    'start_time',     a.start_time::text,
    'status',         a.status
  ) INTO v_result
  FROM public.booking_tokens bt
  JOIN public.appointments a ON a.id = bt.appointment_id
  JOIN public.profiles p     ON p.user_id = a.user_id
  JOIN public.services s     ON s.id = a.service_id
  WHERE bt.cancel_token = p_token OR bt.reschedule_token = p_token
  LIMIT 1;

  RETURN v_result;
END;
$$;

DROP FUNCTION IF EXISTS public.cancel_booking_by_token(text, text);
CREATE OR REPLACE FUNCTION public.cancel_booking_by_token(p_token text, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt_id uuid;
  v_updated_count integer;
BEGIN
  SELECT bt.appointment_id INTO v_appt_id
  FROM public.booking_tokens bt
  WHERE bt.cancel_token = p_token
  LIMIT 1;

  IF v_appt_id IS NULL THEN
    RAISE EXCEPTION 'Token invalido o no encontrado';
  END IF;

  UPDATE public.appointments
  SET status = 'canceled', notes = COALESCE(p_reason, notes)
  WHERE id = v_appt_id
    AND status NOT IN ('canceled', 'completed');

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'La cita ya no puede cancelarse';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.mark_booking_rescheduled_by_token(text);
CREATE OR REPLACE FUNCTION public.mark_booking_rescheduled_by_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt_id uuid;
  v_updated_count integer;
BEGIN
  SELECT bt.appointment_id INTO v_appt_id
  FROM public.booking_tokens bt
  WHERE bt.reschedule_token = p_token
  LIMIT 1;

  IF v_appt_id IS NULL THEN
    RAISE EXCEPTION 'Token invalido o no encontrado';
  END IF;

  UPDATE public.appointments
  SET status = 'rescheduled'
  WHERE id = v_appt_id
    AND status NOT IN ('canceled', 'completed', 'rescheduled');

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'La cita ya no puede reprogramarse';
  END IF;
END;
$$;

-- 3) Ensure grants on canonical signatures
GRANT EXECUTE ON FUNCTION public.get_booking_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_by_token(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_booking_rescheduled_by_token(text) TO anon, authenticated;
