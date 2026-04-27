-- =============================================================================
-- Fix Supabase Auth signup 500 errors caused by profile trigger failures
-- =============================================================================

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
  business_name_val := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'business_name', '')), '');
  owner_name_val := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'owner_name', '')), '');
  email_val := COALESCE(NEW.email, '');
  business_type_val := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'business_type', '')), '');

  IF business_name_val IS NULL THEN business_name_val := 'Mi Negocio'; END IF;
  IF owner_name_val IS NULL THEN owner_name_val := 'Propietario'; END IF;

  IF business_type_val IS NULL OR business_type_val NOT IN (
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

  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    -- Fail-safe to avoid blocking signup if metadata is malformed.
    INSERT INTO public.profiles (
      user_id,
      business_name,
      business_type,
      slug,
      owner_name,
      email
    )
    VALUES (
      NEW.id,
      'Mi Negocio',
      'otro',
      'negocio-' || substr(NEW.id::text, 1, 8),
      'Propietario',
      email_val
    )
    ON CONFLICT (user_id) DO NOTHING;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

NOTIFY pgrst, 'reload schema';