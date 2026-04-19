-- Script para verificar y restaurar datos después de logout accidental
-- Ejecuta esto en Supabase SQL Editor: https://supabase.com/dashboard/project/uucqabcpsubodgldloqa/sql

-- 1. PRIMERO: Reemplaza 'YOUR_USER_ID_HERE' con tu ID de usuario real
-- Para encontrar tu user_id, ejecuta: SELECT id, email FROM auth.users WHERE email = 'tu-email@gmail.com';

-- 2. Verificar si tus datos existen
SELECT
  (SELECT COUNT(*) FROM public.profiles WHERE user_id = 'YOUR_USER_ID_HERE') as profiles_count,
  (SELECT COUNT(*) FROM public.services WHERE user_id = 'YOUR_USER_ID_HERE') as services_count,
  (SELECT COUNT(*) FROM public.staff_members WHERE user_id = 'YOUR_USER_ID_HERE') as staff_count,
  (SELECT COUNT(*) FROM public.customers WHERE user_id = 'YOUR_USER_ID_HERE') as customers_count,
  (SELECT COUNT(*) FROM public.appointments WHERE user_id = 'YOUR_USER_ID_HERE') as appointments_count;

-- 3. Si los datos no existen, recrea un perfil básico
-- (Descomenta y modifica los valores según necesites)

-- INSERT INTO public.profiles (user_id, business_name, owner_name, email, slug)
-- VALUES (
--   'YOUR_USER_ID_HERE',
--   'Mi Negocio',
--   'Tu Nombre',
--   'tu-email@gmail.com',
--   'mi-negocio'
-- ) ON CONFLICT (user_id) DO NOTHING;

-- 4. Verificar que el usuario existe en auth.users
SELECT id, email, created_at, last_sign_in_at
FROM auth.users
WHERE id = 'YOUR_USER_ID_HERE';