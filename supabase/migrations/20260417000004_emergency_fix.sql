-- Emergency fix: Allow anonymous access to profiles for booking
-- This overrides all other policies for SELECT operations

DROP POLICY IF EXISTS "Emergency public access" ON public.profiles;
CREATE POLICY "Emergency public access" ON public.profiles FOR SELECT
  USING (true);

-- Test the policy
SELECT id, user_id, slug, business_name
FROM public.profiles
WHERE slug = 'mi-negocio';