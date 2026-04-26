import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Upload } from 'lucide-react';
import { useCreateStaff, useUpdateStaff } from '@/hooks/use-staff';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import type { StaffMember } from '@/hooks/use-staff';
import type { Tables } from '@/integrations/supabase/types';

interface StaffEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: StaffMember | null;
}

type AvailabilityRow = Tables<'availability'>;

type DaySchedule = {
  morning_active: boolean;
  afternoon_active: boolean;
  break_active: boolean;
  morning: { start: string; end: string };
  break: { start: string; end: string };
  afternoon: { start: string; end: string };
};

const DAYS = [
  { id: 'monday', label: 'Lunes', dayOfWeek: 1 },
  { id: 'tuesday', label: 'Martes', dayOfWeek: 2 },
  { id: 'wednesday', label: 'Miercoles', dayOfWeek: 3 },
  { id: 'thursday', label: 'Jueves', dayOfWeek: 4 },
  { id: 'friday', label: 'Viernes', dayOfWeek: 5 },
  { id: 'saturday', label: 'Sabado', dayOfWeek: 6 },
  { id: 'sunday', label: 'Domingo', dayOfWeek: 0 },
];

function createDefaultAvailability(): Record<string, DaySchedule> {
  return Object.fromEntries(
    DAYS.map((day) => [
      day.id,
      {
        morning_active: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(day.id),
        afternoon_active: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(day.id),
        break_active: false,
        morning: { start: '09:00', end: '13:00' },
        break: { start: '13:00', end: '14:00' },
        afternoon: { start: '14:00', end: '18:00' },
      },
    ]),
  );
}

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function StaffEditDialog({ open, onOpenChange, staff }: StaffEditDialogProps) {
  const { toast } = useToast();
  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();

  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoUploadWarning, setPhotoUploadWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: '',
    role: '',
    email: '',
    phone: '',
    color: '#60a5fa',
  });

  const [availability, setAvailability] = useState<Record<string, DaySchedule>>(createDefaultAvailability);

  const isEditing = Boolean(staff);

  const initials = useMemo(() => {
    const source = form.name.trim();
    if (!source) return '?';
    return source
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('');
  }, [form.name]);

  useEffect(() => {
    if (!open) return;

    setSelectedPhoto(null);
    setPhotoUploadWarning(null);
    setPreviewUrl(staff?.avatar_url || '');
    setForm({
      name: staff?.name || '',
      role: staff?.role || '',
      email: staff?.email || '',
      phone: staff?.phone || '',
      color: staff?.color || '#60a5fa',
    });
    setAvailability(createDefaultAvailability());

    if (!staff) return;

    const loadAvailability = async () => {
      const { data, error } = await supabase
        .from('availability')
        .select('*')
        .eq('user_id', staff.user_id)
        .eq('staff_id', staff.id)
        .eq('is_active', true)
        .order('start_time', { ascending: true });

      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        return;
      }

      const base = createDefaultAvailability();

      for (const day of DAYS) {
        const rows = (data || []).filter((r) => r.day_of_week === day.dayOfWeek);
        const morningRow = rows[0];
        const afternoonRow = rows[1];

        if (morningRow) {
          base[day.id].morning_active = true;
          base[day.id].morning = { start: morningRow.start_time, end: morningRow.end_time };
        } else {
          base[day.id].morning_active = false;
        }

        if (afternoonRow) {
          base[day.id].afternoon_active = true;
          base[day.id].afternoon = { start: afternoonRow.start_time, end: afternoonRow.end_time };
        } else {
          base[day.id].afternoon_active = false;
        }

        if (morningRow && afternoonRow && toMinutes(morningRow.end_time) < toMinutes(afternoonRow.start_time)) {
          base[day.id].break_active = true;
          base[day.id].break = {
            start: morningRow.end_time,
            end: afternoonRow.start_time,
          };
        } else {
          base[day.id].break_active = false;
          base[day.id].break = { start: '13:00', end: '14:00' };
        }
      }

      setAvailability(base);
    };

    void loadAvailability();
  }, [open, staff, toast]);

  const updateDay = (dayId: string, next: Partial<DaySchedule>) => {
    setAvailability((prev) => ({
      ...prev,
      [dayId]: { ...prev[dayId], ...next },
    }));
  };

  const updateDayTime = (
    dayId: string,
    block: 'morning' | 'afternoon' | 'break',
    field: 'start' | 'end',
    value: string,
  ) => {
    setAvailability((prev) => ({
      ...prev,
      [dayId]: {
        ...prev[dayId],
        [block]: {
          ...prev[dayId][block],
          [field]: value,
        },
      },
    }));
  };

  const handleSelectPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoUploadWarning(null);
    setSelectedPhoto(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const uploadPhotoIfNeeded = async (
    staffId: string,
  ): Promise<{ url: string | null; warning: string | null }> => {
    if (!selectedPhoto) return { url: null, warning: null };

    const ext = selectedPhoto.name.split('.').pop() || 'jpg';
    const path = `staff-avatars/${staffId}.${ext}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, selectedPhoto, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      return { url: data?.publicUrl || null, warning: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo subir la foto';

      if (message.toLowerCase().includes('bucket') && message.toLowerCase().includes('not found')) {
        return {
          url: null,
          warning: 'No existe el bucket avatars en producción. Se guardaron los demás cambios.',
        };
      }

      return { url: null, warning: message };
    }
  };

  const validateAvailability = (): string | null => {
    for (const day of DAYS) {
      const schedule = availability[day.id];

      if (schedule.morning_active) {
        const effectiveMorningEnd = schedule.break_active ? schedule.break.start : schedule.morning.end;
        if (toMinutes(schedule.morning.start) >= toMinutes(effectiveMorningEnd)) {
          return `${day.label}: la hora de inicio de la manana debe ser menor que la de fin`;
        }
      }

      if (schedule.afternoon_active) {
        const effectiveAfternoonStart = schedule.break_active ? schedule.break.end : schedule.afternoon.start;
        if (toMinutes(effectiveAfternoonStart) >= toMinutes(schedule.afternoon.end)) {
          return `${day.label}: la hora de inicio de la tarde debe ser menor que la de fin`;
        }
      }

      if (schedule.break_active) {
        if (!schedule.morning_active || !schedule.afternoon_active) {
          return `${day.label}: para usar descanso debes activar manana y tarde`;
        }
        if (toMinutes(schedule.break.start) >= toMinutes(schedule.break.end)) {
          return `${day.label}: la hora de inicio del descanso debe ser menor que la de fin`;
        }
        if (toMinutes(schedule.morning.start) >= toMinutes(schedule.break.start)) {
          return `${day.label}: el descanso debe empezar despues del inicio de manana`;
        }
        if (toMinutes(schedule.break.end) >= toMinutes(schedule.afternoon.end)) {
          return `${day.label}: el descanso debe terminar antes del fin de la tarde`;
        }
      }

      if (schedule.morning_active && schedule.afternoon_active && !schedule.break_active) {
        if (toMinutes(schedule.morning.end) > toMinutes(schedule.afternoon.start)) {
          return `${day.label}: el fin de manana no puede solapar el inicio de tarde`;
        }
      }
    }

    return null;
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Nombre requerido', variant: 'destructive' });
      return;
    }

    const invalidAvailability = validateAvailability();
    if (invalidAvailability) {
      toast({ title: 'Horario invalido', description: invalidAvailability, variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const savedStaff = staff
        ? await updateStaff.mutateAsync({
            id: staff.id,
            name: form.name,
            role: form.role,
            email: form.email,
            phone: form.phone,
            color: form.color,
          })
        : await createStaff.mutateAsync({
            name: form.name,
            role: form.role,
            email: form.email,
            phone: form.phone,
            color: form.color,
            active: true,
          });

      const { url: newAvatarUrl, warning: uploadWarning } = await uploadPhotoIfNeeded(savedStaff.id);
      if (newAvatarUrl) {
        await updateStaff.mutateAsync({ id: savedStaff.id, avatar_url: newAvatarUrl });
      }

      await supabase
        .from('availability')
        .delete()
        .eq('staff_id', savedStaff.id)
        .eq('user_id', savedStaff.user_id);

      const rowsToInsert: Omit<AvailabilityRow, 'id' | 'created_at' | 'updated_at'>[] = [];

      for (const day of DAYS) {
        const schedule = availability[day.id];
        if (!schedule) continue;

        if (schedule.morning_active) {
          const morningEnd = schedule.break_active ? schedule.break.start : schedule.morning.end;
          rowsToInsert.push({
            user_id: savedStaff.user_id,
            staff_id: savedStaff.id,
            day_of_week: day.dayOfWeek,
            start_time: schedule.morning.start,
            end_time: morningEnd,
            is_active: true,
          });
        }

        if (schedule.afternoon_active) {
          const afternoonStart = schedule.break_active ? schedule.break.end : schedule.afternoon.start;
          rowsToInsert.push({
            user_id: savedStaff.user_id,
            staff_id: savedStaff.id,
            day_of_week: day.dayOfWeek,
            start_time: afternoonStart,
            end_time: schedule.afternoon.end,
            is_active: true,
          });
        }
      }

      if (rowsToInsert.length > 0) {
        const { error } = await supabase.from('availability').insert(rowsToInsert);
        if (error) throw error;
      }

      if (uploadWarning) {
        setPhotoUploadWarning(uploadWarning);
        toast({
          title: staff ? 'Miembro actualizado con aviso' : 'Miembro creado con aviso',
          description: uploadWarning,
          variant: 'destructive',
        });
      } else {
        setPhotoUploadWarning(null);
        toast({ title: staff ? 'Miembro actualizado' : 'Miembro creado' });
      }
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo guardar los cambios';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar miembro del equipo' : 'Nuevo miembro del equipo'}</DialogTitle>
          <DialogDescription>
            Configura foto de perfil y horario por bloques de manana y tarde.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="info">Informacion</TabsTrigger>
            <TabsTrigger value="availability">Horario</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Foto de perfil</Label>
              <div className="flex items-center gap-4 mt-2">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={form.name || 'Trabajador'}
                    className="h-20 w-20 rounded-full object-cover border"
                  />
                ) : (
                  <div
                    className="h-20 w-20 rounded-full flex items-center justify-center text-lg font-semibold text-white"
                    style={{ backgroundColor: form.color }}
                  >
                    {initials}
                  </div>
                )}

                <div className="space-y-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleSelectPhoto}
                    accept="image/*"
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Subir foto
                  </Button>
                  <p className="text-xs text-muted-foreground">JPG o PNG, maximo 5MB</p>
                </div>
              </div>

              {photoUploadWarning && (
                <p className="mt-2 text-xs text-destructive">{photoUploadWarning}</p>
              )}
            </div>

            <div>
              <Label>Nombre *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="mt-1.5"
              />
            </div>

            <div>
              <Label>Rol</Label>
              <Input
                value={form.role}
                onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
                className="mt-1.5"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Telefono</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  className="mt-1.5"
                />
              </div>
            </div>

            <div>
              <Label>Color</Label>
              <div className="flex items-center gap-2 mt-1.5">
                <Input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
                  className="h-10 w-20"
                />
                <div className="h-10 w-20 rounded border" style={{ backgroundColor: form.color }} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="availability" className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Horario compacto por dia. Activa solo los bloques que uses y ajusta sus horas.
            </p>

            <div className="space-y-3">
              {DAYS.map((day) => {
                const daySchedule = availability[day.id];
                return (
                  <div key={day.id} className="rounded-lg border p-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-medium text-sm">{day.label}</p>
                      <div className="flex flex-wrap items-center gap-4 text-xs">
                        <label className="inline-flex items-center gap-2 text-muted-foreground">
                          <Checkbox
                            checked={daySchedule.morning_active}
                            onCheckedChange={() =>
                              updateDay(day.id, { morning_active: !daySchedule.morning_active })
                            }
                          />
                          Manana
                        </label>

                        <label className="inline-flex items-center gap-2 text-muted-foreground">
                          <Checkbox
                            checked={daySchedule.afternoon_active}
                            onCheckedChange={() =>
                              updateDay(day.id, { afternoon_active: !daySchedule.afternoon_active })
                            }
                          />
                          Tarde
                        </label>

                        <label className="inline-flex items-center gap-2 text-muted-foreground">
                          <Checkbox
                            checked={daySchedule.break_active}
                            onCheckedChange={() =>
                              updateDay(day.id, { break_active: !daySchedule.break_active })
                            }
                          />
                          Descanso
                        </label>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3">
                      {daySchedule.morning_active && (
                        <div className="rounded-md border p-2 space-y-1">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Manana</p>
                          <div className="flex items-center gap-2">
                            <Input
                              type="time"
                              value={daySchedule.morning.start}
                              onChange={(e) => updateDayTime(day.id, 'morning', 'start', e.target.value)}
                              className="h-8 text-xs"
                            />
                            <span className="text-xs text-muted-foreground">-</span>
                            <Input
                              type="time"
                              value={daySchedule.morning.end}
                              onChange={(e) => updateDayTime(day.id, 'morning', 'end', e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      )}

                      {daySchedule.break_active && (
                        <div className="rounded-md border p-2 space-y-1">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Descanso</p>
                          <div className="flex items-center gap-2">
                            <Input
                              type="time"
                              value={daySchedule.break.start}
                              onChange={(e) => updateDayTime(day.id, 'break', 'start', e.target.value)}
                              className="h-8 text-xs"
                            />
                            <span className="text-xs text-muted-foreground">-</span>
                            <Input
                              type="time"
                              value={daySchedule.break.end}
                              onChange={(e) => updateDayTime(day.id, 'break', 'end', e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      )}

                      {daySchedule.afternoon_active && (
                        <div className="rounded-md border p-2 space-y-1">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tarde</p>
                          <div className="flex items-center gap-2">
                            <Input
                              type="time"
                              value={daySchedule.afternoon.start}
                              onChange={(e) => updateDayTime(day.id, 'afternoon', 'start', e.target.value)}
                              className="h-8 text-xs"
                            />
                            <span className="text-xs text-muted-foreground">-</span>
                            <Input
                              type="time"
                              value={daySchedule.afternoon.end}
                              onChange={(e) => updateDayTime(day.id, 'afternoon', 'end', e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {!daySchedule.morning_active && !daySchedule.afternoon_active && (
                      <p className="text-xs text-muted-foreground">Dia sin disponibilidad.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={loading || !form.name.trim()}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
