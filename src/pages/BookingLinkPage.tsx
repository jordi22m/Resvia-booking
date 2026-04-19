import { Copy, ExternalLink, Share2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { QRCodeSVG } from 'qrcode.react';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '@/hooks/use-profile';

export default function BookingLinkPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: profile, isLoading } = useProfile();

  const slug = profile?.slug || 'mi-negocio';
  const businessName = profile?.business_name || 'Mi Negocio';
  const bookingUrl = `${window.location.origin}/book/${slug}`;

  const copy = () => {
    navigator.clipboard.writeText(bookingUrl);
    toast({ title: '¡Link copiado al portapapeles!' });
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Link de Reserva</h1>
        <p className="text-sm text-muted-foreground">Comparte este enlace con tus clientes por WhatsApp, Instagram o tu página web</p>
      </div>

      {!profile?.slug && (
        <div className="p-4 bg-warning/10 text-warning rounded-lg text-sm">
          Configura un slug en <button className="underline font-medium" onClick={() => navigate('/settings')}>Configuración</button> para activar tu página pública de reservas.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tu página pública de reservas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input value={bookingUrl} readOnly className="font-mono text-sm" />
            <Button variant="outline" onClick={copy}><Copy className="h-4 w-4" /></Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(`/book/${slug}`)}>
              <ExternalLink className="h-4 w-4 mr-1.5" /> Vista previa
            </Button>
            <Button variant="outline" size="sm" onClick={copy}>
              <Share2 className="h-4 w-4 mr-1.5" /> Compartir por WhatsApp
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Código QR</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <div className="p-4 bg-card rounded-xl border border-border">
            <QRCodeSVG value={bookingUrl} size={180} />
          </div>
          <p className="text-sm text-muted-foreground text-center">Imprime este código QR y colócalo en tu negocio para clientes sin cita previa</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plantilla de mensaje de WhatsApp</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-secondary rounded-lg p-4 text-sm text-foreground">
            <p>¡Hola! 👋 Reserva tu próxima cita en {businessName}:</p>
            <p className="text-primary font-medium mt-1">{bookingUrl}</p>
            <p className="mt-2">Rápido y fácil – elige tu servicio, escoge un horario y ¡listo! ✨</p>
          </div>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => {
            navigator.clipboard.writeText(`¡Hola! 👋 Reserva tu próxima cita en ${businessName}:\n${bookingUrl}\n\nRápido y fácil – elige tu servicio, escoge un horario y ¡listo! ✨`);
            toast({ title: '¡Mensaje copiado!' });
          }}>
            <Copy className="h-4 w-4 mr-1.5" /> Copiar mensaje
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
