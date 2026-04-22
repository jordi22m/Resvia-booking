-- =============================================================================
-- Public reschedule RPC (update existing appointment, do not duplicate rows)
-- - Prevents duplicate-key/unique_booking collisions caused by creating new rows
-- - Keeps old slot and new slot handling in one transaction
-- - Reuses existing booking tokens
-- =============================================================================

DROP FUNCTION IF EXISTS public.reschedule_booking_by_token(text, uuid, uuid, date, time, time, text);

CREATE OR REPLACE FUNCTION public.reschedule_booking_by_token(
  p_token      text,
  p_service_id uuid,
  p_staff_id   uuid,
  p_date       date,
  p_start_time time,
  p_end_time   time,
  p_notes      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt_id           uuid;
  v_user_id           uuid;
  v_old_status        public.appointment_status;
  v_day_of_week       int;
  v_is_valid_slot     boolean;
  v_has_conflict      boolean;
  v_cancel_token      text;
  v_reschedule_token  text;
BEGIN
  SELECT a.id, a.user_id, a.status, bt.cancel_token, bt.reschedule_token
  INTO v_appt_id, v_user_id, v_old_status, v_cancel_token, v_reschedule_token
  FROM public.booking_tokens bt
  JOIN public.appointments a ON a.id = bt.appointment_id
  WHERE bt.reschedule_token = p_token
  LIMIT 1;

  IF v_appt_id IS NULL THEN
    RAISE EXCEPTION 'Token invalido o no encontrado';
  END IF;

  IF v_old_status IN ('canceled', 'completed') THEN
    RAISE EXCEPTION 'La cita ya no puede reprogramarse';
  END IF;

  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'Rango horario invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.services s
    WHERE s.id = p_service_id
      AND s.user_id = v_user_id
      AND COALESCE(s.active, true) = true
      AND COALESCE(s.bookable_online, true) = true
  ) THEN
    RAISE EXCEPTION 'Servicio no disponible para reservas online';
  END IF;

  IF p_staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.staff_members st
    WHERE st.id = p_staff_id
      AND st.user_id = v_user_id
      AND COALESCE(st.active, true) = true
  ) THEN
    RAISE EXCEPTION 'Profesional no disponible';
  END IF;

  v_day_of_week := EXTRACT(DOW FROM p_date);
  SELECT EXISTS (
    SELECT 1
    FROM public.availability a
    WHERE a.user_id = v_user_id
      AND a.day_of_week = v_day_of_week
      AND p_start_time >= a.start_time
      AND p_end_time <= a.end_time
      AND COALESCE(
        (to_jsonb(a) ->> 'is_active')::boolean,
        (to_jsonb(a) ->> 'is_available')::boolean,
        true
      ) = true
  ) INTO v_is_valid_slot;

  IF NOT v_is_valid_slot THEN
    RAISE EXCEPTION 'Horario fuera de disponibilidad';
  END IF;

  -- Exclude the same appointment row from conflict detection.
  SELECT EXISTS (
    SELECT 1
    FROM public.appointments ap
    WHERE ap.id <> v_appt_id
      AND ap.user_id = v_user_id
      AND ap.date = p_date
      AND ap.status IN ('pending', 'confirmed')
      AND COALESCE(ap.staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(p_staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND tsrange((ap.date + ap.start_time), (ap.date + ap.end_time), '[)')
          && tsrange((p_date + p_start_time), (p_date + p_end_time), '[)')
  ) INTO v_has_conflict;

  IF v_has_conflict THEN
    RAISE EXCEPTION 'Este horario ya no esta disponible';
  END IF;

  UPDATE public.appointments
  SET service_id = p_service_id,
      staff_id = p_staff_id,
      date = p_date,
      start_time = p_start_time,
      end_time = p_end_time,
      notes = COALESCE(p_notes, notes)
  WHERE id = v_appt_id
    AND status NOT IN ('canceled', 'completed');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cita ya no puede reprogramarse';
  END IF;

  RETURN jsonb_build_object(
    'id', v_appt_id,
    'cancel_token', v_cancel_token,
    'reschedule_token', v_reschedule_token
  );

EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Este horario ya no esta disponible';
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_booking_by_token(text, uuid, uuid, date, time, time, text)
TO anon, authenticated;
