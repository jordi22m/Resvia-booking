// @ts-nocheck
import { dispatchWebhookEvent } from './http-dispatcher.ts';
import { extractEventRefs, getBusinessProfileByUserId, withEventMetadata } from './webhook-helpers.ts';

export async function emitWebhookEvent(
  supabase: any,
  options: {
    userId: string;
    eventType: string;
    payload: Record<string, unknown>;
    businessId?: string | null;
    appointmentId?: string | null;
    customerId?: string | null;
    dispatchImmediately?: boolean;
  },
) {
  const {
    userId,
    eventType,
    payload,
    businessId,
    appointmentId,
    customerId,
    dispatchImmediately = true,
  } = options;

  const { data: config, error: configError } = await supabase
    .from('webhook_configs')
    .select('id, user_id, webhook_url, secret, active, selected_events')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle();

  if (configError) throw configError;

  if (!config || !(config.selected_events ?? []).includes(eventType)) {
    return {
      status: 'skipped',
      reason: 'no_active_config_or_event_not_selected',
    };
  }

  const refs = extractEventRefs(payload);
  let resolvedBusinessId = businessId ?? refs.businessId ?? null;

  if (!resolvedBusinessId) {
    const profile = await getBusinessProfileByUserId(supabase, userId).catch(() => null);
    resolvedBusinessId = profile?.id ?? null;
  }

  const eventPayload = withEventMetadata(eventType, payload);
  const insertPayload = {
    user_id: userId,
    business_id: resolvedBusinessId,
    config_id: config.id,
    appointment_id: appointmentId ?? refs.appointmentId ?? null,
    customer_id: customerId ?? refs.customerId ?? null,
    event_type: eventType,
    event_name: eventType,
    payload: eventPayload,
    status: 'pending',
    delivery_status: 'pending',
    attempt_count: 0,
    attempts: 0,
    next_retry_at: new Date().toISOString(),
  };

  const { data: eventRow, error: insertError } = await supabase
    .from('webhook_events')
    .insert(insertPayload)
    .select('id, event_type, payload, status, delivery_status, attempt_count, attempts, max_attempts, next_retry_at, sent_at, webhook_configs(webhook_url, secret, active)')
    .single();

  if (insertError) throw insertError;

  if (!dispatchImmediately) {
    return {
      status: 'queued',
      eventId: eventRow.id,
    };
  }

  const dispatchResult = await dispatchWebhookEvent(supabase, eventRow);
  return {
    status: 'queued_and_dispatched',
    eventId: eventRow.id,
    dispatch: dispatchResult,
  };
}
