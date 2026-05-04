// @ts-nocheck
import { withEventMetadata } from './webhook-helpers.ts';

function computeNextRetryAt(retryBaseSeconds: number, attempts: number) {
  const delaySeconds = retryBaseSeconds * Math.pow(2, Math.max(0, attempts - 1));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

export async function dispatchWebhookEvent(
  supabase: any,
  event: any,
  options: { retryBaseSeconds?: number; globalMaxAttempts?: number } = {},
) {
  const nowIso = new Date().toISOString();
  const retryBaseSeconds = Number(options.retryBaseSeconds ?? Deno.env.get('WEBHOOK_RETRY_BASE_SECONDS') ?? '30');
  const globalMaxAttempts = Number(options.globalMaxAttempts ?? Deno.env.get('WEBHOOK_MAX_ATTEMPTS') ?? '5');
  const currentAttempts = Number(event.attempt_count ?? event.attempts ?? 0);
  const nextAttempts = currentAttempts + 1;
  const maxAttempts = Math.max(1, Number(event.max_attempts ?? globalMaxAttempts));
  const config = event.webhook_configs;

  if (event.status === 'failed' && event.next_retry_at && Date.parse(event.next_retry_at) > Date.now()) {
    return { id: event.id, status: 'skipped', reason: 'retry_not_due' };
  }

  if (currentAttempts >= maxAttempts) {
    return { id: event.id, status: 'failed', reason: 'max_attempts_reached' };
  }

  if (!config?.webhook_url) {
    await supabase
      .from('webhook_events')
      .update({
        status: 'failed',
        delivery_status: 'failed',
        attempt_count: nextAttempts,
        attempts: nextAttempts,
        processed_at: nextAttempts >= maxAttempts ? nowIso : null,
        last_attempt_at: nowIso,
        next_retry_at: computeNextRetryAt(retryBaseSeconds, nextAttempts),
        last_error: 'No webhook URL configured',
      })
      .eq('id', event.id);

    return { id: event.id, status: 'failed', reason: 'no_webhook_url' };
  }

  try {
    const response = await fetch(config.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': config.secret ?? '',
        'x-webhook-event': event.event_type,
        'x-resvia-event-id': event.id,
      },
      body: JSON.stringify(withEventMetadata(event.event_type, event.payload)),
    });

    const responseText = await response.text();

    if (response.ok) {
      await supabase
        .from('webhook_events')
        .update({
          status: 'sent',
          delivery_status: 'sent',
          attempt_count: nextAttempts,
          attempts: nextAttempts,
          sent_at: nowIso,
          processed_at: nowIso,
          last_attempt_at: nowIso,
          next_retry_at: null,
          response_status: response.status,
          response_body: responseText.slice(0, 4096),
          last_error: null,
        })
        .eq('id', event.id);

      return { id: event.id, status: 'sent', responseStatus: response.status };
    }

    const reachedMaxAttempts = nextAttempts >= maxAttempts;
    await supabase
      .from('webhook_events')
      .update({
        status: 'failed',
        delivery_status: 'failed',
        attempt_count: nextAttempts,
        attempts: nextAttempts,
        processed_at: reachedMaxAttempts ? nowIso : null,
        last_attempt_at: nowIso,
        next_retry_at: reachedMaxAttempts ? null : computeNextRetryAt(retryBaseSeconds, nextAttempts),
        response_status: response.status,
        response_body: responseText.slice(0, 4096),
        last_error: `HTTP ${response.status}: ${responseText}`.slice(0, 1024),
      })
      .eq('id', event.id);

    return { id: event.id, status: 'failed', reason: `http_${response.status}` };
  } catch (error) {
    const reachedMaxAttempts = nextAttempts >= maxAttempts;
    const message = error instanceof Error ? error.message : String(error);

    await supabase
      .from('webhook_events')
      .update({
        status: 'failed',
        delivery_status: 'failed',
        attempt_count: nextAttempts,
        attempts: nextAttempts,
        processed_at: reachedMaxAttempts ? nowIso : null,
        last_attempt_at: nowIso,
        next_retry_at: reachedMaxAttempts ? null : computeNextRetryAt(retryBaseSeconds, nextAttempts),
        last_error: message.slice(0, 1024),
      })
      .eq('id', event.id);

    return { id: event.id, status: 'failed', reason: message };
  }
}

export async function dispatchPendingWebhookEvents(
  supabase: any,
  options: {
    eventId?: string | null;
    eventTypes?: string[];
    limit?: number;
    retryBaseSeconds?: number;
    globalMaxAttempts?: number;
  } = {},
) {
  const limit = Number(options.limit ?? 20);

  let query = supabase
    .from('webhook_events')
    .select('id, event_type, payload, status, delivery_status, attempt_count, attempts, max_attempts, next_retry_at, sent_at, config_id, webhook_configs(webhook_url, secret, active)')
    .in('status', ['pending', 'failed'])
    .order('created_at', { ascending: true })
    .limit(limit);

  if (options.eventId) {
    query = query.eq('id', options.eventId);
  }

  if (Array.isArray(options.eventTypes) && options.eventTypes.length > 0) {
    query = query.in('event_type', options.eventTypes);
  }

  const { data: events, error } = await query;
  if (error) throw error;

  if (!events?.length) {
    return { processed: 0, results: [] };
  }

  const results = [];
  for (const event of events) {
    const result = await dispatchWebhookEvent(supabase, event, options);
    results.push(result);
  }

  return {
    processed: events.length,
    results,
  };
}
