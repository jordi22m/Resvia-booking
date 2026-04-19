-- Función de recuperación de datos después de logout accidental
-- Ejecuta esto en Supabase SQL Editor si perdiste datos

-- PASO 1: Encuentra tu user_id
-- SELECT id, email FROM auth.users WHERE email = 'TU_EMAIL_AQUI';

-- PASO 2: Una vez que tengas tu user_id, reemplázalo en las consultas abajo

DO $$
DECLARE
    user_id_var UUID := 'YOUR_USER_ID_HERE'; -- ← REEMPLAZA CON TU USER ID REAL
    profile_exists BOOLEAN;
    services_count INTEGER;
BEGIN
    -- Verificar si el perfil existe
    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE user_id = user_id_var) INTO profile_exists;

    IF NOT profile_exists THEN
        -- Recrear perfil básico
        INSERT INTO public.profiles (user_id, business_name, owner_name, email, slug)
        VALUES (user_id_var, 'Mi Negocio Recuperado', 'Propietario', 'email@ejemplo.com', 'mi-negocio-recuperado');

        RAISE NOTICE 'Perfil recreado para usuario %', user_id_var;
    ELSE
        RAISE NOTICE 'El perfil ya existe para usuario %', user_id_var;
    END IF;

    -- Verificar servicios
    SELECT COUNT(*) INTO services_count FROM public.services WHERE user_id = user_id_var;

    IF services_count = 0 THEN
        -- Crear servicio de ejemplo
        INSERT INTO public.services (user_id, name, description, duration, price, active, bookable_online)
        VALUES
        (user_id_var, 'Corte de Pelo', 'Corte de pelo completo', 30, 25.00, true, true),
        (user_id_var, 'Lavado + Corte', 'Lavado y corte de pelo', 45, 35.00, true, true);

        RAISE NOTICE 'Servicios de ejemplo creados para usuario %', user_id_var;
    END IF;

    -- Verificar staff
    IF NOT EXISTS(SELECT 1 FROM public.staff_members WHERE user_id = user_id_var) THEN
        INSERT INTO public.staff_members (user_id, name, role, active)
        VALUES (user_id_var, 'Empleado Principal', 'Estilista', true);

        RAISE NOTICE 'Miembro del staff creado para usuario %', user_id_var;
    END IF;

    RAISE NOTICE 'Recuperación completada. Verifica tus datos en la aplicación.';
END $$;

-- Verificar resultado
SELECT
  p.business_name,
  COUNT(s.id) as services_count,
  COUNT(st.id) as staff_count,
  COUNT(c.id) as customers_count
FROM public.profiles p
LEFT JOIN public.services s ON s.user_id = p.user_id
LEFT JOIN public.staff_members st ON st.user_id = p.user_id
LEFT JOIN public.customers c ON c.user_id = p.user_id
WHERE p.user_id = 'YOUR_USER_ID_HERE' -- ← REEMPLAZA CON TU USER ID REAL
GROUP BY p.user_id, p.business_name;