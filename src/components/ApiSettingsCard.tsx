import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Copy, KeyRound, Loader2, RefreshCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

type ApiKeyInfo = {
  workspace_id: string;
  workspace_slug: string;
  business_name: string;
  has_active_key: boolean;
  active_key: {
    id: string;
    created_at: string;
    last_used_at: string | null;
    active: boolean;
    permissions: Record<string, unknown>;
  } | null;
};

type RpcError = { message?: string } | null;

async function callRpc<T>(fn: string, args?: Record<string, unknown>): Promise<{ data: T; error: RpcError }> {
  const rpc = supabase.rpc as unknown as (
    name: string,
    params?: Record<string, unknown>
  ) => Promise<{ data: T; error: RpcError }>;

  return rpc(fn, args);
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Nunca';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nunca';
  return date.toLocaleString('es-ES');
}

export function ApiSettingsCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<'idle' | 'ok' | 'error'>('idle');

  const apiBaseUrl = useMemo(() => {
    const base = import.meta.env.VITE_SUPABASE_URL;
    return base ? `${base}/functions/v1/public-api/api/v1` : '';
  }, []);

  const infoQuery = useQuery({
    queryKey: ['developers-api', 'info'],
    queryFn: async () => {
      const { data, error } = await callRpc<ApiKeyInfo>('get_workspace_api_key_info');
      if (error) throw new Error(error.message || 'No se pudo cargar la configuración API');
      return data as ApiKeyInfo;
    },
  });

  const testConnection = async (apiKey: string) => {
    if (!apiBaseUrl) return;

    try {
      const response = await fetch(`${apiBaseUrl}/me`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      setConnectionState(response.ok ? 'ok' : 'error');
    } catch {
      setConnectionState('error');
    }
  };

  const rotateKey = useMutation({
    mutationFn: async () => {
      const { data, error } = await callRpc<{ api_key: string }>('rotate_workspace_api_key', {
        p_permissions: {},
      });
      if (error) throw new Error(error.message || 'No se pudo generar la API key');
      return data as { api_key: string };
    },
    onSuccess: async (data) => {
      setRevealedKey(data.api_key);
      await qc.invalidateQueries({ queryKey: ['developers-api', 'info'] });
      toast({
        title: 'API key generada',
        description: 'Guárdala ahora. No volverá a mostrarse completa.',
      });
      void testConnection(data.api_key);
    },
    onError: (error) => {
      setConnectionState('error');
      toast({
        title: 'Error al regenerar la API key',
        description: error instanceof Error ? error.message : 'Error inesperado',
        variant: 'destructive',
      });
    },
  });

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copiado` });
    } catch {
      toast({ title: 'No se pudo copiar', variant: 'destructive' });
    }
  };

  const info = infoQuery.data;
  const statusLabel = connectionState === 'ok'
    ? 'Conectada'
    : connectionState === 'error'
      ? 'Error de prueba'
      : info?.has_active_key
        ? 'Lista'
        : 'Sin configurar';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Developers / API
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          API pública multi-tenant para integraciones externas por workspace. La clave solo se muestra completa al generarla.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Workspace ID</p>
            <div className="flex gap-2">
              <Input readOnly value={info?.workspace_id || ''} placeholder="Cargando..." />
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={!info?.workspace_id}
                onClick={() => info?.workspace_id && copyValue(info.workspace_id, 'Workspace ID')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">API Base URL</p>
            <div className="flex gap-2">
              <Input readOnly value={apiBaseUrl} placeholder="Define VITE_SUPABASE_URL" />
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={!apiBaseUrl}
                onClick={() => apiBaseUrl && copyValue(apiBaseUrl, 'API Base URL')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <p className="text-sm font-medium text-foreground">API Key</p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={revealedKey || (info?.has_active_key ? 'rv_live_••••••••••••••••••••••••' : 'No generada')}
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={!revealedKey}
                onClick={() => revealedKey && copyValue(revealedKey, 'API Key')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Si recargas la página, la clave volverá a quedar oculta. Para verla otra vez tendrás que regenerarla.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Estado conexión</p>
            <div className="mt-2 flex items-center gap-2 text-sm font-medium text-foreground">
              {connectionState === 'error' ? (
                <AlertCircle className="h-4 w-4 text-destructive" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              )}
              <span>{statusLabel}</span>
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Última utilización</p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {formatDateTime(info?.active_key?.last_used_at)}
            </p>
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Workspace slug</p>
            <p className="mt-2 text-sm font-medium text-foreground break-all">
              {info?.workspace_slug || 'Sin slug'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => rotateKey.mutate()}
            disabled={rotateKey.isPending || infoQuery.isLoading}
          >
            {rotateKey.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-1.5" />}
            {info?.has_active_key ? 'Regenerar key' : 'Generar key'}
          </Button>

          <Button
            type="button"
            variant="outline"
            disabled={!revealedKey || !apiBaseUrl}
            onClick={() => revealedKey && testConnection(revealedKey)}
          >
            Probar conexión
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}