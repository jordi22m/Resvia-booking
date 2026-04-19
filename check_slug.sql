-- Check if slug 'mi-negocio' exists in profiles table
SELECT id, user_id, slug, business_name, active
FROM public.profiles
WHERE slug = 'mi-negocio';

-- Check for duplicate slugs
SELECT slug, COUNT(*) as count
FROM public.profiles
WHERE slug IS NOT NULL
GROUP BY slug
HAVING COUNT(*) > 1;

-- List all profiles with slugs
SELECT id, user_id, slug, business_name, active
FROM public.profiles
WHERE slug IS NOT NULL
ORDER BY slug;