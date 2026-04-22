import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Calendar, CheckCircle2, Loader2, Scissors, Store } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

type TokenBooking = {
  appointment_id?: string;
  business_name?: string | null;
  service_name?: string | null;
  date?: string | null;
  start_time?: string | null;
  status?: string | null;
};

function toUserMessage(errorMessage: string | null) {
  if (!errorMessage) return 'No pudimos completar esta accion. Intenta de nuevo en unos segundos.';
  const lowerMessage = errorMessage.toLowerCase();

  if (lowerMessage.includes('best candidate function')) {
    return 'Este enlace aun se esta actualizando. Prueba de nuevo en un minuto.';
  }

  if (lowerMessage.includes('token') || lowerMessage.includes('not found') || lowerMessage.includes('no encontrado')) {
    return 'Este enlace no es valido o ya no esta disponible.';
  }

  if (lowerMessage.includes('ya no puede cancelarse')) {
    return 'Esta cita ya no puede cancelarse.';
  }

  return 'No pudimos procesar tu solicitud en este momento. Intenta nuevamente.';
}

export default function BookingCancelPage() {
  const { token } = useParams<{ token: string }>();
  const normalizedToken = token?.trim() ?? '';
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [booking, setBooking] = useState<TokenBooking | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!normalizedToken) {
        setMessage('Este enlace no es valido o esta incompleto.');
        setLoading(false);
        return;
      }

      const { data, error: rpcError } = await supabase.rpc('get_booking_by_token', { p_token: normalizedToken });

      if (rpcError) {
        setMessage(toUserMessage(rpcError.message));
      } else {
        const parsed = (data || null) as TokenBooking | null;
        if (!parsed) {
          setMessage('No encontramos una cita asociada a este enlace.');
        }
        setBooking(parsed);
      }
      setLoading(false);
    };
    void load();
  }, [normalizedToken]);

  const handleCancel = async () => {
    if (!normalizedToken) return;
    setCancelling(true);
    setMessage(null);

    const { error: rpcError } = await supabase.rpc('cancel_booking_by_token', {
      p_token: normalizedToken,
      p_reason: 'Cancelado por cliente',
    });

    setCancelling(false);

    if (rpcError) {
      setMessage(toUserMessage(rpcError.message));
      return;
    }

    setDone(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-white px-4">
        <div className="flex items-center gap-2 rounded-full border bg-white px-4 py-2 text-sm text-slate-700 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando tu reserva...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <Card className="overflow-hidden border-slate-200 shadow-xl">
          <div className="h-2 bg-gradient-to-r from-rose-500 via-orange-500 to-amber-400" />
          <CardContent className="space-y-5 p-7">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Cancelar cita</h1>
            <p className="text-sm leading-6 text-slate-600">
              Revisa los datos de tu reserva antes de confirmar. Esta accion liberara tu horario.
            </p>

            {message ? (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-sm">{message}</p>
              </div>
            ) : null}

            {booking ? (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="flex items-center gap-2 text-slate-700">
                  <Store className="h-4 w-4 text-slate-500" />
                  <span>{booking.business_name || 'Negocio'}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700">
                  <Scissors className="h-4 w-4 text-slate-500" />
                  <span>{booking.service_name || 'Servicio'}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700">
                  <Calendar className="h-4 w-4 text-slate-500" />
                  <span>{booking.date || '-'} a las {booking.start_time || '-'}</span>
                </div>
              </div>
            ) : null}

            {done ? (
              <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-sm">Tu cita fue cancelada correctamente.</p>
              </div>
            ) : confirmingCancel ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">Esta accion no se puede deshacer. Quieres continuar?</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setConfirmingCancel(false)}
                    disabled={cancelling}
                  >
                    Volver
                  </Button>
                  <Button className="w-full" onClick={handleCancel} disabled={cancelling || !booking}>
                    {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Confirmar cancelacion
                  </Button>
                </div>
              </div>
            ) : (
              <Button className="w-full" onClick={() => setConfirmingCancel(true)} disabled={!booking}>
                Quiero cancelar mi cita
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
