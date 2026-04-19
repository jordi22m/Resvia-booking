-- EMERGENCY FIX: Allow anonymous access to profiles for booking
-- Execute this in Supabase SQL Editor: https://supabase.com/dashboard/project/uucqabcpsubodgldloqa/sql

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Public can view profiles by slug" ON public.profiles;
DROP POLICY IF EXISTS "Emergency public access" ON public.profiles;

-- Create emergency policy allowing anonymous SELECT
CREATE POLICY "Emergency public access" ON public.profiles FOR SELECT
  USING (true);

-- Test query
SELECT id, user_id, slug, business_name
FROM public.profiles
WHERE slug = 'mi-negocio';