-- Configuracion de reservas por negocio y por servicio (idempotente)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS min_gap_minutes integer DEFAULT 0;

UPDATE public.profiles
SET min_gap_minutes = 0
WHERE min_gap_minutes IS NULL;

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS interval_minutes integer;
