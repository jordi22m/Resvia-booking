-- =============================================================================
-- Fix webhook secret generation for environments with schema drift
-- Prevents: null value in column "secret" of relation "webhook_configs"
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_webhook_secret()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_secret TEXT;
BEGIN
  LOOP
    new_secret := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.webhook_configs
      WHERE secret = new_secret
    );
  END LOOP;

  RETURN new_secret;
END;
$$;

ALTER TABLE public.webhook_configs
  ALTER COLUMN secret SET DEFAULT public.generate_webhook_secret();

UPDATE public.webhook_configs
SET secret = public.generate_webhook_secret()
WHERE secret IS NULL OR btrim(secret) = '';

ALTER TABLE public.webhook_configs
  ALTER COLUMN secret SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'webhook_configs_secret_unique_idx'
  ) THEN
    CREATE UNIQUE INDEX webhook_configs_secret_unique_idx
      ON public.webhook_configs(secret);
  END IF;
END
$$;
