-- =============================================================================
-- Fix: allow appointment owners to use booking_tokens under RLS
-- Root cause: booking_tokens had RLS enabled without policies
-- =============================================================================

ALTER TABLE public.booking_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own booking tokens" ON public.booking_tokens;
CREATE POLICY "Users can view their own booking tokens"
  ON public.booking_tokens
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.appointments a
      WHERE a.id = booking_tokens.appointment_id
        AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert their own booking tokens" ON public.booking_tokens;
CREATE POLICY "Users can insert their own booking tokens"
  ON public.booking_tokens
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.appointments a
      WHERE a.id = booking_tokens.appointment_id
        AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own booking tokens" ON public.booking_tokens;
CREATE POLICY "Users can update their own booking tokens"
  ON public.booking_tokens
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.appointments a
      WHERE a.id = booking_tokens.appointment_id
        AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.appointments a
      WHERE a.id = booking_tokens.appointment_id
        AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete their own booking tokens" ON public.booking_tokens;
CREATE POLICY "Users can delete their own booking tokens"
  ON public.booking_tokens
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.appointments a
      WHERE a.id = booking_tokens.appointment_id
        AND a.user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';