-- Resvia Booking - Post-reset fix
-- Run this after reset_and_setup.sql if you already executed the reset.
-- It is non-destructive: it does not delete tables or data.

INSERT INTO public.profiles (user_id, business_name, owner_name, email)
SELECT
  users.id,
  COALESCE(users.raw_user_meta_data->>'business_name', ''),
  COALESCE(users.raw_user_meta_data->>'owner_name', ''),
  COALESCE(users.email, '')
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

DROP POLICY IF EXISTS "Users can insert their own customers" ON public.customers;
CREATE POLICY "Users can insert their own customers"
  ON public.customers FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.user_id = customers.user_id
        AND profiles.slug IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Users can insert their own appointments" ON public.appointments;
CREATE POLICY "Users can insert their own appointments"
  ON public.appointments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.user_id = appointments.user_id
        AND profiles.slug IS NOT NULL
    )
  );
