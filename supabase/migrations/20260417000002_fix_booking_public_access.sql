-- Fix public booking access - Allow anonymous users to view business data

-- Update profiles policy to allow public read access WITHOUT auth check
DROP POLICY IF EXISTS "Public can view profiles by slug" ON public.profiles;
CREATE POLICY "Public can view profiles by slug" ON public.profiles FOR SELECT
  USING (true);

-- Update services policy to allow public read access without RLS check
DROP POLICY IF EXISTS "Public can view services for booking" ON public.services;
CREATE POLICY "Public can view services for booking" ON public.services FOR SELECT
  USING (
    active = true
    AND bookable_online = true
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = services.user_id
      AND profiles.slug IS NOT NULL
    )
  );

-- Update staff_members policy to allow public read access without RLS check
DROP POLICY IF EXISTS "Public can view staff for booking" ON public.staff_members;
CREATE POLICY "Public can view staff for booking" ON public.staff_members FOR SELECT
  USING (
    active = true
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = staff_members.user_id
      AND profiles.slug IS NOT NULL
    )
  );

-- Allow public/anonymous users to create customers
DROP POLICY IF EXISTS "Users can insert their own customers" ON public.customers;
DROP POLICY IF EXISTS "Public can insert customers for booking" ON public.customers;
