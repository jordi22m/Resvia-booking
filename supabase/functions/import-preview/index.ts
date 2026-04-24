// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const PREVIEW_LIMIT = 50;

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

    let jobId: string | null = null;

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      jobId = String(body?.job_id ?? '').trim() || null;
    } else {
      const url = new URL(req.url);
      jobId = url.searchParams.get('job_id');
    }

    if (!jobId) {
      return jsonResponse({ error: 'job_id is required' }, 400);
    }

    const { data: job, error: jobError } = await supabase
      .from('import_jobs')
      .select('id, total_rows')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return jsonResponse({ error: 'Import job not found' }, 404);
    }

    const { data: rows, error: rowsError } = await supabase
      .from('import_rows')
      .select('raw_payload, row_number')
      .eq('job_id', jobId)
      .order('row_number', { ascending: true })
      .limit(PREVIEW_LIMIT);

    if (rowsError) {
      throw rowsError;
    }

    const previewRows = (rows ?? []).map((row) => row.raw_payload);
    const firstRow = previewRows[0] ?? {};
    const columns = firstRow && typeof firstRow === 'object'
      ? Object.keys(firstRow)
      : [];

    return jsonResponse({
      job_id: job.id,
      total_rows: job.total_rows ?? 0,
      preview_rows: previewRows,
      columns,
    });
  } catch (error: any) {
    console.error('[import-preview] error:', error);
    return jsonResponse({ error: error?.message ?? 'Unexpected error' }, 500);
  }
});
