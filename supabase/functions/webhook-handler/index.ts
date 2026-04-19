// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const secret = req.headers.get('x-webhook-secret');
    if (!secret) {
      return new Response(JSON.stringify({ error: 'Missing x-webhook-secret header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('PROJECT_URL');
    const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('PROJECT_URL or SERVICE_ROLE_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: config, error: configError } = await supabase
      .from('webhook_configs')
      .select('user_id')
      .eq('secret', secret)
      .single();

    if (configError || !config) {
      return new Response(JSON.stringify({ error: 'Invalid webhook secret' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = config.user_id;
    const body = await req.json();
    const action = body.action;

    if (!action) {
      return new Response(JSON.stringify({ error: 'Missing action in webhook payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let result;
    switch (action) {
      case 'create_appointment':
        result = await createAppointment(supabase, userId, body);
        break;
      case 'cancel_appointment':
        result = await updateAppointmentStatus(supabase, userId, body.appointment_id, 'canceled');
        break;
      case 'confirm_appointment':
        result = await updateAppointmentStatus(supabase, userId, body.appointment_id, 'confirmed');
        break;
      case 'reschedule_appointment':
        result = await rescheduleAppointment(supabase, userId, body);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unsupported action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: result.status ?? 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ data: result.data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('webhook-handler error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function createAppointment(supabase: any, userId: string, body: any) {
  const customerPayload = body.customer;
  if (!customerPayload || !customerPayload.name) {
    return { error: 'customer.name is required', status: 400 };
  }
  if (!body.service_id || !body.date || !body.start_time || !body.end_time) {
    return { error: 'service_id, date, start_time and end_time are required', status: 400 };
  }

  let customerId = body.customer_id;
  if (!customerId && customerPayload.email) {
    const { data: existingCustomer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', userId)
      .eq('email', customerPayload.email)
      .limit(1)
      .single();

    if (customerError && customerError.code !== 'PGRST116') {
      return { error: customerError.message, status: 500 };
    }

    if (existingCustomer) {
      customerId = existingCustomer.id;
    }
  }

  if (!customerId) {
    const { data: newCustomer, error: insertCustomerError } = await supabase
      .from('customers')
      .insert({
        user_id: userId,
        name: customerPayload.name,
        phone: customerPayload.phone ?? '',
        email: customerPayload.email ?? '',
        notes: customerPayload.notes ?? '',
      })
      .select('id')
      .single();

    if (insertCustomerError) {
      return { error: insertCustomerError.message, status: 500 };
    }
    customerId = newCustomer.id;
  }

  const { data: appointment, error: appointmentError } = await supabase
    .from('appointments')
    .insert({
      user_id: userId,
      customer_id: customerId,
      service_id: body.service_id,
      staff_id: body.staff_id ?? null,
      date: body.date,
      start_time: body.start_time,
      end_time: body.end_time,
      status: body.status ?? 'pending',
      notes: body.notes ?? '',
    })
    .select('*')
    .single();

  if (appointmentError) {
    return { error: appointmentError.message, status: 500 };
  }

  return { data: appointment };
}

async function updateAppointmentStatus(supabase: any, userId: string, appointmentId: string, status: string) {
  if (!appointmentId) {
    return { error: 'appointment_id is required', status: 400 };
  }

  const { data: appointment, error: appointmentError } = await supabase
    .from('appointments')
    .update({ status })
    .eq('id', appointmentId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (appointmentError) {
    return { error: appointmentError.message, status: 500 };
  }

  return { data: appointment };
}

async function rescheduleAppointment(supabase: any, userId: string, body: any) {
  if (!body.appointment_id || !body.date || !body.start_time || !body.end_time) {
    return { error: 'appointment_id, date, start_time and end_time are required', status: 400 };
  }

  const { data: appointment, error: appointmentError } = await supabase
    .from('appointments')
    .update({
      date: body.date,
      start_time: body.start_time,
      end_time: body.end_time,
      notes: body.notes ?? undefined,
      status: body.status ?? 'rescheduled',
    })
    .eq('id', body.appointment_id)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (appointmentError) {
    return { error: appointmentError.message, status: 500 };
  }

  return { data: appointment };
}
