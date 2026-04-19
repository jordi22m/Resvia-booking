import { useEffect, useState } from 'react';
import { Webhook, Copy, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useWebhookConfig, useSaveWebhookConfig } from '@/hooks/use-webhook-config';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { buildWebhookPayload, CANONICAL_WEBHOOK_EVENTS, triggerWebhook } from '@/lib/webhook';
import type { Json } from '@/integrations/supabase/types';

const events = [...CANONICAL_WEBHOOK_EVENTS];

const samplePayload: Record<string, Json> = {
  ...buildWebhookPayload({
    event: 'booking.created',
    business: { id: 'biz-123', name: 'Studio Glow', slug: 'studio-glow' },
    appointment: {
      id: 'apt-123',
      public_id: 'bk_abc123',
      status: 'pending',
      date: '2026-04-20',
      start_time: '10:00',
      end_time: '10:45',
    },
    customer: { id: 'cus-123', name: 'Alicia Rivera', phone: '+34651001001', email: 'alicia@email.com' },
    service: { id: 'svc-123', name: 'Corte de pelo', duration: 45, price: 55 },
    timezone: 'Europe/Madrid',
    booking_url: 'https://resviabooking.com/book/studio-glow',
    cancel_url: 'https://resviabooking.com/booking/cancel/ct_abc123',
    reschedule_url: 'https://resviabooking.com/booking/reschedule/rt_abc123',
  }),
};

export default function WebhooksPage() {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const { data: config, isLoading } = useWebhookConfig();
  const saveWebhookConfig = useSaveWebhookConfig();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

  useEffect(() => {
    if (config) {
      setWebhookUrl(config.webhook_url);
      setSelectedEvents(config.selected_events ?? []);
    }
  }, [config]);

  const toggleEvent = (event: string) => {
    setSelectedEvents(prev => prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]);
  };

  const handleSave = async () => {
    try {
      await saveWebhookConfig.mutateAsync({
        webhook_url: webhookUrl.trim(),
        selected_events: selectedEvents,
        active: true,
      });
      toast({ title: 'Configuración guardada' });
    } catch (error: any) {
      toast({
        title: 'Error al guardar',
        description: error?.message ?? 'No se pudo guardar la configuración',
      });
    }
  };

  const handleCopySecret = async () => {
    if (!config?.secret) return;
    await navigator.clipboard.writeText(config.secret);
    toast({ title: 'Secreto copiado' });
  };

  const handleSendTest = async () => {
    if (!user) {
      toast({
        title: 'Error',
        description: 'Usuario no disponible',
      });
      return;
    }

    try {
      await triggerWebhook(
        'booking.created',
        samplePayload,
        user.id,
        session!
      );
      toast({ title: 'Evento de prueba enviado' });
    } catch (error: any) {
      toast({
        title: 'Error al enviar prueba',
        description: error?.message ?? 'No se pudo enviar el evento de prueba',
      });
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Automatizaciones y Webhooks</h1>
        <p className="text-sm text-muted-foreground">Conecta con n8n, Zapier o cualquier herramienta de automatización compatible con webhooks</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Webhook className="h-4 w-4" /> Configuración del Webhook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground">URL del Webhook</label>
            <div className="flex gap-2 mt-1.5">
              <Input
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
                placeholder="https://tu-instancia-n8n.com/webhook/..."
              />
              <Button variant="outline" onClick={handleSave} disabled={saveWebhookConfig.isLoading || isLoading}>
                Guardar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Ingresa la URL de tu webhook de n8n para recibir eventos canónicos de reservas</p>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Eventos a enviar</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {events.map(event => (
                <button
                  key={event}
                  onClick={() => toggleEvent(event)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    selectedEvents.includes(event)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-muted-foreground border-border hover:border-primary/50'
                  }`}
                >
                  {event}
                </button>
              ))}
            </div>
          </div>

          {config?.secret ? (
            <div>
              <label className="text-sm font-medium text-foreground">Secreto para webhooks entrantes</label>
              <div className="flex gap-2 mt-1.5">
                <Input value={config.secret} readOnly />
                <Button variant="ghost" onClick={handleCopySecret}>
                  <Copy className="h-4 w-4 mr-1.5" /> Copiar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Usa este secret en el header <code>x-webhook-secret</code> de tu flujo n8n al llamar al endpoint entrante.</p>
            </div>
          ) : null}

          <Button variant="outline" size="sm" onClick={handleSendTest}>
            <CheckCircle2 className="h-4 w-4 mr-1.5" /> Enviar evento de prueba
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Payload de ejemplo</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(samplePayload, null, 2));
              toast({ title: '¡Payload copiado!' });
            }}>
              <Copy className="h-4 w-4 mr-1.5" /> Copiar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <pre className="bg-secondary rounded-lg p-4 text-xs text-foreground overflow-x-auto font-mono">
            {JSON.stringify(samplePayload, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Guía de integración con n8n</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <span className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">1</span>
            <p>Crea un nuevo flujo en n8n con un nodo <strong className="text-foreground">Webhook</strong> como disparador</p>
          </div>
          <div className="flex gap-3">
            <span className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">2</span>
            <p>Copia la URL del webhook de n8n y pégala arriba</p>
          </div>
          <div className="flex gap-3">
            <span className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">3</span>
            <p>Selecciona qué eventos enviar – recomendamos todos los eventos de reservas</p>
          </div>
          <div className="flex gap-3">
            <span className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">4</span>
            <p>En n8n, agrega acciones como <strong className="text-foreground">mensaje de WhatsApp</strong>, <strong className="text-foreground">email</strong> o <strong className="text-foreground">actualización de CRM</strong></p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
