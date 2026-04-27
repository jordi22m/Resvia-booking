-- =============================================================================
-- Align profiles schema with register flow and rebuild signup trigger
-- Prevents signup 500 caused by schema drift or stale custom triggers
-- =============================================================================

-- Ensure business_type enum exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'business_type'
  ) THEN
    CREATE TYPE public.business_type AS ENUM (
      'peluqueria', 'barberia', 'estetica', 'fisioterapia',
      'masajes', 'osteopatia', 'podologia', 'nutricion',
      'psicologia', 'veterinaria', 'otro'
    );
  END IF;
END
$$;

-- Ensure register/profile columns exist.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS business_name TEXT,
  ADD COLUMN IF NOT EXISTS business_type public.business_type,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Ensure booking/settings columns used by UI exist.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS allow_weekends BOOLEAN,
  ADD COLUMN IF NOT EXISTS slot_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS buffer_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS min_gap_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS min_notice_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS max_days_ahead INTEGER,
  ADD COLUMN IF NOT EXISTS require_phone BOOLEAN,
  ADD COLUMN IF NOT EXISTS require_email BOOLEAN,
  ADD COLUMN IF NOT EXISTS public_booking_title TEXT,
  ADD COLUMN IF NOT EXISTS public_booking_description TEXT;

-- Normalize values and enforce deterministic defaults.
UPDATE public.profiles
SET
  business_name = COALESCE(NULLIF(trim(business_name), ''), 'Mi Negocio'),
  owner_name = COALESCE(NULLIF(trim(owner_name), ''), 'Propietario'),
  email = COALESCE(email, ''),
  business_type = COALESCE(business_type, 'otro'::public.business_type),
  country = COALESCE(country, 'España'),
  timezone = COALESCE(timezone, 'Europe/Madrid'),
  currency = COALESCE(currency, 'EUR'),
  role = COALESCE(role, 'owner'),
  created_at = COALESCE(created_at, now()),
  updated_at = COALESCE(updated_at, now()),
  booking_enabled = COALESCE(booking_enabled, true),
  allow_weekends = COALESCE(allow_weekends, true),
  slot_minutes = COALESCE(slot_minutes, 30),
  buffer_minutes = COALESCE(buffer_minutes, 0),
  min_gap_minutes = COALESCE(min_gap_minutes, 0),
  min_notice_minutes = COALESCE(min_notice_minutes, 0),
  max_days_ahead = COALESCE(max_days_ahead, 60),
  require_phone = COALESCE(require_phone, true),
  require_email = COALESCE(require_email, false)
WHERE
  business_name IS NULL OR trim(business_name) = '' OR
  owner_name IS NULL OR trim(owner_name) = '' OR
  email IS NULL OR
  business_type IS NULL OR
  country IS NULL OR timezone IS NULL OR currency IS NULL OR role IS NULL OR
  created_at IS NULL OR updated_at IS NULL OR
  booking_enabled IS NULL OR allow_weekends IS NULL OR slot_minutes IS NULL OR
  buffer_minutes IS NULL OR min_gap_minutes IS NULL OR min_notice_minutes IS NULL OR
  max_days_ahead IS NULL OR require_phone IS NULL OR require_email IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN business_name SET DEFAULT 'Mi Negocio',
  ALTER COLUMN owner_name SET DEFAULT 'Propietario',
  ALTER COLUMN email SET DEFAULT '',
  ALTER COLUMN business_type SET DEFAULT 'otro',
  ALTER COLUMN country SET DEFAULT 'España',
  ALTER COLUMN timezone SET DEFAULT 'Europe/Madrid',
  ALTER COLUMN currency SET DEFAULT 'EUR',
  ALTER COLUMN role SET DEFAULT 'owner',
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN booking_enabled SET DEFAULT true,
  ALTER COLUMN allow_weekends SET DEFAULT true,
  ALTER COLUMN slot_minutes SET DEFAULT 30,
  ALTER COLUMN buffer_minutes SET DEFAULT 0,
  ALTER COLUMN min_gap_minutes SET DEFAULT 0,
  ALTER COLUMN min_notice_minutes SET DEFAULT 0,
  ALTER COLUMN max_days_ahead SET DEFAULT 60,
  ALTER COLUMN require_phone SET DEFAULT true,
  ALTER COLUMN require_email SET DEFAULT false;

ALTER TABLE public.profiles
  ALTER COLUMN business_name SET NOT NULL,
  ALTER COLUMN owner_name SET NOT NULL,
  ALTER COLUMN email SET NOT NULL,
  ALTER COLUMN business_type SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN booking_enabled SET NOT NULL,
  ALTER COLUMN allow_weekends SET NOT NULL,
  ALTER COLUMN slot_minutes SET NOT NULL,
  ALTER COLUMN buffer_minutes SET NOT NULL,
  ALTER COLUMN min_gap_minutes SET NOT NULL,
  ALTER COLUMN min_notice_minutes SET NOT NULL,
  ALTER COLUMN max_days_ahead SET NOT NULL,
  ALTER COLUMN require_phone SET NOT NULL,
  ALTER COLUMN require_email SET NOT NULL;

-- Ensure required uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_unique_idx ON public.profiles(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_slug_unique_idx ON public.profiles (lower(slug)) WHERE slug IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_unique_slug(base_slug TEXT)
RETURNS TEXT AS $$
DECLARE
  new_slug TEXT := base_slug;
  counter INTEGER := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE lower(slug) = lower(new_slug)) LOOP
    new_slug := base_slug || '-' || counter;
    counter := counter + 1;
  END LOOP;
  RETURN new_slug;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  business_name_val TEXT;
  owner_name_val TEXT;
  email_val TEXT;
  business_type_val TEXT;
  base_slug TEXT;
  unique_slug TEXT;
BEGIN
  business_name_val := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'business_name'), ''), 'Mi Negocio');
  owner_name_val := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'owner_name'), ''), 'Propietario');
  email_val := COALESCE(NEW.email, '');
  business_type_val := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'business_type'), ''), 'otro');

  IF business_type_val NOT IN (
    'peluqueria', 'barberia', 'estetica', 'fisioterapia',
    'masajes', 'osteopatia', 'podologia', 'nutricion',
    'psicologia', 'veterinaria', 'otro'
  ) THEN
    business_type_val := 'otro';
  END IF;

  base_slug := lower(regexp_replace(business_name_val, '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  IF base_slug = '' THEN
    base_slug := 'negocio';
  END IF;

  unique_slug := public.generate_unique_slug(base_slug);

  INSERT INTO public.profiles (
    user_id,
    business_name,
    business_type,
    slug,
    owner_name,
    email,
    phone,
    whatsapp,
    address,
    city,
    postal_code
  )
  VALUES (
    NEW.id,
    business_name_val,
    business_type_val::public.business_type,
    unique_slug,
    owner_name_val,
    email_val,
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'phone', '')), ''),
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'whatsapp', '')), ''),
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'address', '')), ''),
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'city', '')), ''),
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'postal_code', '')), '')
  )
  ON CONFLICT (user_id) DO UPDATE SET
    business_name = EXCLUDED.business_name,
    business_type = EXCLUDED.business_type,
    owner_name = EXCLUDED.owner_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    whatsapp = EXCLUDED.whatsapp,
    address = EXCLUDED.address,
    city = EXCLUDED.city,
    postal_code = EXCLUDED.postal_code,
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Remove all custom triggers on auth.users and keep only the canonical one.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth'
      AND c.relname = 'users'
      AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON auth.users', r.tgname);
  END LOOP;
END
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

NOTIFY pgrst, 'reload schema';