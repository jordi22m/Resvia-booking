// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { parse } from 'https://esm.sh/csv-parse@5.5.6/sync';

const BATCH_SIZE = 500;
const MAX_ROWS = 5000;
const textEncoder = new TextEncoder();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-business-id',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = textEncoder.encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function readIncomingCsv(req: Request): Promise<{ csvText: string; fileName: string | null; businessId: string | null }> {
  const contentType = req.headers.get('content-type') || '';
  const url = new URL(req.url);

  const businessIdFromHeader = req.headers.get('x-business-id');
  const businessIdFromQuery = url.searchParams.get('business_id');
  const fileNameFromQuery = url.searchParams.get('file_name');

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const maybeBusinessId = String(formData.get('business_id') ?? '').trim();

    let file: File | null = null;
    const fileField = formData.get('file');
    if (fileField instanceof File) {
      file = fileField;
    } else {
      for (const value of formData.values()) {
        if (value instanceof File) {
          file = value;
          break;
        }
      }
    }

    if (!file) {
      throw new Error('Missing CSV file in multipart/form-data (expected field: file)');
    }

    const csvText = await file.text();
    return {
      csvText,
      fileName: file.name || fileNameFromQuery || null,
      businessId: maybeBusinessId || businessIdFromHeader || businessIdFromQuery,
    };
  }

  if (contentType.includes('application/json')) {
    const body = await req.json();
    return {
      csvText: String(body?.csv ?? ''),
      fileName: String(body?.file_name ?? fileNameFromQuery ?? '') || null,
      businessId: String(body?.business_id ?? businessIdFromHeader ?? businessIdFromQuery ?? '') || null,
    };
  }

  const csvText = await req.text();
  return {
    csvText,
    fileName: fileNameFromQuery,
    businessId: businessIdFromHeader || businessIdFromQuery,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405);
  }

  let createdJobId: string | null = null;
  let chunksProcessed = 0;

  try {
    const supabaseUrl = Deno.env.get('PROJECT_URL');
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('PROJECT_URL or SERVICE_ROLE_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { csvText, fileName, businessId } = await readIncomingCsv(req);

    if (!businessId) {
      return jsonResponse({ error: 'business_id is required' }, 400);
    }

    if (!csvText || !csvText.trim()) {
      return jsonResponse({ error: 'CSV content is empty' }, 400);
    }

    const fileSha256 = await sha256Hex(csvText);

    const { data: existingJob, error: existingJobError } = await supabase
      .from('import_jobs')
      .select('id, total_rows, parsed_rows')
      .eq('business_id', businessId)
      .eq('file_sha256', fileSha256)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingJobError) {
      throw existingJobError;
    }

    if (existingJob?.id) {
      console.info('[import-csv] idempotent hit', {
        job_id: existingJob.id,
        business_id: businessId,
      });

      return jsonResponse({
        job_id: existingJob.id,
        rows_received: existingJob.total_rows ?? 0,
        rows_inserted: existingJob.parsed_rows ?? 0,
        chunks_processed: 0,
      });
    }

    const parsedRows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, unknown>[];

    const totalRows = parsedRows.length;

    if (totalRows > MAX_ROWS) {
      const { data: failedJob, error: failedJobError } = await supabase
        .from('import_jobs')
        .insert({
          business_id: businessId,
          source_type: 'csv',
          source_filename: fileName,
          file_sha256: fileSha256,
          status: 'failed',
          total_rows: totalRows,
        })
        .select('id')
        .single();

      if (failedJobError || !failedJob?.id) {
        throw failedJobError || new Error('Failed to create failed import job for oversized CSV');
      }

      console.error('[import-csv] oversized CSV rejected', {
        job_id: failedJob.id,
        business_id: businessId,
        total_rows_parsed: totalRows,
        max_rows_allowed: MAX_ROWS,
      });

      return jsonResponse({
        error: 'CSV too large. Max 5000 rows allowed',
        job_id: failedJob.id,
        rows_received: totalRows,
        rows_inserted: 0,
        chunks_processed: 0,
      }, 400);
    }

    const { data: createdJob, error: createJobError } = await supabase
      .from('import_jobs')
      .insert({
        business_id: businessId,
        source_type: 'csv',
        source_filename: fileName,
        file_sha256: fileSha256,
        status: 'uploaded',
        total_rows: totalRows,
      })
      .select('id')
      .single();

    if (createJobError || !createdJob?.id) {
      throw createJobError || new Error('Failed to create import job');
    }

    createdJobId = createdJob.id;
    console.info('[import-csv] job created', {
      job_id: createdJobId,
      business_id: businessId,
      total_rows_parsed: totalRows,
    });

    if (totalRows === 0) {
      return jsonResponse({
        job_id: createdJobId,
        rows_received: 0,
        rows_inserted: 0,
        chunks_processed: 0,
      });
    }

    const rowsToInsert = [];
    for (let index = 0; index < parsedRows.length; index++) {
      const row = parsedRows[index];
      const rowJson = JSON.stringify(row);
      const rowHash = await sha256Hex(rowJson);

      rowsToInsert.push({
        job_id: createdJobId,
        business_id: businessId,
        row_number: index + 1,
        raw_payload: row,
        row_hash: rowHash,
        status: 'parsed',
      });
    }

    let rowsInserted = 0;
    const chunks = chunkArray(rowsToInsert, BATCH_SIZE);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const startIndex = chunkIndex * BATCH_SIZE + 1;
      const endIndex = startIndex + chunk.length - 1;

      console.info('[import-csv] chunk insert start', {
        job_id: createdJobId,
        chunk_index: chunkIndex + 1,
        chunk_total: chunks.length,
        start_row: startIndex,
        end_row: endIndex,
      });

      try {
        const { error: insertRowsError } = await supabase
          .from('import_rows')
          .insert(chunk);

        if (insertRowsError) {
          throw insertRowsError;
        }

        rowsInserted += chunk.length;
        chunksProcessed += 1;

        console.info('[import-csv] chunk insert done', {
          job_id: createdJobId,
          chunk_index: chunkIndex + 1,
          rows_inserted: rowsInserted,
        });
      } catch (chunkError: any) {
        console.error('[import-csv] chunk insert failed', {
          job_id: createdJobId,
          chunk_index: chunkIndex + 1,
          start_row: startIndex,
          end_row: endIndex,
          error: chunkError?.message,
        });

        await supabase
          .from('import_jobs')
          .update({ status: 'failed' })
          .eq('id', createdJobId);

        throw chunkError;
      }
    }

    const { error: updateJobError } = await supabase
      .from('import_jobs')
      .update({ parsed_rows: rowsInserted })
      .eq('id', createdJobId);

    if (updateJobError) {
      throw updateJobError;
    }

    return jsonResponse({
      job_id: createdJobId,
      rows_received: totalRows,
      rows_inserted: rowsInserted,
      chunks_processed: chunksProcessed,
    });
  } catch (error: any) {
    console.error('[import-csv] error:', error);

    if (createdJobId) {
      try {
        const supabaseUrl = Deno.env.get('PROJECT_URL');
        const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY');

        if (supabaseUrl && serviceRoleKey) {
          const supabase = createClient(supabaseUrl, serviceRoleKey);
          await supabase
            .from('import_jobs')
            .update({ status: 'failed' })
            .eq('id', createdJobId);
        }
      } catch (markError) {
        console.error('[import-csv] failed to mark job as failed:', markError);
      }
    }

    return jsonResponse({ error: error?.message ?? 'Unexpected error' }, 500);
  }
});
