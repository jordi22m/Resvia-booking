-- =============================================================================
-- Emergency fix: never block auth signup if profile creation fails
-- =============================================================================

-- Remove any trigger on auth.users that calls public.handle_new_user,
-- even if the trigger name differs across environments.
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
      AND pg_get_triggerdef(t.oid) ILIKE '%EXECUTE FUNCTION public.handle_new_user%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON auth.users', r.tgname);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  business_name_val TEXT;
  owner_name_val TEXT;
  email_val TEXT;
BEGIN
  -- Never let profile creation crash auth signup.
  BEGIN
    IF to_regclass('public.profiles') IS NULL THEN
      RETURN NEW;
    END IF;

    business_name_val := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'business_name', '')), '');
    owner_name_val := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'owner_name', '')), '');
    email_val := COALESCE(NEW.email, '');

    IF business_name_val IS NULL THEN business_name_val := 'Mi Negocio'; END IF;
    IF owner_name_val IS NULL THEN owner_name_val := 'Propietario'; END IF;

    INSERT INTO public.profiles (
      user_id,
      business_name,
      owner_name,
      email
    )
    VALUES (
      NEW.id,
      business_name_val,
      owner_name_val,
      email_val
    )
    ON CONFLICT (user_id) DO UPDATE SET
      business_name = EXCLUDED.business_name,
      owner_name = EXCLUDED.owner_name,
      email = EXCLUDED.email,
      updated_at = now();

  EXCEPTION WHEN OTHERS THEN
    -- Swallow all errors to keep signup successful.
    RETURN NEW;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

NOTIFY pgrst, 'reload schema';