-- Allow public/anonymous users to view appointments for booking
DROP POLICY IF EXISTS "Public can view appointments for booking" ON public.appointments;
CREATE POLICY "Public can view appointments for booking" ON public.appointments FOR SELECT
  USING (
    status IN ('pending', 'confirmed')
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = appointments.user_id
      AND profiles.slug IS NOT NULL
    )
  );