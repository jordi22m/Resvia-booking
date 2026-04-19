import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

type TokenBooking = {
  business_name?: string | null;
  service_name?: string | null;
  date?: string | null;
  start_time?: string | null;
  business_slug?: string | null;
};

export default function BookingReschedulePage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<TokenBooking | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!token) {
        setError('Token inválido');
        setLoading(false);
        return;
      }
      const { data, error: rpcError } = await supabase.rpc('get_booking_by_token', { p_token: token });
      if (rpcError) {
        setError(rpcError.message);
      } else {
        setBooking((data || null) as TokenBooking | null);
      }
      setLoading(false);
    };
    void load();
  }, [token]);

  const markRescheduled = async () => {
    if (!token) return;
    setMarking(true);
    const { error: rpcError } = await supabase.rpc('mark_booking_rescheduled_by_token', { p_token: token });
    setMarking(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setDone(true);
  };

  const bookingUrl = booking?.business_slug ? `/book/${booking.business_slug}` : '/';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 space-y-4">
          <h1 className="text-xl font-semibold text-foreground">Reprogramar reserva</h1>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {booking ? (
            <div className="text-sm text-muted-foreground space-y-1">
              <p><strong>Negocio:</strong> {booking.business_name || '-'}</p>
              <p><strong>Servicio:</strong> {booking.service_name || '-'}</p>
              <p><strong>Fecha actual:</strong> {booking.date || '-'}</p>
              <p><strong>Hora actual:</strong> {booking.start_time || '-'}</p>
            </div>
          ) : null}
          <a href={bookingUrl} className="block">
            <Button className="w-full">Elegir nueva fecha y hora</Button>
          </a>
          <Button variant="outline" className="w-full" onClick={markRescheduled} disabled={marking || Boolean(error)}>
            {marking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Ya reprogramé, marcar reprogramada
          </Button>
          {done ? <p className="text-sm text-foreground">Reserva marcada como reprogramada.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
