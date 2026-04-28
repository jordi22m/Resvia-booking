// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

export function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

export function createServiceRoleClient() {
  const supabaseUrl = Deno.env.get('PROJECT_URL');
  const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('PROJECT_URL or SERVICE_ROLE_KEY not configured');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getAppBaseUrl() {
  return (Deno.env.get('RESVIA_APP_URL') ?? 'https://resviabooking.vercel.app').replace(/\/$/, '');
}

export async function getBusinessProfileByUserId(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, user_id, business_name, slug, email, phone, timezone')
    .eq('user_id', userId)
    .single();

  if (error) throw error;
  return data;
}

export async function ensureBookingTokens(supabase: any, appointmentId: string | null | undefined) {
  if (!appointmentId) {
    return { cancelToken: null, rescheduleToken: null };
  }

  await supabase
    .from('booking_tokens')
    .upsert({ appointment_id: appointmentId }, { onConflict: 'appointment_id', ignoreDuplicates: true });

  const { data, error } = await supabase
    .from('booking_tokens')
    .select('cancel_token, reschedule_token')
    .eq('appointment_id', appointmentId)
    .maybeSingle();

  if (error) throw error;

  return {
    cancelToken: data?.cancel_token ?? null,
    rescheduleToken: data?.reschedule_token ?? null,
  };
}

export function buildBookingUrls({
  slug,
  cancelToken,
  rescheduleToken,
}: {
  slug?: string | null;
  cancelToken?: string | null;
  rescheduleToken?: string | null;
}) {
  const baseUrl = getAppBaseUrl();

  return {
    booking: slug ? `${baseUrl}/book/${slug}` : null,
    cancel: cancelToken ? `${baseUrl}/booking/cancel/${cancelToken}` : null,
    reschedule: rescheduleToken ? `${baseUrl}/booking/reschedule/${rescheduleToken}` : null,
  };
}

export function withEventMetadata(eventType: string, payload: Record<string, unknown> | null | undefined) {
  const body = payload && typeof payload === 'object' ? payload : {};
  return {
    ...body,
    event: eventType,
    timestamp: new Date().toISOString(),
  };
}

function asUuid(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

export function extractEventRefs(payload: Record<string, unknown> | null | undefined) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const booking = body.booking && typeof body.booking === 'object' ? body.booking as Record<string, unknown> : {};
  const appointment = body.appointment && typeof body.appointment === 'object' ? body.appointment as Record<string, unknown> : {};
  const customer = body.customer && typeof body.customer === 'object' ? body.customer as Record<string, unknown> : {};
  const business = body.business && typeof body.business === 'object' ? body.business as Record<string, unknown> : {};

  return {
    appointmentId: asUuid(body.appointment_id) ?? asUuid(booking.id) ?? asUuid(appointment.id),
    customerId: asUuid(body.customer_id) ?? asUuid(customer.id),
    businessId: asUuid(body.business_id) ?? asUuid(business.id),
  };
}

export function getReminderEventType(minutesUntil: number) {
  if (minutesUntil >= 23 * 60 && minutesUntil <= 25 * 60) {
    return 'reminder.24h';
  }

  if (minutesUntil >= 1 * 60 && minutesUntil <= 3 * 60) {
    return 'reminder.2h';
  }

  return null;
}

export function getMinutesUntilAppointment(date: string, startTime: string) {
  const scheduledAt = new Date(`${date}T${startTime}`);
  if (Number.isNaN(scheduledAt.getTime())) {
    return null;
  }

  return Math.round((scheduledAt.getTime() - Date.now()) / 60000);
}
