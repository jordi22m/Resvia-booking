// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PROCESSING_STATUS = 'importing';
const STALE_IMPORTING_MS = 10 * 60 * 1000;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseJobId(req: Request, body: any): string | null {
  if (body?.job_id) {
    return String(body.job_id).trim();
  }

  const url = new URL(req.url);
  const jobIdFromQuery = url.searchParams.get('job_id');
  return jobIdFromQuery ? String(jobIdFromQuery).trim() : null;
}

function isValidDateValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') {
    return true;
  }

  const asDate = new Date(String(value));
  return !Number.isNaN(asDate.getTime());
}

function validateRow(rawPayload: Record<string, unknown>) {
  const errors: Array<{ field: string; message: string }> = [];

  const name = rawPayload?.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    errors.push({
      field: 'name',
      message: 'Name is required and must be a string',
    });
  }

  const phone = rawPayload?.phone;
  if (typeof phone !== 'string' || phone.trim().length === 0) {
    errors.push({
      field: 'phone',
      message: 'Phone is required',
    });
  } else {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 9) {
      errors.push({
        field: 'phone',
        message: 'Phone must contain at least 9 digits',
      });
    }
  }

  const date = rawPayload?.date;
  if (!isValidDateValue(date)) {
    errors.push({
      field: 'date',
      message: 'Date must be a valid date',
    });
  }

  return {
    is_valid: errors.length === 0,
    errors,
  };
}

function hasBookingData(rawPayload: Record<string, unknown>): boolean {
  return Boolean(
    rawPayload?.date &&
    rawPayload?.service_id &&
    rawPayload?.start_time &&
    rawPayload?.end_time,
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed. Use GET or POST.' }, 405);
  }

  let jobIdForFailure: string | null = null;

  try {
    const supabaseUrl = Deno.env.get('PROJECT_URL');
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('PROJECT_URL or SERVICE_ROLE_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let body: any = {};
    if (req.method === 'POST') {
      body = await req.json().catch(() => ({}));
    }

    const jobId = parseJobId(req, body);
    if (!jobId) {
      return jsonResponse({ error: 'job_id is required' }, 400);
    }
    jobIdForFailure = jobId;

    const { data: job, error: jobError } = await supabase
      .from('import_jobs')
      .select('id, business_id, status, importing_started_at')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return jsonResponse({ error: 'Import job not found' }, 404);
    }

    if (job.status === 'completed') {
      return jsonResponse({
        job_id: jobId,
        total_rows: 0,
        imported_rows: 0,
        skipped_rows: 0,
      });
    }

    const nowIso = new Date().toISOString();
    const importingStartedAtMs = job.importing_started_at
      ? Date.parse(String(job.importing_started_at))
      : Number.NaN;
    const isStaleImporting =
      job.status === PROCESSING_STATUS &&
      Number.isFinite(importingStartedAtMs) &&
      (Date.now() - importingStartedAtMs) > STALE_IMPORTING_MS;

    let lockJob: { id: string } | null = null;
    let lockJobError: any = null;

    if (isStaleImporting) {
      // Take over stale importing job.
      const takeover = await supabase
        .from('import_jobs')
        .update({
          status: PROCESSING_STATUS,
          importing_started_at: nowIso,
        })
        .eq('id', jobId)
        .eq('status', PROCESSING_STATUS)
        .eq('importing_started_at', job.importing_started_at)
        .select('id')
        .maybeSingle();

      lockJob = takeover.data;
      lockJobError = takeover.error;
    } else {
      // Standard lock acquisition from uploaded.
      const lock = await supabase
        .from('import_jobs')
        .update({
          status: PROCESSING_STATUS,
          importing_started_at: nowIso,
        })
        .eq('id', jobId)
        .eq('status', 'uploaded')
        .select('id')
        .maybeSingle();

      lockJob = lock.data;
      lockJobError = lock.error;
    }

    if (lockJobError) {
      throw lockJobError;
    }

    if (!lockJob?.id) {
      return jsonResponse({
        job_id: jobId,
        total_rows: 0,
        imported_rows: 0,
        skipped_rows: 0,
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, user_id')
      .eq('id', job.business_id)
      .single();

    if (profileError || !profile?.user_id) {
      return jsonResponse({ error: 'Business profile not found for job' }, 400);
    }

    const { data: rows, error: rowsError } = await supabase
      .from('import_rows')
      .select('row_number, raw_payload')
      .eq('job_id', jobId)
      .order('row_number', { ascending: true });

    if (rowsError) {
      throw rowsError;
    }

    const allRows = rows ?? [];
    const totalRows = allRows.length;
    let importedRows = 0;
    let skippedRows = 0;

    for (const row of allRows) {
      const payload = row.raw_payload && typeof row.raw_payload === 'object'
        ? row.raw_payload
        : {};

      const validation = validateRow(payload);
      if (!validation.is_valid) {
        skippedRows += 1;
        continue;
      }

      const customerInsert = {
        user_id: profile.user_id,
        name: String(payload.name),
        phone: String(payload.phone),
        email: typeof payload.email === 'string' ? payload.email : '',
      };

      const { data: createdCustomer, error: customerError } = await supabase
        .from('customers')
        .insert(customerInsert)
        .select('id')
        .single();

      if (customerError || !createdCustomer?.id) {
        skippedRows += 1;
        continue;
      }

      if (hasBookingData(payload)) {
        const appointmentInsert = {
          user_id: profile.user_id,
          customer_id: createdCustomer.id,
          service_id: String(payload.service_id),
          staff_id: payload.staff_id ? String(payload.staff_id) : null,
          date: String(payload.date),
          start_time: String(payload.start_time),
          end_time: String(payload.end_time),
          status: 'pending',
          notes: typeof payload.notes === 'string' ? payload.notes : '',
        };

        const { error: appointmentError } = await supabase
          .from('appointments')
          .insert(appointmentInsert);

        if (appointmentError) {
          skippedRows += 1;
          continue;
        }
      }

      importedRows += 1;
    }

    const { error: completeJobError } = await supabase
      .from('import_jobs')
      .update({ status: 'completed' })
      .eq('id', jobId);

    if (completeJobError) {
      throw completeJobError;
    }

    return jsonResponse({
      job_id: jobId,
      total_rows: totalRows,
      imported_rows: importedRows,
      skipped_rows: skippedRows,
    });
  } catch (error: any) {
    console.error('[import-apply] error:', error);

    try {
      const supabaseUrl = Deno.env.get('PROJECT_URL');
      const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY');

      if (supabaseUrl && serviceRoleKey && jobIdForFailure) {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        await supabase
          .from('import_jobs')
          .update({ status: 'failed' })
          .eq('id', jobIdForFailure);
      }
    } catch (markError) {
      console.error('[import-apply] failed to mark job as failed:', markError);
    }

    return jsonResponse({ error: error?.message ?? 'Unexpected error' }, 500);
  }
});
