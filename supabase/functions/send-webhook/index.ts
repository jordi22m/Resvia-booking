// @ts-nocheck
import { dispatchPendingWebhookEvents } from '../_shared/http-dispatcher.ts';
import { corsHeaders, createServiceRoleClient, jsonResponse } from '../_shared/webhook-helpers.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createServiceRoleClient();
    const url = new URL(req.url);
    const reqBody = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const limit = Number(reqBody.limit ?? url.searchParams.get('limit') ?? '20');
    const eventId = reqBody.event_id ?? url.searchParams.get('event_id') ?? null;
    const retryBaseSeconds = Number(Deno.env.get('WEBHOOK_RETRY_BASE_SECONDS') ?? '30');
    const globalMaxAttempts = Number(Deno.env.get('WEBHOOK_MAX_ATTEMPTS') ?? '5');

    console.info('[send-webhook] start', { limit, eventId, retryBaseSeconds, globalMaxAttempts });

    const result = await dispatchPendingWebhookEvents(supabase, {
      limit,
      eventId,
      retryBaseSeconds,
      globalMaxAttempts,
    });

    return jsonResponse(result);
  } catch (err: any) {
    console.error('send-webhook error:', err);
    return jsonResponse({ error: err.message }, 500);
  }
});
