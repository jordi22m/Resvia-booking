-- =============================================================================
-- Add explicit public-visibility flag for services shown on booking page
-- show_in_booking controls catalog visibility only (not internal operability)
-- =============================================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS show_in_booking BOOLEAN NOT NULL DEFAULT true;

UPDATE public.services
SET show_in_booking = true
WHERE show_in_booking IS NULL;

-- Remove legacy broad public policy if present in older environments.
DROP POLICY IF EXISTS "Public can view services by user slug" ON public.services;

-- Recreate current booking policy including explicit visibility flag.
DROP POLICY IF EXISTS "Public can view services for booking" ON public.services;
CREATE POLICY "Public can view services for booking"
  ON public.services FOR SELECT
  USING (
    COALESCE(active, true) = true
    AND COALESCE(bookable_online, true) = true
    AND COALESCE(show_in_booking, true) = true
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = services.user_id
        AND profiles.slug IS NOT NULL
    )
  );

NOTIFY pgrst, 'reload schema';
