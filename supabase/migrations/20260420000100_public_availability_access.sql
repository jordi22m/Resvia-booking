DROP POLICY IF EXISTS "Public can view availability by user slug" ON public.availability;

CREATE POLICY "Public can view availability by user slug"
ON public.availability FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE profiles.user_id = availability.user_id
      AND profiles.slug IS NOT NULL
  )
);