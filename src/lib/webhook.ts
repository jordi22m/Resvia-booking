import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import type { Json } from '@/integrations/supabase/types';

export interface WebhookEvent {
  event: string;
  user_id: string;
  payload: Record<string, Json>;
}

export const CANONICAL_WEBHOOK_EVENTS = [
  'booking.created',
  'booking.confirmed',
  'booking.cancelled',
  'booking.rescheduled',
  'booking.completed',
  'customer.created',
  'reminder.24h',
  'reminder.2h',
] as const;

export type CanonicalWebhookEvent = (typeof CANONICAL_WEBHOOK_EVENTS)[number];

export interface BookingWebhookContext {
  event: CanonicalWebhookEvent;
  business: {
    id?: string;
    name: string;
    slug?: string;
  };
  appointment: {
    id?: string;
    public_id?: string | null;
    status?: string | null;
    date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
  };
  customer?: {
    id?: string | null;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  service?: {
    id?: string | null;
    name?: string | null;
    duration?: number | null;
    price?: number | null;
  };
  timezone?: string | null;
  booking_url?: string | null;
  cancel_url?: string | null;
  reschedule_url?: string | null;
}

export function buildWebhookPayload(ctx: BookingWebhookContext): Record<string, Json> {
  return {
    event: ctx.event,
    timestamp: new Date().toISOString(),
    business: {
      id: ctx.business.id ?? null,
      name: ctx.business.name,
      slug: ctx.business.slug ?? null,
    },
    appointment: {
      id: ctx.appointment.id ?? null,
      public_id: ctx.appointment.public_id ?? null,
      status: ctx.appointment.status ?? null,
      date: ctx.appointment.date ?? null,
      start_time: ctx.appointment.start_time ?? null,
      end_time: ctx.appointment.end_time ?? null,
    },
    customer: {
      id: ctx.customer?.id ?? null,
      name: ctx.customer?.name ?? null,
      phone: ctx.customer?.phone ?? null,
      email: ctx.customer?.email ?? null,
    },
    service: {
      id: ctx.service?.id ?? null,
      name: ctx.service?.name ?? null,
      duration: ctx.service?.duration ?? null,
      price: ctx.service?.price ?? null,
    },
    datetime: {
      date: ctx.appointment.date ?? null,
      start_time: ctx.appointment.start_time ?? null,
      end_time: ctx.appointment.end_time ?? null,
      timezone: ctx.timezone ?? null,
    },
    timezone: ctx.timezone ?? null,
    booking_url: ctx.booking_url ?? null,
    cancel_url: ctx.cancel_url ?? null,
    reschedule_url: ctx.reschedule_url ?? null,
  };
}

export async function triggerWebhook(
  event: string,
  payload: Record<string, Json>,
  userId: string,
  _session?: Session | null
): Promise<void> {
  const correlationId = crypto.randomUUID();
  const eventPayload: Record<string, Json> = {
    ...payload,
    _meta: {
      correlation_id: correlationId,
      created_at: new Date().toISOString(),
      source: 'triggerWebhook',
    },
  };

  try {
    console.info('[webhook] enqueue:start', { event, userId, correlationId });

    const { error } = await supabase.rpc('enqueue_webhook_event', {
      p_user_id: userId,
      p_event_type: event,
      p_payload: eventPayload,
    });

    if (error) {
      console.error('[webhook] enqueue:rpc_failed', {
        event,
        userId,
        correlationId,
        error,
      });

      // Fallback: insert directly in queue so event is not lost.
      const { data: cfg, error: cfgError } = await supabase
        .from('webhook_configs')
        .select('id, selected_events, active')
        .eq('user_id', userId)
        .eq('active', true)
        .maybeSingle();

      if (cfgError) {
        console.error('[webhook] enqueue:fallback_config_failed', {
          event,
          userId,
          correlationId,
          error: cfgError,
        });
        return;
      }

      if (!cfg || !(cfg.selected_events || []).includes(event)) {
        console.warn('[webhook] enqueue:skipped_no_active_config_or_event', {
          event,
          userId,
          correlationId,
        });
        return;
      }

      const { error: insertError } = await supabase.from('webhook_events').insert({
        user_id: userId,
        config_id: cfg.id,
        event_type: event,
        payload: eventPayload,
        status: 'pending',
        last_error: `enqueue_webhook_event failed: ${error.message}`.slice(0, 1024),
      });

      if (insertError) {
        console.error('[webhook] enqueue:fallback_insert_failed', {
          event,
          userId,
          correlationId,
          error: insertError,
        });
      } else {
        console.info('[webhook] enqueue:fallback_insert_ok', { event, userId, correlationId });
      }
    } else {
      console.info('[webhook] enqueue:ok', { event, userId, correlationId });
      // Dispatch is handled server-side via pg_cron (every minute).
      // No browser-side invoke to avoid CORS/auth issues.
    }
  } catch (error) {
    console.error('[webhook] trigger:unexpected_error', { event, userId, correlationId, error });
  }
}