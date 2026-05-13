import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders, jsonResponse } from './webhook-helpers.ts';

export { corsHeaders, jsonResponse };

type RpcSingleResult = {
  data: Record<string, unknown> | null;
  error: { message?: string } | null;
};

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => {
    single: () => Promise<RpcSingleResult>;
  };
};

export function createPublicClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('PROJECT_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');

  if (!supabaseUrl || !anonKey) {
    throw new Error('SUPABASE_URL/PROJECT_URL o SUPABASE_ANON_KEY/ANON_KEY no configurados');
  }

  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getApiRoute(req: Request) {
  const pathname = new URL(req.url).pathname;
  const marker = '/api/v1';
  const index = pathname.indexOf(marker);
  return index >= 0 ? pathname.slice(index) : pathname;
}

export function getBearerToken(req: Request) {
  const explicitApiKey = req.headers.get('x-resvia-api-key') ?? req.headers.get('x-api-key');
  if (explicitApiKey && explicitApiKey.trim().length > 0) {
    return explicitApiKey.trim();
  }

  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!header) return null;

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function authenticateRequest(supabase: RpcClient, req: Request) {
  const apiKey = getBearerToken(req);
  if (!apiKey) {
    return {
      error: jsonResponse({ error: 'Missing Authorization: Bearer <api_key>' }, 401),
    };
  }

  const { data, error } = await supabase
    .rpc('authenticate_api_key', { p_api_key: apiKey })
    .single();

  if (error || !data) {
    return {
      error: jsonResponse({ error: 'Invalid API key' }, 401),
    };
  }

  return {
    context: data,
  };
}

export function parseJsonBody(req: Request) {
  return req.json().catch(() => ({}));
}

export function normalizeUuid(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function badRequest(message: string) {
  return jsonResponse({ error: message }, 400);
}

export function notFound() {
  return jsonResponse({ error: 'Route not found' }, 404);
}

export function methodNotAllowed() {
  return jsonResponse({ error: 'Method not allowed' }, 405);
}

export function withWorkspaceHeaders(response: Response, workspaceId: string) {
  response.headers.set('x-workspace-id', workspaceId);
  response.headers.set('x-api-version', 'v1');
  return response;
}