import { CalendarDays, Users, TrendingUp, AlertTriangle, Plus, Copy, Clock, CheckCircle2, XCircle, Trash2, Info, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAppointments, useAppointmentsRealtime, useDeleteAppointment, useUpdateAppointment, type Appointment } from '@/hooks/use-appointments';
import { useCustomers } from '@/hooks/use-customers';
import { useServices } from '@/hooks/use-services';
import { useStaff } from '@/hooks/use-staff';
import { useProfile } from '@/hooks/use-profile';

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  confirmed: { label: 'Confirmada', variant: 'default' },
  pending: { label: 'Pendiente', variant: 'secondary' },
  canceled: { label: 'Cancelada', variant: 'destructive' },
  completed: { label: 'Completada', variant: 'outline' },
  noshow: { label: 'No asistió', variant: 'destructive' },
  rescheduled: { label: 'Reprogramada', variant: 'secondary' },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: profile } = useProfile();
  const { data: appointments, isLoading: loadingApts } = useAppointments();
  const { data: customers } = useCustomers();
  const { data: services } = useServices();
  const { data: staff } = useStaff();
  const updateAppointment = useUpdateAppointment();
  const deleteAppointment = useDeleteAppointment();
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  useAppointmentsRealtime();

  const today = format(new Date(), 'yyyy-MM-dd');
  const todayAppointments = (appointments || []).filter(a => a.date === today);
  const confirmedCount = todayAppointments.filter(a => a.status === 'confirmed').length;
  const pendingCount = todayAppointments.filter(a => a.status === 'pending').length;

  const copyBookingLink = () => {
    const slug = profile?.slug || 'mi-negocio';
    navigator.clipboard.writeText(`${window.location.origin}/book/${slug}`);
    toast({ title: '¡Link de reserva copiado!' });
  };

  const stats = [
    { label: 'Citas de hoy', value: todayAppointments.length, icon: CalendarDays, color: 'text-primary' },
    { label: 'Confirmadas', value: confirmedCount, icon: CheckCircle2, color: 'text-success' },
    { label: 'Pendientes', value: pendingCount, icon: Clock, color: 'text-warning' },
    { label: 'Total clientes', value: (customers || []).length, icon: Users, color: 'text-info' },
  ];

  if (loadingApts) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Panel</h1>
          <p className="text-sm text-muted-foreground">{format(new Date(), "EEEE, d 'de' MMMM yyyy", { locale: es })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={copyBookingLink}>
            <Copy className="h-4 w-4 mr-1.5" /> Copiar link de reserva
          </Button>
          <Button size="sm" onClick={() => navigate('/calendar')}>
            <Plus className="h-4 w-4 mr-1.5" /> Nueva cita
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(stat => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-semibold mt-1">{stat.value}</p>
                </div>
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center bg-secondary ${stat.color}`}>
                  <stat.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Agenda de hoy</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/calendar')}>Ver calendario</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {todayAppointments.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No hay citas para hoy</div>
          ) : (
            <div className="divide-y divide-border">
              {todayAppointments.map(apt => {
                const customer = (customers || []).find(c => c.id === apt.customer_id);
                const service = (services || []).find(s => s.id === apt.service_id);
                const member = (staff || []).find(s => s.id === apt.staff_id);
                const sc = statusConfig[apt.status] || statusConfig.pending;
                return (
                  <div key={apt.id} className="flex flex-col gap-3 px-6 py-3.5 hover:bg-secondary/50 transition-colors">
                    <div className="flex items-center gap-4 w-full">
                      <div className="w-16 text-center">
                        <p className="text-sm font-medium text-foreground">{apt.start_time?.slice(0, 5)}</p>
                        <p className="text-xs text-muted-foreground">{apt.end_time?.slice(0, 5)}</p>
                      </div>
                      <div className="h-10 w-1 rounded-full" style={{ backgroundColor: member?.color || 'hsl(var(--primary))' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{customer?.name || 'Cliente'}</p>
                        <p className="text-xs text-muted-foreground">{service?.name} · {member?.name}</p>
                      </div>
                      <Badge variant={sc.variant} translate="no">{sc.label}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setSelectedAppointment(apt); setDetailsOpen(true); }} translate="no">
                        <Info className="h-3.5 w-3.5 mr-1" /> Detalles
                      </Button>
                      <Button size="sm" variant="ghost" onClick={async () => {
                        if (!window.confirm('¿Cancelar esta cita?')) return;
                        try {
                          await updateAppointment.mutateAsync({ id: apt.id, status: 'canceled' });
                          toast({ title: 'Cita cancelada' });
                        } catch (error: any) {
                          toast({ title: 'Error al cancelar', description: error.message, variant: 'destructive' });
                        }
                      }} translate="no">
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Cancelar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Detalles de la cita</DialogTitle>
            <DialogDescription>
              Ver información completa de la cita y opciones para cancelar o eliminar.
            </DialogDescription>
          </DialogHeader>
          {selectedAppointment ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="text-sm font-medium text-foreground">{(customers || []).find(c => c.id === selectedAppointment.customer_id)?.name || 'Cliente'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Servicio</p>
                  <p className="text-sm font-medium text-foreground">{(services || []).find(s => s.id === selectedAppointment.service_id)?.name || 'Servicio'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Profesional</p>
                  <p className="text-sm font-medium text-foreground">{(staff || []).find(s => s.id === selectedAppointment.staff_id)?.name || 'Sin preferencia'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Estado</p>
                  <p className="text-sm font-medium text-foreground" translate="no">{statusConfig[selectedAppointment.status]?.label || selectedAppointment.status}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Fecha</p>
                  <p className="text-sm font-medium text-foreground">{selectedAppointment.date}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Hora</p>
                  <p className="text-sm font-medium text-foreground">{selectedAppointment.start_time?.slice(0,5)} - {selectedAppointment.end_time?.slice(0,5)}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Notas</p>
                <p className="text-sm text-foreground">{selectedAppointment.notes || 'Sin notas'}</p>
              </div>
            </div>
          ) : (
            <p>No hay cita seleccionada.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsOpen(false)} translate="no">
              Cerrar
            </Button>
            {selectedAppointment && (
              <Button size="sm" variant="destructive" onClick={async () => {
                if (!window.confirm('¿Eliminar esta cita definitivamente?')) return;
                try {
                  await deleteAppointment.mutateAsync(selectedAppointment.id);
                  toast({ title: 'Cita eliminada' });
                  setDetailsOpen(false);
                } catch (error: any) {
                  toast({ title: 'Error al eliminar', description: error.message, variant: 'destructive' });
                }
              }} translate="no">
                <Trash2 className="h-4 w-4 mr-2" /> Eliminar cita
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/services')}>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-accent flex items-center justify-center text-accent-foreground">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium">Gestionar servicios</p>
              <p className="text-xs text-muted-foreground">{(services || []).length} servicios activos</p>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/customers')}>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-accent flex items-center justify-center text-accent-foreground">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium">Agenda de clientes</p>
              <p className="text-xs text-muted-foreground">{(customers || []).length} clientes</p>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/webhooks')}>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-accent flex items-center justify-center text-accent-foreground">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium">Automatizaciones</p>
              <p className="text-xs text-muted-foreground">Webhooks y n8n</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
