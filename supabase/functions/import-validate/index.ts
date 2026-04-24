// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

function validateRow(rawPayload: Record<string, unknown>, rowNumber: number) {
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
    row_number: rowNumber,
    is_valid: errors.length === 0,
    errors,
    first_error: errors[0]?.message ?? null,
    raw_payload: rawPayload,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed. Use GET or POST.' }, 405);
  }

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

    const { data: rows, error: rowsError } = await supabase
      .from('import_rows')
      .select('row_number, raw_payload')
      .eq('job_id', jobId)
      .order('row_number', { ascending: true });

    if (rowsError) {
      throw rowsError;
    }

    const rowResults = (rows ?? []).map((row) => {
      const payload = row.raw_payload && typeof row.raw_payload === 'object'
        ? row.raw_payload
        : {};
      return validateRow(payload, row.row_number);
    });

    const totalRows = rowResults.length;
    const validRows = rowResults.filter((row) => row.is_valid).length;
    const invalidRows = totalRows - validRows;

    return jsonResponse({
      job_id: jobId,
      summary: {
        total_rows: totalRows,
        valid_rows: validRows,
        invalid_rows: invalidRows,
      },
      rows: rowResults,
    });
  } catch (error: any) {
    console.error('[import-validate] error:', error);
    return jsonResponse({ error: error?.message ?? 'Unexpected error' }, 500);
  }
});
