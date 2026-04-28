-- =============================================================================
-- Align overlap trigger with booking availability semantics
-- Only active appointments (pending/confirmed) should block booking slots.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_appointment_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Non-active statuses are informational and must not block availability.
  IF NEW.status NOT IN ('pending', 'confirmed') THEN
    RETURN NEW;
  END IF;

  -- Keep business-hours validation for active appointments.
  IF NOT public.validate_appointment_availability(NEW.user_id, NEW.date, NEW.start_time, NEW.end_time) THEN
    RAISE EXCEPTION 'El horario solicitado no está disponible según la configuración del negocio.';
  END IF;

  IF NEW.start_time >= NEW.end_time THEN
    RAISE EXCEPTION 'La hora de fin debe ser posterior a la hora de inicio.';
  END IF;

  -- Match create_public_booking conflict logic: only pending/confirmed can collide.
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
