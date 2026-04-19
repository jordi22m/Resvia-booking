-- Create test profile if slug 'mi-negocio' doesn't exist
-- Replace 'your-user-id-here' with your actual user ID from auth.users

DO $$
DECLARE
    user_exists BOOLEAN;
    profile_exists BOOLEAN;
BEGIN
    -- Check if user exists (you need to replace with your actual user ID)
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = 'your-user-id-here') INTO user_exists;

    IF user_exists THEN
        -- Check if profile with slug already exists
        SELECT EXISTS(SELECT 1 FROM public.profiles WHERE slug = 'mi-negocio') INTO profile_exists;

        IF NOT profile_exists THEN
            INSERT INTO public.profiles (user_id, business_name, slug, active)
            VALUES ('your-user-id-here', 'Mi Negocio de Prueba', 'mi-negocio', true);

            RAISE NOTICE 'Profile created successfully with slug: mi-negocio';
        ELSE
            RAISE NOTICE 'Profile with slug mi-negocio already exists';
        END IF;
    ELSE
        RAISE NOTICE 'User ID does not exist. Please replace with your actual user ID';
    END IF;
END $$;

-- Verify the profile was created
SELECT id, user_id, slug, business_name, active
FROM public.profiles
WHERE slug = 'mi-negocio';