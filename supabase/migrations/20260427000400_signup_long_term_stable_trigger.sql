-- =============================================================================
-- Long-term fix for signup stability and profile creation
-- Replaces emergency non-blocking behavior with deterministic robust logic
-- =============================================================================

-- 1) Ensure critical profile columns are present and normalized.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS business_name TEXT,
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS business_type public.business_type,
  ADD COLUMN IF NOT EXISTS slug TEXT;

UPDATE public.profiles
SET
  business_name = COALESCE(NULLIF(trim(business_name), ''), 'Mi Negocio'),
  owner_name = COALESCE(NULLIF(trim(owner_name), ''), 'Propietario'),
  email = COALESCE(email, ''),
  business_type = COALESCE(business_type, 'otro'::public.business_type)
WHERE
  business_name IS NULL OR trim(business_name) = '' OR
  owner_name IS NULL OR trim(owner_name) = '' OR
  email IS NULL OR
  business_type IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN business_name SET DEFAULT 'Mi Negocio',
  ALTER COLUMN owner_name SET DEFAULT 'Propietario',
  ALTER COLUMN email SET DEFAULT '',
  ALTER COLUMN business_type SET DEFAULT 'otro';

ALTER TABLE public.profiles
  ALTER COLUMN business_name SET NOT NULL,
  ALTER COLUMN owner_name SET NOT NULL,
  ALTER COLUMN email SET NOT NULL,
  ALTER COLUMN business_type SET NOT NULL;

-- 2) Slug helpers.
CREATE OR REPLACE FUNCTION public.generate_unique_slug(base_slug TEXT)
RETURNS TEXT AS $$
DECLARE
  new_slug TEXT := base_slug;
  counter INTEGER := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE slug = new_slug) LOOP
    new_slug := base_slug || '-' || counter;
    counter := counter + 1;
  END LOOP;
  RETURN new_slug;
END;
$$ LANGUAGE plpgsql;

-- 3) Deterministic trigger: no broad exception swallowing.
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

NOTIFY pgrst, 'reload schema';