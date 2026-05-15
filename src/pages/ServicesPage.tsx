import { useState } from 'react';
import { Clock, DollarSign, Plus, MoreHorizontal, Loader2, Trash2, Pencil } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useServices, useCreateService, useUpdateService, useDeleteService, type Service } from '@/hooks/use-services';
import { useProfile } from '@/hooks/use-profile';
import { useToast } from '@/hooks/use-toast';

type ScheduleMode = 'flexible' | 'strict';

const defaultService = {
  name: '',
  duration: 30,
  slot_step_minutes: null as number | null,
  price: 0,
  description: '',
  category: 'General',
  color: '#94a3b8',
  bookable_online: true,
  show_in_booking: true,
  requires_staff: true,
  buffer_before: 0,
  buffer_after: 0,
};

const scheduleModeOptions: Array<{ label: string; value: ScheduleMode; description: string }> = [
  { label: 'Flexible', value: 'flexible', description: 'Rellena huecos siguiendo la rejilla global del negocio.' },
  { label: 'Estricto', value: 'strict', description: 'Solo permite inicios en horas completas.' },
];

function getScheduleMode(slotStepMinutes: number | null | undefined, businessSlotInterval: number): ScheduleMode {
  if (slotStepMinutes === 60 && businessSlotInterval !== 60) {
    return 'strict';
  }

  return 'flexible';
}

function getSlotStepMinutesForMode(mode: ScheduleMode, businessSlotInterval: number): number {
  return mode === 'strict' ? 60 : businessSlotInterval;
}

export default function ServicesPage() {
  const { data: profile } = useProfile();
  const { data: services, isLoading } = useServices();
  const createService = useCreateService();
  const updateService = useUpdateService();
  const deleteService = useDeleteService();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState(defaultService);
  const businessSlotInterval = Math.max(5, profile?.slot_minutes ?? 30);
  const scheduleMode = getScheduleMode(form.slot_step_minutes, businessSlotInterval);

  const categories = [...new Set((services || []).map(s => s.category || 'General'))];

  const openCreate = () => { setEditing(null); setForm(defaultService); setDialogOpen(true); };
  const openEdit = (s: Service) => {
    setEditing(s);
    setForm({
      name: s.name,
      duration: s.duration,
      slot_step_minutes: s.slot_step_minutes ?? null,
      price: Number(s.price),
      description: s.description || '',
      category: s.category || 'General',
      color: s.color || '#94a3b8',
      bookable_online: s.bookable_online ?? true,
      show_in_booking: s.show_in_booking ?? true,
      requires_staff: s.requires_staff ?? true,
      buffer_before: s.buffer_before || 0,
      buffer_after: s.buffer_after || 0,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;

    if (form.duration <= 0) {
      toast({ title: 'Error', description: 'La duración debe ser mayor que 0.', variant: 'destructive' });
      return;
    }

    if (form.duration % businessSlotInterval !== 0) {
      toast({
        title: 'Duración no válida',
        description: `La duración debe ser múltiplo de ${businessSlotInterval} min para respetar la rejilla global del negocio.`,
        variant: 'destructive',
      });
      return;
    }

    if (scheduleMode === 'strict' && 60 % businessSlotInterval !== 0) {
      toast({
        title: 'Modo estricto no disponible',
        description: `No se puede usar horas completas con una rejilla global de ${businessSlotInterval} min.`,
        variant: 'destructive',
      });
      return;
    }

    const payload = {
      ...form,
      slot_step_minutes: getSlotStepMinutesForMode(scheduleMode, businessSlotInterval),
    };

    try {
      if (editing) {
        await updateService.mutateAsync({ id: editing.id, ...payload });
        toast({ title: 'Servicio actualizado' });
      } else {
        await createService.mutateAsync(payload);
        toast({ title: 'Servicio creado' });
      }
      setDialogOpen(false);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteService.mutateAsync(id);
      toast({ title: 'Servicio eliminado' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Servicios</h1>
          <p className="text-sm text-muted-foreground">{(services || []).length} servicios configurados</p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" /> Agregar servicio</Button>
      </div>

      {(services || []).length === 0 ? (
        <div className="p-8 text-center text-muted-foreground">No hay servicios. Crea tu primer servicio.</div>
      ) : categories.map(category => (
        <div key={category} className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{category}</h2>
          <div className="grid gap-3">
            {(services || []).filter(s => (s.category || 'General') === category).map(service => (
              <Card key={service.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${service.color || '#94a3b8'}20` }}>
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: service.color || '#94a3b8' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{service.name}</p>
                      {service.bookable_online && <Badge variant="secondary" className="text-[10px]">Online</Badge>}
                      {(service.show_in_booking ?? true) === false && (
                        <Badge variant="outline" className="text-[10px]">Oculto en booking</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{service.description}</p>
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" /> {service.duration} min
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {getScheduleMode(service.slot_step_minutes, businessSlotInterval) === 'strict' ? 'modo estricto' : 'modo flexible'}
                    </span>
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <DollarSign className="h-3.5 w-3.5" /> {Number(service.price) > 0 ? `€${service.price}` : 'Gratis'}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(service)}><Pencil className="h-4 w-4 mr-2" /> Editar</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(service.id)}><Trash2 className="h-4 w-4 mr-2" /> Eliminar</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>{editing ? 'Editar servicio' : 'Nuevo servicio'}</DialogTitle>
            <DialogDescription className="sr-only">
              {editing ? 'Edita los datos del servicio seleccionado.' : 'Crea un nuevo servicio para tu negocio.'}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(90vh-170px)] space-y-4 overflow-y-auto px-6 py-4">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Ej: Corte de pelo" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Duración (min)</Label>
                <Input type="number" value={form.duration} onChange={e => setForm(p => ({ ...p, duration: +e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Modo de agenda</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  value={scheduleMode}
                  onChange={e => {
                    const mode = e.target.value as ScheduleMode;
                    setForm(p => ({ ...p, slot_step_minutes: getSlotStepMinutesForMode(mode, businessSlotInterval) }));
                  }}
                >
                  {scheduleModeOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {scheduleModeOptions.find(option => option.value === scheduleMode)?.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  Rejilla global: cada {businessSlotInterval} min. Duración del servicio: múltiplos de {businessSlotInterval} min.
                </p>
                {scheduleMode === 'strict' ? (
                  <p className="text-xs text-muted-foreground">Este servicio solo arrancará en horas completas.</p>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Precio (€)</Label>
              <Input type="number" step="0.01" value={form.price} onChange={e => setForm(p => ({ ...p, price: +e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Categoría</Label>
              <Input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="General" />
            </div>
            <div className="space-y-2">
              <Label>Descripción</Label>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <Input type="color" value={form.color} onChange={e => setForm(p => ({ ...p, color: e.target.value }))} className="h-10 w-20" />
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="show-in-booking">Mostrar a clientes en booking online</Label>
                  <p className="text-xs text-muted-foreground">
                    Si lo desactivas, este servicio sigue funcionando en agenda interna y citas manuales.
                  </p>
                </div>
                <Switch
                  id="show-in-booking"
                  checked={form.show_in_booking}
                  onCheckedChange={(checked) => setForm((prev) => ({ ...prev, show_in_booking: checked }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)} translate="no">
              <span>Cancelar</span>
            </Button>
            <Button onClick={handleSave} disabled={createService.isPending || updateService.isPending} translate="no">
              <span className="inline-flex h-4 w-4 items-center justify-center">
                {(createService.isPending || updateService.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
              </span>
              <span>{editing ? 'Guardar' : 'Crear'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
