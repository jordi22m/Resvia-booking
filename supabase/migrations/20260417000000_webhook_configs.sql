create extension if not exists pgcrypto;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION public.generate_webhook_secret()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  new_secret TEXT;
BEGIN
  LOOP
    new_secret := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.webhook_configs WHERE secret = new_secret);
  END LOOP;
  RETURN new_secret;
END;
$$;

CREATE TABLE IF NOT EXISTS public.webhook_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  webhook_url TEXT NOT NULL,
  selected_events TEXT[] DEFAULT '{}',
  secret TEXT NOT NULL UNIQUE DEFAULT public.generate_webhook_secret(),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_configs_user_id ON public.webhook_configs(user_id);

ALTER TABLE public.webhook_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own webhook configs" ON public.webhook_configs;
CREATE POLICY "Users can view their own webhook configs"
  ON public.webhook_configs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own webhook configs" ON public.webhook_configs;
CREATE POLICY "Users can insert their own webhook configs"
  ON public.webhook_configs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own webhook configs" ON public.webhook_configs;
CREATE POLICY "Users can update their own webhook configs"
  ON public.webhook_configs FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own webhook configs" ON public.webhook_configs;
CREATE POLICY "Users can delete their own webhook configs"
  ON public.webhook_configs FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_webhook_configs_updated_at ON public.webhook_configs;
CREATE TRIGGER update_webhook_configs_updated_at
  BEFORE UPDATE ON public.webhook_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.create_initial_webhook_config()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.webhook_configs (user_id, webhook_url, selected_events, secret)
  VALUES (
    NEW.id,
    '',
    ARRAY['booking.created', 'booking.canceled'],
    generate_webhook_secret()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_webhook_config ON auth.users;
CREATE TRIGGER on_auth_user_created_webhook_config
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_initial_webhook_config();