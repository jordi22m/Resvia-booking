// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('PROJECT_URL');
    const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('PROJECT_URL or SERVICE_ROLE_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const url = new URL(req.url);
    const reqBody = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const limit = Number(reqBody.limit ?? url.searchParams.get('limit') ?? '20');
    const eventId = reqBody.event_id ?? url.searchParams.get('event_id') ?? null;
    const retryBaseSeconds = Number(Deno.env.get('WEBHOOK_RETRY_BASE_SECONDS') ?? '30');
    const globalMaxAttempts = Number(Deno.env.get('WEBHOOK_MAX_ATTEMPTS') ?? '5');
    const nowIso = new Date().toISOString();

    console.info('[send-webhook] start', { limit, eventId, retryBaseSeconds, globalMaxAttempts });

    let eventsQuery = supabase
      .from('webhook_events')
      .select('id, event_type, payload, status, attempt_count, max_attempts, next_retry_at, config_id, webhook_configs(webhook_url, secret)')
      .in('status', ['pending', 'failed'])
      .order('created_at', { ascending: true })
      .limit(limit);

    if (eventId) {
      eventsQuery = eventsQuery.eq('id', eventId);
    }

    const { data: events, error } = await eventsQuery;

    if (error) throw error;
    if (!events?.length) {
      return new Response(JSON.stringify({ processed: 0, message: 'No pending webhook events' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = [];

    for (const event of events) {
      const maxAttempts = Math.max(1, event.max_attempts ?? globalMaxAttempts);
      const attempts = event.attempt_count ?? 0;
      const retryDelaySeconds = retryBaseSeconds * Math.pow(2, Math.max(0, attempts - 1));
      const retryReadyAt = event.next_retry_at
        ? Date.parse(event.next_retry_at)
        : Date.parse(nowIso);

      if (event.status === 'failed') {
        if (attempts >= maxAttempts) {
          results.push({ id: event.id, status: 'failed', reason: 'max_attempts_reached' });
          continue;
        }

        if (Number.isFinite(retryReadyAt) && retryReadyAt > Date.now()) {
          results.push({ id: event.id, status: 'skipped', reason: 'retry_not_due' });
          continue;
        }
      }

      const config = event.webhook_configs;
      if (!config?.webhook_url) {
        await supabase.from('webhook_events').update({
          status: 'failed',
          attempt_count: attempts + 1,
          last_attempt_at: nowIso,
          next_retry_at: new Date(Date.now() + retryDelaySeconds * 1000).toISOString(),
          last_error: 'No webhook URL configured',
        }).eq('id', event.id);

        results.push({ id: event.id, status: 'failed', reason: 'No webhook URL configured' });
        continue;
      }

      try {
        const response = await fetch(config.webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-secret': config.secret,
          },
          body: JSON.stringify({
            event: event.event_type,
            timestamp: new Date().toISOString(),
            data: event.payload,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          await supabase.from('webhook_events').update({
            status: 'failed',
            attempt_count: attempts + 1,
            last_attempt_at: nowIso,
            response_status: response.status,
            response_body: text.substring(0, 4096),
            next_retry_at: new Date(Date.now() + retryDelaySeconds * 1000).toISOString(),
            last_error: `HTTP ${response.status}: ${text}`.substring(0, 1024),
          }).eq('id', event.id);
          results.push({ id: event.id, status: 'failed', reason: `HTTP ${response.status}` });
          continue;
        }

        const text = await response.text();
        await supabase.from('webhook_events').update({
          status: 'sent',
          attempt_count: attempts + 1,
          last_attempt_at: nowIso,
          response_status: response.status,
          response_body: text.substring(0, 4096),
          next_retry_at: null,
          sent_at: new Date().toISOString(),
          last_error: null,
        }).eq('id', event.id);
        results.push({ id: event.id, status: 'sent' });
      } catch (err: any) {
        await supabase.from('webhook_events').update({
          status: 'failed',
          attempt_count: attempts + 1,
          last_attempt_at: nowIso,
          next_retry_at: new Date(Date.now() + retryDelaySeconds * 1000).toISOString(),
          last_error: `${err.message}`.substring(0, 1024),
        }).eq('id', event.id);
        results.push({ id: event.id, status: 'failed', reason: err.message });
      }
    }

    return new Response(JSON.stringify({ processed: events.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('send-webhook error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
