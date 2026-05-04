// @ts-nocheck
import { dispatchPendingWebhookEvents } from '../_shared/http-dispatcher.ts';
import {
  corsHeaders,
  createServiceRoleClient,
  jsonResponse,
} from '../_shared/webhook-helpers.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createServiceRoleClient();
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const limit = Number(body.limit ?? url.searchParams.get('limit') ?? '100');
    const dispatchImmediately = body.dispatchImmediately ?? true;
    const reminderEventTypes = ['reminder.24h', 'reminder.2h'];

    const { error: enqueueError } = await supabase.rpc('enqueue_due_reminders');
    if (enqueueError) throw enqueueError;

    if (!dispatchImmediately) {
      return jsonResponse({
        status: 'queued',
        source: 'enqueue_due_reminders',
        eventTypes: reminderEventTypes,
      });
    }

    const dispatchResult = await dispatchPendingWebhookEvents(supabase, {
      limit,
      eventTypes: reminderEventTypes,
    });

    return jsonResponse({
      status: 'queued_and_dispatched',
      source: 'enqueue_due_reminders',
      eventTypes: reminderEventTypes,
      dispatch: dispatchResult,
    });
  } catch (error) {
    console.error('process-appointment-reminders error:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
