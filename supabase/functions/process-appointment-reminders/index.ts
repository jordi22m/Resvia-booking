// @ts-nocheck
import { emitWebhookEvent } from '../_shared/emitWebhookEvent.ts';
import {
  buildBookingUrls,
  corsHeaders,
  createServiceRoleClient,
  ensureBookingTokens,
  getBusinessProfileByUserId,
  getMinutesUntilAppointment,
  getReminderEventType,
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

    const { data: appointments, error: appointmentsError } = await supabase
      .from('appointments')
      .select('id, user_id, customer_id, service_id, staff_id, date, start_time, end_time, status, notes')
      .eq('status', 'confirmed')
      .gte('date', new Date().toISOString().slice(0, 10))
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(limit);

    if (appointmentsError) throw appointmentsError;

    const profileCache = new Map();
    const customerCache = new Map();
    const serviceCache = new Map();
    const staffCache = new Map();

    const summary = {
      scanned: appointments?.length ?? 0,
      enqueued: 0,
      skipped: 0,
      sent: 0,
      failed: 0,
      results: [],
    };

    for (const appointment of appointments ?? []) {
      const minutesUntil = getMinutesUntilAppointment(appointment.date, appointment.start_time);
      const reminderEventType = minutesUntil === null ? null : getReminderEventType(minutesUntil);

      if (!reminderEventType) {
        summary.skipped += 1;
        continue;
      }

      const reminderType = reminderEventType.replace('reminder.', '');
      const { data: existingReminder, error: reminderLookupError } = await supabase
        .from('appointment_reminders')
        .select('id')
        .eq('appointment_id', appointment.id)
        .eq('reminder_type', reminderType)
        .maybeSingle();

      if (reminderLookupError) throw reminderLookupError;
      if (existingReminder) {
        summary.skipped += 1;
        continue;
      }

      let business = profileCache.get(appointment.user_id);
      if (!business) {
        business = await getBusinessProfileByUserId(supabase, appointment.user_id);
        profileCache.set(appointment.user_id, business);
      }

      let customer = customerCache.get(appointment.customer_id);
      if (!customer) {
        const { data, error } = await supabase
          .from('customers')
          .select('id, name, phone, email')
          .eq('id', appointment.customer_id)
          .single();
        if (error) throw error;
        customer = data;
        customerCache.set(appointment.customer_id, customer);
      }

      let service = serviceCache.get(appointment.service_id);
      if (!service) {
        const { data, error } = await supabase
          .from('services')
          .select('id, name, duration, price')
          .eq('id', appointment.service_id)
          .single();
        if (error) throw error;
        service = data;
        serviceCache.set(appointment.service_id, service);
      }

      let staff = null;
      if (appointment.staff_id) {
        staff = staffCache.get(appointment.staff_id);
        if (!staff) {
          const { data, error } = await supabase
            .from('staff_members')
            .select('id, name, email, phone, role')
            .eq('id', appointment.staff_id)
            .single();
          if (error) throw error;
          staff = data;
          staffCache.set(appointment.staff_id, staff);
        }
      }

      const tokens = await ensureBookingTokens(supabase, appointment.id);
      const links = buildBookingUrls({
        slug: business.slug,
        cancelToken: tokens.cancelToken,
        rescheduleToken: tokens.rescheduleToken,
      });

      const payload = {
        business: {
          id: business.id,
          name: business.business_name,
          slug: business.slug,
          email: business.email,
          phone: business.phone,
          timezone: business.timezone,
        },
        booking: {
          id: appointment.id,
          status: appointment.status,
          date: appointment.date,
          startTime: appointment.start_time,
          endTime: appointment.end_time,
          notes: appointment.notes ?? '',
        },
        customer,
        service,
        staff,
        links,
        reminder: {
          type: reminderType,
          minutes_until: minutesUntil,
        },
      };

      const { error: reminderInsertError } = await supabase
        .from('appointment_reminders')
        .insert({
          appointment_id: appointment.id,
          reminder_type: reminderType,
        });

      if (reminderInsertError && reminderInsertError.code !== '23505') {
        throw reminderInsertError;
      }

      const result = await emitWebhookEvent(supabase, {
        userId: appointment.user_id,
        businessId: business.id,
        appointmentId: appointment.id,
        customerId: appointment.customer_id,
        eventType: reminderEventType,
        payload,
        dispatchImmediately,
      });

      summary.results.push({ appointmentId: appointment.id, reminderEventType, result });
      if (result.status === 'queued_and_dispatched' || result.status === 'queued') {
        summary.enqueued += 1;
      } else {
        summary.skipped += 1;
      }

      if (result.dispatch?.status === 'sent') {
        summary.sent += 1;
      }

      if (result.dispatch?.status === 'failed') {
        summary.failed += 1;
      }
    }

    return jsonResponse(summary);
  } catch (error) {
    console.error('process-appointment-reminders error:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
