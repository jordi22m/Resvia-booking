-- Force reset all booking access policies

-- First, drop ALL existing policies on affected tables
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Public can view profiles by slug" ON public.profiles;

DROP POLICY IF EXISTS "Users can view their own services" ON public.services;
DROP POLICY IF EXISTS "Users can insert their own services" ON public.services;
DROP POLICY IF EXISTS "Users can update their own services" ON public.services;
DROP POLICY IF EXISTS "Users can delete their own services" ON public.services;
DROP POLICY IF EXISTS "Public can view services by user slug" ON public.services;
DROP POLICY IF EXISTS "Public can view services for booking" ON public.services;

DROP POLICY IF EXISTS "Users can view their own staff" ON public.staff_members;
DROP POLICY IF EXISTS "Users can insert their own staff" ON public.staff_members;
DROP POLICY IF EXISTS "Users can update their own staff" ON public.staff_members;
DROP POLICY IF EXISTS "Users can delete their own staff" ON public.staff_members;
DROP POLICY IF EXISTS "Public can view staff by user slug" ON public.staff_members;
DROP POLICY IF EXISTS "Public can view staff for booking" ON public.staff_members;

DROP POLICY IF EXISTS "Users can view their own customers" ON public.customers;
DROP POLICY IF EXISTS "Users can insert their own customers" ON public.customers;
DROP POLICY IF EXISTS "Users can update their own customers" ON public.customers;
DROP POLICY IF EXISTS "Users can delete their own customers" ON public.customers;
DROP POLICY IF EXISTS "Public can insert customers for booking" ON public.customers;

DROP POLICY IF EXISTS "Users can view their own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Users can insert their own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Users can update their own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Users can delete their own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Public can insert appointments for booking" ON public.appointments;

-- Now recreate all policies

-- Profiles policies
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Public can view profiles by slug" ON public.profiles FOR SELECT USING (true);

-- Services policies
CREATE POLICY "Users can view their own services" ON public.services FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own services" ON public.services FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own services" ON public.services FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own services" ON public.services FOR DELETE USING (auth.uid() = user_id);
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

-- Staff policies
CREATE POLICY "Users can view their own staff" ON public.staff_members FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own staff" ON public.staff_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own staff" ON public.staff_members FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own staff" ON public.staff_members FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Public can view staff for booking" ON public.staff_members FOR SELECT
  USING (
    active = true
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = staff_members.user_id
      AND profiles.slug IS NOT NULL
    )
  );

-- Customers policies
CREATE POLICY "Users can view their own customers" ON public.customers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own customers" ON public.customers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own customers" ON public.customers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own customers" ON public.customers FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Public can insert customers for booking" ON public.customers FOR INSERT WITH CHECK (true);

-- Appointments policies
CREATE POLICY "Users can view their own appointments" ON public.appointments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own appointments" ON public.appointments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own appointments" ON public.appointments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own appointments" ON public.appointments FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Public can insert appointments for booking" ON public.appointments FOR INSERT WITH CHECK (true);