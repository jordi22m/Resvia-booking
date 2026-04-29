-- =============================================================================
-- Fix appointment validation trigger contract
-- Root cause seen in production: validate_appointment_availability signature/logic
-- drift causing "Servicio no encontrado" during appointment INSERT.
-- This migration forces a stable contract based on NEW.user_id.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_appointment_availability(
  p_user_id UUID,
  p_date DATE,
  p_start_time TIME,
  p_end_time TIME
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  day_of_week_val INTEGER;
  availability_record RECORD;
BEGIN
  day_of_week_val := EXTRACT(DOW FROM p_date);

  SELECT * INTO availability_record
  FROM public.availability a
  WHERE user_id = p_user_id
    AND day_of_week = day_of_week_val
    AND COALESCE(
      (to_jsonb(a) ->> 'is_active')::boolean,
      (to_jsonb(a) ->> 'is_available')::boolean,
      true
    ) = true
  ORDER BY start_time
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF p_start_time < availability_record.start_time OR p_end_time > availability_record.end_time THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_appointment_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only active appointments should validate and block slots.
  IF NEW.status NOT IN ('pending', 'confirmed') THEN
    RETURN NEW;
  END IF;

  IF NOT public.validate_appointment_availability(NEW.user_id, NEW.date, NEW.start_time, NEW.end_time) THEN
    RAISE EXCEPTION 'El horario solicitado no está disponible según la configuración del negocio.';
  END IF;

  IF NEW.start_time >= NEW.end_time THEN
    RAISE EXCEPTION 'La hora de fin debe ser posterior a la hora de inicio.';
  END IF;

  IF NEW.staff_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.staff_id = NEW.staff_id
      AND a.date = NEW.date
      AND a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND a.status IN ('pending', 'confirmed')
      AND a.start_time < NEW.end_time
      AND a.end_time > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'Ya existe una cita para ese profesional en ese horario.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_appointment_overlap_trg ON public.appointments;
CREATE TRIGGER check_appointment_overlap_trg
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.check_appointment_overlap();

NOTIFY pgrst, 'reload schema';
