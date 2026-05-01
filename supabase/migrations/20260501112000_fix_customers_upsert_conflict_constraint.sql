-- =============================================================================
-- Fix customers upsert conflict target
-- - Replace partial unique index with a real unique constraint
-- - Make ON CONFLICT (user_id, phone) valid for public customer upserts
-- =============================================================================

-- Normalize empty phones to NULL so the unique constraint can be created safely.
UPDATE public.customers
SET phone = NULL
WHERE phone IS NOT NULL
  AND btrim(phone) = '';

-- Drop the partial index used by the first version of the migration.
DROP INDEX IF EXISTS public.uq_customers_user_phone_non_empty;

-- Add a real unique constraint that PostgreSQL can use in ON CONFLICT (user_id, phone).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_customers_user_phone'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
    ADD CONSTRAINT uq_customers_user_phone UNIQUE (user_id, phone);
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';