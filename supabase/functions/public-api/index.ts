import {
  authenticateRequest,
  badRequest,
  createPublicClient,
  corsHeaders,
  getApiRoute,
  jsonResponse,
  methodNotAllowed,
  normalizeText,
  normalizeUuid,
  notFound,
  parseJsonBody,
  withWorkspaceHeaders,
} from '../_shared/public-api-helpers.ts';

function buildResponse(payload: unknown, workspaceId: string, status = 200) {
  return withWorkspaceHeaders(jsonResponse({ data: payload }, status), workspaceId);
}

function buildError(message: string, workspaceId: string, status = 400) {
  return withWorkspaceHeaders(jsonResponse({ error: message }, status), workspaceId);
}

function getStringParam(value: unknown) {
  return normalizeText(value);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createPublicClient();
    const auth = await authenticateRequest(supabase, req);
    if (auth.error) return auth.error;

    const workspaceId = auth.context.workspace_id;
    const route = getApiRoute(req);
    const url = new URL(req.url);
    const parts = route.split('/').filter(Boolean);

    if (parts.length < 2 || parts[0] !== 'api' || parts[1] !== 'v1') {
      return notFound();
    }

    if (parts.length === 3 && parts[2] === 'me') {
      if (req.method !== 'GET') return methodNotAllowed();

      const { data, error } = await supabase.rpc('api_get_me', {
        p_workspace_id: workspaceId,
      });

      if (error) return buildError(error.message, workspaceId, 400);
      return buildResponse(data, workspaceId);
    }

    if (parts.length === 3 && parts[2] === 'availability') {
      if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed();

      const body = req.method === 'POST' ? await parseJsonBody(req) : {};
      const from = getStringParam(
        body.fecha_desde ?? body.from ?? body.fecha ?? url.searchParams.get('fecha_desde') ?? url.searchParams.get('from') ?? url.searchParams.get('fecha')
      );
      const to = getStringParam(
        body.fecha_hasta ?? body.to ?? body.fecha ?? url.searchParams.get('fecha_hasta') ?? url.searchParams.get('to') ?? url.searchParams.get('fecha')
      );
      const serviceId = normalizeUuid(
        body.service_id ?? body.serviceId ?? url.searchParams.get('service_id') ?? url.searchParams.get('serviceId')
      );
      const serviceName = getStringParam(
        body.servicio ?? body.service_name ?? body.serviceName ?? body.service ?? url.searchParams.get('servicio') ?? url.searchParams.get('service_name') ?? url.searchParams.get('serviceName') ?? url.searchParams.get('service')
      );
      const staffId = normalizeUuid(
        body.staff_id ?? body.staffId ?? url.searchParams.get('staff_id') ?? url.searchParams.get('staffId')
      );
      const staffName = getStringParam(
        body.profesional ?? body.staff_name ?? body.staffName ?? body.staff ?? url.searchParams.get('profesional') ?? url.searchParams.get('staff_name') ?? url.searchParams.get('staffName') ?? url.searchParams.get('staff')
      );

      const { data, error } = await supabase.rpc('api_get_availability_slots', {
        p_workspace_id: workspaceId,
        p_from: from,
        p_to: to,
        p_service_id: serviceId,
        p_service_name: serviceName,
        p_staff_id: staffId,
        p_staff_name: staffName,
      });

      if (error) return buildError(error.message, workspaceId, 400);

      const payload = (data && typeof data === 'object') ? data as Record<string, unknown> : {};
      const slots = Array.isArray(payload.slots) ? payload.slots : [];

      console.log('[public-api][availability]', JSON.stringify({
        workspace_id: workspaceId,
        range_used: payload.range ?? { from, to },
        resolved_service: payload.resolved_service ?? { service_id: serviceId, service_name: serviceName },
        resolved_staff: payload.resolved_staff ?? { staff_id: staffId, staff_name: staffName },
        duration_minutes: payload.duration_minutes ?? null,
        slots_generated: slots.length,
        blocking_appointments: payload.blocking_appointments ?? 0,
      }));

      return buildResponse({ slots }, workspaceId);
    }

    if (parts.length === 3 && parts[2] === 'customers') {
      if (req.method === 'GET') {
        const search = normalizeText(url.searchParams.get('search'));
        const limit = Number(url.searchParams.get('limit') ?? '100');

        const { data, error } = await supabase.rpc('api_list_customers', {
          p_workspace_id: workspaceId,
          p_limit: Number.isFinite(limit) ? limit : 100,
          p_search: search,
        });

        if (error) return buildError(error.message, workspaceId, 400);
        return buildResponse(data, workspaceId);
      }

      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        const { data, error } = await supabase.rpc('api_create_customer', {
          p_workspace_id: workspaceId,
          p_name: normalizeText(body.name),
          p_phone: normalizeText(body.phone),
          p_email: normalizeText(body.email),
          p_notes: normalizeText(body.notes),
          p_tags: Array.isArray(body.tags)
            ? body.tags.filter((tag: unknown) => typeof tag === 'string' && tag.trim().length > 0)
            : null,
        });

        if (error) return buildError(error.message, workspaceId, 400);
        return buildResponse(data, workspaceId, 201);
      }

      return methodNotAllowed();
    }

    if (parts.length === 3 && parts[2] === 'appointments') {
      if (req.method !== 'POST') return methodNotAllowed();

      const body = await parseJsonBody(req);
      const customer = body.customer && typeof body.customer === 'object' ? body.customer : {};

      const { data, error } = await supabase.rpc('api_create_appointment', {
        p_workspace_id: workspaceId,
        p_service_id: normalizeUuid(body.service_id ?? body.serviceId),
        p_staff_id: normalizeUuid(body.staff_id ?? body.staffId),
        p_date: normalizeText(body.date),
        p_start_time: normalizeText(body.start_time ?? body.startTime),
        p_end_time: normalizeText(body.end_time ?? body.endTime),
        p_customer_id: normalizeUuid(body.customer_id ?? body.customerId),
        p_customer_name: normalizeText(customer.name ?? body.customer_name ?? body.customerName),
        p_customer_phone: normalizeText(customer.phone ?? body.customer_phone ?? body.customerPhone),
        p_customer_email: normalizeText(customer.email ?? body.customer_email ?? body.customerEmail),
        p_notes: normalizeText(body.notes),
      });

      if (error) return buildError(error.message, workspaceId, 400);
      return buildResponse(data, workspaceId, 201);
    }

    if (parts.length === 5 && parts[2] === 'appointments' && parts[4] === 'cancel') {
      if (req.method !== 'POST') return methodNotAllowed();

      const appointmentId = normalizeUuid(parts[3]);
      if (!appointmentId) return badRequest('appointment id invalido');

      const body = await parseJsonBody(req);
      const { data, error } = await supabase.rpc('api_cancel_appointment', {
        p_workspace_id: workspaceId,
        p_appointment_id: appointmentId,
        p_reason: normalizeText(body.reason),
      });

      if (error) return buildError(error.message, workspaceId, 400);
      return buildResponse(data, workspaceId);
    }

    if (parts.length === 5 && parts[2] === 'appointments' && parts[4] === 'reschedule') {
      if (req.method !== 'POST') return methodNotAllowed();

      const appointmentId = normalizeUuid(parts[3]);
      if (!appointmentId) return badRequest('appointment id invalido');

      const body = await parseJsonBody(req);
      const { data, error } = await supabase.rpc('api_reschedule_appointment', {
        p_workspace_id: workspaceId,
        p_appointment_id: appointmentId,
        p_service_id: normalizeUuid(body.service_id ?? body.serviceId),
        p_staff_id: normalizeUuid(body.staff_id ?? body.staffId),
        p_date: normalizeText(body.date),
        p_start_time: normalizeText(body.start_time ?? body.startTime),
        p_end_time: normalizeText(body.end_time ?? body.endTime),
        p_notes: normalizeText(body.notes),
      });

      if (error) return buildError(error.message, workspaceId, 400);
      return buildResponse(data, workspaceId);
    }

    return notFound();
  } catch (error) {
    console.error('public-api error:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});