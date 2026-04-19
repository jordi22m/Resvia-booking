import { useState } from 'react';
import { format, addDays, startOfWeek, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAppointments, useAppointmentsRealtime, useCreateAppointment } from '@/hooks/use-appointments';
import { useCustomers } from '@/hooks/use-customers';
import { useServices } from '@/hooks/use-services';
import { useStaff } from '@/hooks/use-staff';
import { useToast } from '@/hooks/use-toast';

type ViewMode = 'day' | 'week';
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8);

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: appointments, isLoading } = useAppointments();
  const { data: customers } = useCustomers();
  const { data: services } = useServices();
  const { data: staff } = useStaff();
  const createAppointment = useCreateAppointment();
  useAppointmentsRealtime();

  const [newApt, setNewApt] = useState({ customer_id: '', service_id: '', staff_id: '', date: format(new Date(), 'yyyy-MM-dd'), start_time: '09:00', notes: '' });

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const displayDays = viewMode === 'day' ? [currentDate] : weekDays;

  const navigate = (dir: number) => {
    setCurrentDate(prev => addDays(prev, dir * (viewMode === 'day' ? 1 : 7)));
  };

  const getAppointmentsForDay = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return (appointments || []).filter(a => a.date === dateStr);
  };

  const parseTimeToMinutes = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  };

  type AppointmentItem = (typeof appointments extends Array<infer U> ? U : never);
  type AppointmentLayoutItem = AppointmentItem & { column: number; totalColumns: number };

  const getAppointmentLayout = (appts: AppointmentItem[] | undefined): AppointmentLayoutItem[] => {
    const sorted = [...(appts || [])].sort((a, b) => {
      const startA = parseTimeToMinutes(a.start_time || '00:00');
      const startB = parseTimeToMinutes(b.start_time || '00:00');
      if (startA !== startB) return startA - startB;
      return parseTimeToMinutes(a.end_time || '00:00') - parseTimeToMinutes(b.end_time || '00:00');
    });

    const columns: AppointmentItem[][] = [];
    const layoutItems: AppointmentLayoutItem[] = [];

    for (const apt of sorted) {
      const start = parseTimeToMinutes(apt.start_time || '00:00');
      const end = parseTimeToMinutes(apt.end_time || '00:00');
      let assignedColumn = -1;

      for (let col = 0; col < columns.length; col++) {
        const lastEvent = columns[col][columns[col].length - 1];
        const lastEnd = parseTimeToMinutes(lastEvent.end_time || '00:00');
        if (lastEnd <= start) {
          assignedColumn = col;
          break;
        }
      }

      if (assignedColumn === -1) {
        assignedColumn = columns.length;
        columns.push([]);
      }

      columns[assignedColumn].push(apt);
      layoutItems.push({ ...apt, column: assignedColumn, totalColumns: 0 });
    }

    const totalColumns = columns.length;
    return layoutItems.map(item => ({ ...item, totalColumns }));
  };

  const handleCreateAppointment = async () => {
    if (!newApt.customer_id || !newApt.service_id) return;
    const service = (services || []).find(s => s.id === newApt.service_id);
    const duration = service?.duration || 30;
    const [h, m] = newApt.start_time.split(':').map(Number);
    const endMinutes = h * 60 + m + duration;
    const end_time = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;

    try {
      await createAppointment.mutateAsync({
        ...newApt,
        end_time,
        staff_id: newApt.staff_id || null,
        status: 'pending',
      });
      toast({ title: 'Cita creada' });
      setDialogOpen(false);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 lg:px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => navigate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold text-foreground">
            {viewMode === 'day'
              ? format(currentDate, "EEEE, d 'de' MMMM yyyy", { locale: es })
              : `${format(weekDays[0], 'd MMM', { locale: es })} – ${format(weekDays[6], "d MMM yyyy", { locale: es })}`
            }
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())} translate="no">
            <span>Hoy</span>
          </Button>
          <div className="flex border border-border rounded-lg overflow-hidden">
            <button onClick={() => setViewMode('day')} className={cn("px-3 py-1.5 text-xs font-medium transition-colors", viewMode === 'day' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}>Día</button>
            <button onClick={() => setViewMode('week')} className={cn("px-3 py-1.5 text-xs font-medium transition-colors", viewMode === 'week' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary')}>Semana</button>
          </div>
          <Button size="sm" onClick={() => { setNewApt(p => ({ ...p, date: format(currentDate, 'yyyy-MM-dd') })); setDialogOpen(true); }} translate="no">
            <Plus className="h-4 w-4 mr-1.5" />
            <span>Cita</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="flex min-w-[600px]">
          <div className="w-16 shrink-0 border-r border-border">
            <div className="h-12 border-b border-border" />
            {HOURS.map(hour => (
              <div key={hour} className="h-16 border-b border-border flex items-start justify-end pr-2 pt-0.5">
                <span className="text-[10px] text-muted-foreground">{hour.toString().padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>

          {displayDays.map(day => {
            const dayAppointments = getAppointmentsForDay(day);
            const isToday = isSameDay(day, new Date());
            return (
              <div key={day.toISOString()} className="flex-1 min-w-[120px] border-r border-border last:border-r-0">
                <div className={cn("h-12 border-b border-border flex flex-col items-center justify-center", isToday && "bg-accent")}>
                  <span className="text-[10px] text-muted-foreground uppercase">{format(day, 'EEE', { locale: es })}</span>
                  <span className={cn("text-sm font-medium", isToday ? "text-accent-foreground" : "text-foreground")}>{format(day, 'd')}</span>
                </div>
                <div className="relative">
                  {HOURS.map(hour => (
                    <div key={hour} className="h-16 border-b border-border hover:bg-secondary/30 transition-colors" />
                  ))}
                  {getAppointmentLayout(dayAppointments).map(apt => {
                    const [startH, startM] = (apt.start_time || '09:00').split(':').map(Number);
                    const [endH, endM] = (apt.end_time || '09:30').split(':').map(Number);
                    const top = (startH - 8) * 64 + (startM / 60) * 64;
                    const height = ((endH - startH) * 60 + (endM - startM)) / 60 * 64;
                    const customer = (customers || []).find(c => c.id === apt.customer_id);
                    const service = (services || []).find(s => s.id === apt.service_id);
                    const member = (staff || []).find(s => s.id === apt.staff_id);
                    const showServiceName = height >= 30;
                    const width = `calc(${100 / Math.max(apt.totalColumns, 1)}% - 6px)`;
                    const left = `calc(${(100 / Math.max(apt.totalColumns, 1)) * apt.column}% + 4px)`;

                    return (
                      <div
                        key={apt.id}
                        className="absolute rounded-md px-2 py-0.5 text-[10px] cursor-pointer overflow-hidden border border-border/50 shadow-sm"
                        style={{
                          top: `${top}px`,
                          left,
                          width,
                          height: `${Math.max(height, 32)}px`,
                          backgroundColor: member?.color ? `${member.color}20` : 'hsl(var(--accent))',
                          borderLeftWidth: '3px',
                          borderLeftColor: member?.color || 'hsl(var(--primary))',
                          lineHeight: '14px',
                        }}
                      >
                        <p className="font-medium text-foreground truncate">{customer?.name || 'Cliente'}</p>
                        {showServiceName && <p className="text-muted-foreground truncate">{service?.name}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva cita</DialogTitle>
            <DialogDescription className="sr-only">
              Crea una nueva cita seleccionando cliente, servicio, profesional, fecha y hora.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <select
                value={newApt.customer_id}
                onChange={e => setNewApt(p => ({ ...p, customer_id: e.target.value }))}
                className={`flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${newApt.customer_id ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                <option value="" disabled>Seleccionar cliente</option>
                {(customers || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Servicio *</Label>
              <select
                value={newApt.service_id}
                onChange={e => setNewApt(p => ({ ...p, service_id: e.target.value }))}
                className={`flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${newApt.service_id ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                <option value="" disabled>Seleccionar servicio</option>
                {(services || []).map(s => <option key={s.id} value={s.id}>{s.name} ({s.duration} min)</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Profesional</Label>
              <select
                value={newApt.staff_id}
                onChange={e => setNewApt(p => ({ ...p, staff_id: e.target.value }))}
                className={`flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${newApt.staff_id ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                <option value="">Sin preferencia</option>
                {(staff || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Fecha</Label>
                <Input type="date" value={newApt.date} onChange={e => setNewApt(p => ({ ...p, date: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Hora</Label>
                <Input type="time" value={newApt.start_time} onChange={e => setNewApt(p => ({ ...p, start_time: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} translate="no">
              <span>Cancelar</span>
            </Button>
            <Button onClick={handleCreateAppointment} disabled={createAppointment.isPending} translate="no">
              <span className="inline-flex h-4 w-4 items-center justify-center">
                {createAppointment.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              </span>
              <span>Crear cita</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
