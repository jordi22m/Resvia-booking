-- 1. Slug único en profiles (validación + constraint)
UPDATE public.profiles
SET slug = NULL
WHERE slug IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (slug) id FROM public.profiles WHERE slug IS NOT NULL ORDER BY slug, created_at ASC
  );

CREATE UNIQUE INDEX IF NOT EXISTS profiles_slug_unique_idx
  ON public.profiles (lower(slug))
  WHERE slug IS NOT NULL;

-- Validación de formato del slug
CREATE OR REPLACE FUNCTION public.validate_slug_format()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.slug IS NOT NULL THEN
    NEW.slug := lower(trim(NEW.slug));
    IF NEW.slug !~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$' THEN
      RAISE EXCEPTION 'Slug inválido. Use 2-50 caracteres: minúsculas, números o guiones.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_slug_format_trg ON public.profiles;
CREATE TRIGGER validate_slug_format_trg
  BEFORE INSERT OR UPDATE OF slug ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_slug_format();

-- 2. Trigger anti-solapamiento de citas
CREATE OR REPLACE FUNCTION public.check_appointment_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('canceled', 'noshow') THEN
    RETURN NEW;
  END IF;
  IF NEW.staff_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.start_time >= NEW.end_time THEN
    RAISE EXCEPTION 'La hora de fin debe ser posterior a la hora de inicio.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.staff_id = NEW.staff_id
      AND a.date = NEW.date
      AND a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND a.status NOT IN ('canceled', 'noshow')
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

-- 3. Tabla de suscripciones push
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own push subs"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own push subs"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own push subs"
  ON public.push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own push subs"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();