-- Debug: Temporarily disable RLS on profiles to test
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;

-- Test query (should work now)
SELECT id, user_id, slug, business_name FROM public.profiles WHERE slug = 'mi-negocio';

-- Re-enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;