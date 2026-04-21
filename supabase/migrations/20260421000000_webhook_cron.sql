-- Enable required extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Schedule send-webhook Edge Function every minute
select cron.schedule(
  'process-webhook-queue',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/send-webhook',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body    := '{"limit":20}'::jsonb
  );
  $$
);
