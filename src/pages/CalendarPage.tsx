import { useState, useMemo } from 'react';
import { format, addDays, startOfWeek, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, Loader2, Calendar, Clock, User, Briefcase, FileText, AlertCircle, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useAppointments, useAppointmentsRealtime, useCreateAppointment, useUpdateAppointment, useDeleteAppointment } from '@/hooks/use-appointments';
import { useCustomers } from '@/hooks/use-customers';
import { useServices } from '@/hooks/use-services';
import { useStaff } from '@/hooks/use-staff';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useAvailabilityByUserId } from '@/hooks/use-availability';
import { CalendarTimeGrid } from '@/components/CalendarTimeGrid';
import { useCalendarBlocksByUserId, useCreateCalendarBlock, useDeleteCalendarBlock, useUpdateCalendarBlock, type CalendarBlock, type CalendarBlockType } from '@/hooks/use-calendar-blocks';

type ViewMode = 'day' | 'week';

function getAppointmentStatusClasses(status?: string) {
  switch (status) {
    case 'confirmed':
      return { badge: 'Confirmada', color: 'text-emerald-700 dark:text-emerald-400' };
    case 'cancelled':
      return { badge: 'Cancelada', color: 'text-red-700 dark:text-red-400' };
    case 'pending':
    default:
      return { badge: 'Pendiente', color: 'text-amber-700 dark:text-amber-400' };
  }
}

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAppointmentId, setEditingAppointmentId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<CalendarBlock | null>(null);
  const [blockForm, setBlockForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    start_time: '09:00',
    end_time: '10:00',
    type: 'blocked' as CalendarBlockType,
    reason: '',
  });
  const [selectedStaffFilter, setSelectedStaffFilter] = useState<string | null>(null);
  const { toast } = useToast();

  const { user } = useAuth();
  const { data: appointments, isLoading } = useAppointments();
  const { data: customers } = useCustomers();
  const { data: services } = useServices();
  const { data: staff } = useStaff();
  const { data: availability } = useAvailabilityByUserId(user?.id);
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const rangeStart = viewMode === 'day' ? currentDate : weekStart;
  const rangeEnd = viewMode === 'day' ? currentDate : addDays(weekStart, 6);
  const { data: calendarBlocks } = useCalendarBlocksByUserId(user?.id, rangeStart, rangeEnd);
  const createCalendarBlock = useCreateCalendarBlock(user?.id, rangeStart, rangeEnd);
  const updateCalendarBlock = useUpdateCalendarBlock(user?.id, rangeStart, rangeEnd);
  const deleteCalendarBlock = useDeleteCalendarBlock(user?.id, rangeStart, rangeEnd);
  const createAppointment = useCreateAppointment();
  const updateAppointment = useUpdateAppointment();
  const deleteAppointment = useDeleteAppointment();
  useAppointmentsRealtime();

  const [newApt, setNewApt] = useState({ 
    customer_id: '', 
    service_id: '', 
    staff_id: '', 
    date: format(new Date(), 'yyyy-MM-dd'), 
    start_time: '09:00', 
    notes: '' 
  });

  const navigate = (dir: number) => {
    setCurrentDate(prev => addDays(prev, dir * (viewMode === 'day' ? 1 : 7)));
  };

  const handleSlotClick = (day: Date, hour: number) => {
    setEditingAppointmentId(null);
    setNewApt(prev => ({
      ...prev,
      date: format(day, 'yyyy-MM-dd'),
      start_time: `${hour.toString().padStart(2, '0')}:00`,
      customer_id: '',
      service_id: '',
      staff_id: '',
    }));
    setDialogOpen(true);
  };

  const toLocalDateTime = (date: Date, hour: number, minute = 0, second = 0) => {
    const base = format(date, 'yyyy-MM-dd');
    return `${base} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`;
  };

  const splitDateTime = (value: string) => {
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const dateObj = new Date(normalized);
    const date = format(dateObj, 'yyyy-MM-dd');
    const time = format(dateObj, 'HH:mm');
    return { date, time };
  };

  const composeDateTime = (date: string, time: string) => `${date} ${time}:00`;

  const handleSlotAction = async (payload: { date: Date; hour: number; action: 'booking' | 'blocked' | 'closed' }) => {
    if (payload.action === 'booking') {
      handleSlotClick(payload.date, payload.hour);
      return;
    }

    try {
      if (payload.action === 'blocked') {
        await createCalendarBlock.mutateAsync({
          start_time: toLocalDateTime(payload.date, payload.hour, 0, 0),
          end_time: toLocalDateTime(payload.date, payload.hour + 1, 0, 0),
          type: 'blocked',
          reason: 'Bloqueo manual desde calendario',
        });
        toast({ title: '✓ Horario bloqueado' });
      }

      if (payload.action === 'closed') {
        await createCalendarBlock.mutateAsync({
          start_time: toLocalDateTime(payload.date, 0, 0, 0),
          end_time: toLocalDateTime(payload.date, 23, 59, 59),
          type: 'closed',
          reason: 'Día cerrado manualmente',
        });
        toast({ title: '✓ Día cerrado' });
      }
    } catch (error: any) {
      toast({
        title: 'No se pudo crear el bloqueo',
        description: error?.message || 'Intenta nuevamente.',
        variant: 'destructive',
      });
    }
  };

  const handleEditAppointment = (apt: any) => {
    setEditingAppointmentId(apt.id);
    setNewApt({
      customer_id: apt.customer_id,
      service_id: apt.service_id,
      staff_id: apt.staff_id || '',
      date: apt.date,
      start_time: apt.start_time,
      notes: apt.notes || '',
    });
    setDialogOpen(true);
  };

  const handleEditBlock = (block: CalendarBlock) => {
    const start = splitDateTime(block.start_time);
    const end = splitDateTime(block.end_time);
    setSelectedBlock(block);
    setBlockForm({
      date: start.date,
      start_time: start.time,
      end_time: end.time,
      type: block.type,
      reason: block.reason || '',
    });
    setBlockDialogOpen(true);
  };

  const handleSaveBlock = async () => {
    if (!selectedBlock) return;

    try {
      const startDateTime = composeDateTime(blockForm.date, blockForm.start_time);
      const endDateTime = composeDateTime(blockForm.date, blockForm.end_time);

      if (blockForm.start_time >= blockForm.end_time) {
        toast({
          title: 'Horario invalido',
          description: 'La hora de fin debe ser mayor que la hora de inicio',
          variant: 'destructive',
        });
        return;
      }

      await updateCalendarBlock.mutateAsync({
        id: selectedBlock.id,
        start_time: startDateTime,
        end_time: endDateTime,
        type: blockForm.type,
        reason: blockForm.reason || null,
      });

      toast({ title: '✓ Bloqueo actualizado' });
      setBlockDialogOpen(false);
      setSelectedBlock(null);
    } catch (error: any) {
      toast({
        title: 'No se pudo actualizar el bloqueo',
        description: error?.message || 'Intenta nuevamente.',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteBlock = async () => {
    if (!selectedBlock) return;

    try {
      await deleteCalendarBlock.mutateAsync(selectedBlock.id);
      toast({ title: '✓ Bloqueo eliminado' });
      setBlockDialogOpen(false);
      setSelectedBlock(null);
    } catch (error: any) {
      toast({
        title: 'No se pudo eliminar el bloqueo',
        description: error?.message || 'Intenta nuevamente.',
        variant: 'destructive',
      });
    }
  };

  const handleSaveAppointment = async () => {
    if (!newApt.customer_id || !newApt.service_id) {
      toast({
        title: 'Campos requeridos',
        description: 'Por favor selecciona cliente y servicio',
        variant: 'destructive'
      });
      return;
    }

    const service = (services || []).find(s => s.id === newApt.service_id);
    const duration = service?.duration || 30;
    const [h, m] = newApt.start_time.split(':').map(Number);
    const endMinutes = h * 60 + m + duration;
    const end_time = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;

    try {
      if (editingAppointmentId) {
        await updateAppointment.mutateAsync({
          id: editingAppointmentId,
          customer_id: newApt.customer_id,
          service_id: newApt.service_id,
          staff_id: newApt.staff_id || null,
          date: newApt.date,
          start_time: newApt.start_time,
          end_time,
          notes: newApt.notes || null,
        });
        toast({ title: '✓ Cita actualizada' });
      } else {
        await createAppointment.mutateAsync({
          ...newApt,
          end_time,
          staff_id: newApt.staff_id || null,
          status: 'pending',
        });
        toast({ title: '✓ Cita creada' });
      }
      setDialogOpen(false);
      setEditingAppointmentId(null);
    } catch (e: any) {
      toast({ 
        title: editingAppointmentId ? 'Error al actualizar' : 'Error al crear cita',
        description: e.message, 
        variant: 'destructive' 
      });
    }
  };

  const handleDeleteAppointment = async () => {
    if (!editingAppointmentId) return;
    
    try {
      await deleteAppointment.mutateAsync(editingAppointmentId);
      toast({ title: '✓ Cita eliminada' });
      setDialogOpen(false);
      setEditingAppointmentId(null);
      setDeleteConfirmOpen(false);
    } catch (e: any) {
      toast({ 
        title: 'Error al eliminar',
        description: e.message, 
        variant: 'destructive' 
      });
    }
  };

  const selectedAppointment = useMemo(() => {
    if (!editingAppointmentId) return null;
    return (appointments || []).find(a => a.id === editingAppointmentId);
  }, [editingAppointmentId, appointments]);

  const selectedCustomer = useMemo(() => {
    return (customers || []).find(c => c.id === newApt.customer_id);
  }, [newApt.customer_id, customers]);

  const selectedService = useMemo(() => {
    return (services || []).find(s => s.id === newApt.service_id);
  }, [newApt.service_id, services]);

  const selectedStaff = useMemo(() => {
    return (staff || []).find(s => s.id === newApt.staff_id);
  }, [newApt.staff_id, staff]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const today = new Date();
  const isCurrentWeek = isSameDay(today, currentDate) || 
    (isSameDay(addDays(today, 7), currentDate));

  return (
    <div className="flex flex-col h-full bg-slate-50/80 dark:bg-slate-950/50">
      {/* Enhanced Header */}
      <div className="border-b border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/90 shadow-sm backdrop-blur-md">
        <div className="px-4 lg:px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {/* Navigation */}
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="icon" 
                onClick={() => navigate(-1)}
                className="border-slate-300/90 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-sm"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button 
                variant="outline" 
                size="icon" 
                onClick={() => navigate(1)}
                className="border-slate-300/90 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-sm"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button 
                variant={isCurrentWeek ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCurrentDate(new Date())}
              >
                <Calendar className="h-3.5 w-3.5 mr-1.5" />
                Hoy
              </Button>
            </div>

            {/* Title */}
            <h2 className="text-lg font-semibold text-foreground">
              {viewMode === 'day'
                ? format(currentDate, "EEEE, d 'de' MMMM yyyy", { locale: es })
                : `${format(weekDays[0], 'd MMM', { locale: es })} – ${format(weekDays[6], "d MMM yyyy", { locale: es })}`
              }
            </h2>

            {/* Controls */}
            <div className="flex items-center gap-2">
              {/* Staff Filter */}
              {staff && staff.length > 0 && (
                <select
                  value={selectedStaffFilter || ''}
                  onChange={e => setSelectedStaffFilter(e.target.value || null)}
                  className="px-3 py-1.5 text-sm border border-slate-300/80 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
                >
                  <option value="">Todos los trabajadores</option>
                  {staff.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}

              <div className="flex border border-slate-300/80 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-100/80 dark:bg-slate-800/70 shadow-sm">
                <button 
                  onClick={() => setViewMode('day')} 
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-all",
                    viewMode === 'day' 
                      ? 'bg-primary text-primary-foreground shadow-sm' 
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Día
                </button>
                <div className="w-px bg-border" />
                <button 
                  onClick={() => setViewMode('week')} 
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium transition-all",
                    viewMode === 'week' 
                      ? 'bg-primary text-primary-foreground shadow-sm' 
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  Semana
                </button>
              </div>
              <Button 
                size="sm" 
                onClick={() => { 
                  setEditingAppointmentId(null); 
                  setNewApt(p => ({ ...p, date: format(currentDate, 'yyyy-MM-dd'), customer_id: '', service_id: '', staff_id: '' })); 
                  setDialogOpen(true); 
                }}
                className="shadow-sm hover:shadow-md"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Nueva cita
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <CalendarTimeGrid
        currentDate={currentDate}
        viewMode={viewMode}
        appointments={(appointments || []).filter(apt => {
          if (!selectedStaffFilter) return true;
          return apt.staff_id === selectedStaffFilter;
        })}
        calendarBlocks={calendarBlocks || []}
        onSlotClick={handleSlotClick}
        onSlotAction={handleSlotAction}
        onAppointmentClick={handleEditAppointment}
        onBlockClick={handleEditBlock}
        availability={availability}
        customers={customers}
        services={services}
        staff={staff}
      />

      <Dialog open={blockDialogOpen} onOpenChange={(open) => {
        setBlockDialogOpen(open);
        if (!open) setSelectedBlock(null);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar bloqueo</DialogTitle>
            <DialogDescription>
              Modifica o elimina un bloqueo de horario o de dia.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <select
                value={blockForm.type}
                onChange={(e) => setBlockForm((p) => ({ ...p, type: e.target.value as CalendarBlockType }))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="blocked">Bloqueo de horario</option>
                <option value="closed">Dia cerrado</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Fecha</Label>
              <Input
                type="date"
                value={blockForm.date}
                onChange={(e) => setBlockForm((p) => ({ ...p, date: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Inicio</Label>
                <Input
                  type="time"
                  value={blockForm.start_time}
                  onChange={(e) => setBlockForm((p) => ({ ...p, start_time: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Fin</Label>
                <Input
                  type="time"
                  value={blockForm.end_time}
                  onChange={(e) => setBlockForm((p) => ({ ...p, end_time: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Motivo</Label>
              <Textarea
                rows={2}
                value={blockForm.reason}
                onChange={(e) => setBlockForm((p) => ({ ...p, reason: e.target.value }))}
                placeholder="Ej: descanso, comida, reunion, dia libre"
              />
            </div>
          </div>

          <DialogFooter className="justify-between gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteBlock}
              disabled={deleteCalendarBlock.isPending || updateCalendarBlock.isPending}
            >
              {deleteCalendarBlock.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Quitar bloqueo
            </Button>
            <Button
              type="button"
              onClick={handleSaveBlock}
              disabled={updateCalendarBlock.isPending || deleteCalendarBlock.isPending}
            >
              {updateCalendarBlock.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enhanced Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) setEditingAppointmentId(null);
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingAppointmentId ? (
                <>
                  <Calendar className="h-5 w-5 text-primary" />
                  Editar cita
                </>
              ) : (
                <>
                  <Plus className="h-5 w-5 text-primary" />
                  Nueva cita
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {editingAppointmentId
                ? 'Actualiza los detalles de la cita existente'
                : 'Crea una nueva cita completando todos los campos requeridos'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Form Fields */}
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  Cliente <span className="text-destructive">*</span>
                </Label>
                <select
                  value={newApt.customer_id}
                  onChange={e => setNewApt(p => ({ ...p, customer_id: e.target.value }))}
                  className={cn(
                    "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    newApt.customer_id ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  <option value="">Seleccionar cliente</option>
                  {(customers || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  Servicio <span className="text-destructive">*</span>
                </Label>
                <select
                  value={newApt.service_id}
                  onChange={e => setNewApt(p => ({ ...p, service_id: e.target.value }))}
                  className={cn(
                    "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    newApt.service_id ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  <option value="">Seleccionar servicio</option>
                  {(services || []).map(s => <option key={s.id} value={s.id}>{s.name} ({s.duration} min)</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  Profesional
                </Label>
                <select
                  value={newApt.staff_id}
                  onChange={e => setNewApt(p => ({ ...p, staff_id: e.target.value }))}
                  className={cn(
                    "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    newApt.staff_id ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  <option value="">Sin preferencia</option>
                  {(staff || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    Fecha
                  </Label>
                  <Input type="date" value={newApt.date} onChange={e => setNewApt(p => ({ ...p, date: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    Hora
                  </Label>
                  <Input type="time" value={newApt.start_time} onChange={e => setNewApt(p => ({ ...p, start_time: e.target.value }))} />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Notas
                </Label>
                <Textarea
                  placeholder="Añade cualquier información adicional..."
                  value={newApt.notes}
                  onChange={e => setNewApt(p => ({ ...p, notes: e.target.value }))}
                  rows={3}
                  className="text-sm"
                />
              </div>
            </div>

            {/* Summary Preview */}
            {selectedCustomer && selectedService && (
              <Card className="bg-muted/50 border-muted">
                <CardContent className="p-3 space-y-2 text-sm">
                  <div className="flex justify-between items-start">
                    <span className="font-medium text-foreground">Resumen:</span>
                  </div>
                  <div className="space-y-1 font-medium">
                    <p className="flex items-center gap-2">
                      <User className="h-3 w-3" /> {selectedCustomer.name}
                    </p>
                    <p className="flex items-center gap-2">
                      <Briefcase className="h-3 w-3" /> {selectedService.name} ({selectedService.duration} min)
                    </p>
                    {selectedStaff && (
                      <p className="flex items-center gap-2">
                        <User className="h-3 w-3" /> {selectedStaff.name}
                      </p>
                    )}
                    <p className="flex items-center gap-2">
                      <Calendar className="h-3 w-3" /> {format(new Date(newApt.date), 'd MMMM yyyy', { locale: es })}
                    </p>
                    <p className="flex items-center gap-2">
                      <Clock className="h-3 w-3" /> {newApt.start_time}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Warning if Delete is selected */}
            {deleteConfirmOpen && (
              <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20">
                <CardContent className="p-3 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-900 dark:text-red-200">¿Eliminar esta cita?</p>
                    <p className="text-sm text-red-800 dark:text-red-300 mt-1">
                      Esta acción no se puede deshacer. El cliente recibirá una notificación.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <DialogFooter className="flex gap-2 sm:justify-between">
            {editingAppointmentId && !deleteConfirmOpen && (
              <Button 
                variant="destructive" 
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={deleteAppointment.isPending}
              >
                Eliminar
              </Button>
            )}
            
            <div className="flex gap-2 sm:ml-auto">
              {deleteConfirmOpen && (
                <>
                  <Button 
                    variant="outline" 
                    onClick={() => setDeleteConfirmOpen(false)}
                    disabled={deleteAppointment.isPending}
                  >
                    Cancelar eliminación
                  </Button>
                  <Button 
                    variant="destructive"
                    onClick={handleDeleteAppointment}
                    disabled={deleteAppointment.isPending}
                  >
                    {deleteAppointment.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Confirmar eliminación
                  </Button>
                </>
              )}
              {!deleteConfirmOpen && (
                <>
                  <Button 
                    variant="outline" 
                    onClick={() => setDialogOpen(false)}
                    disabled={createAppointment.isPending || updateAppointment.isPending}
                  >
                    Cancelar
                  </Button>
                  <Button 
                    onClick={handleSaveAppointment} 
                    disabled={
                      createAppointment.isPending || 
                      updateAppointment.isPending ||
                      !newApt.customer_id ||
                      !newApt.service_id
                    }
                  >
                    {(createAppointment.isPending || updateAppointment.isPending) && (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    )}
                    {editingAppointmentId ? 'Guardar cambios' : 'Crear cita'}
                  </Button>
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
