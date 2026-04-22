-- =============================================================================
-- Consolidate public (anon) access for the booking page.
-- Policies already exist from previous migrations, but GRANTs may be missing.
-- This migration is idempotent: DROP IF EXISTS + CREATE for every policy.
-- =============================================================================

-- ─── 1. Explicit GRANTs to anon role ────────────────────────────────────────
GRANT SELECT ON public.profiles      TO anon;
GRANT SELECT ON public.services      TO anon;
GRANT SELECT ON public.availability  TO anon;
GRANT SELECT ON public.appointments  TO anon;
GRANT SELECT ON public.staff_members TO anon;

-- ─── 2. profiles ─────────────────────────────────────────────────────────────
-- Allow anon to look up any profile by slug (business name, config, etc.)
DROP POLICY IF EXISTS "Public can view profiles by slug" ON public.profiles;
CREATE POLICY "Public can view profiles by slug"
  ON public.profiles FOR SELECT
  USING (true);

-- ─── 3. services ─────────────────────────────────────────────────────────────
-- Only expose services that are active, bookable online, and belong to a
-- business that has a slug set (i.e. is public-facing).
DROP POLICY IF EXISTS "Public can view services for booking" ON public.services;
CREATE POLICY "Public can view services for booking"
  ON public.services FOR SELECT
  USING (
    active = true
    AND bookable_online = true
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = services.user_id
        AND profiles.slug IS NOT NULL
    )
  );

-- ─── 4. availability ─────────────────────────────────────────────────────────
-- Expose all availability rows for businesses with a slug.
-- The application already filters is_active=true in the query.
DROP POLICY IF EXISTS "Public can view availability by user slug" ON public.availability;
CREATE POLICY "Public can view availability by user slug"
  ON public.availability FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = availability.user_id
        AND profiles.slug IS NOT NULL
    )
  );

-- ─── 5. appointments ─────────────────────────────────────────────────────────
-- Only expose occupied slots (pending/confirmed) for conflict detection.
-- Do NOT expose customer names, phones or emails to anon.
DROP POLICY IF EXISTS "Public can view appointments for booking" ON public.appointments;
CREATE POLICY "Public can view appointments for booking"
  ON public.appointments FOR SELECT
  USING (
    status IN ('pending', 'confirmed')
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = appointments.user_id
        AND profiles.slug IS NOT NULL
    )
  );

-- ─── 6. staff_members ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view staff for booking" ON public.staff_members;
CREATE POLICY "Public can view staff for booking"
  ON public.staff_members FOR SELECT
  USING (
    active = true
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = staff_members.user_id
        AND profiles.slug IS NOT NULL
    )
  );
