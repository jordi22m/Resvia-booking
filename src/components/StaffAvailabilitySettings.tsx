import { useEffect, useState } from 'react';
import { Settings2, Clock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import type { TablesInsert } from '@/integrations/supabase/types';
import type { StaffMember } from '@/hooks/use-staff';
import type { Availability } from '@/hooks/use-availability';

const DAYS = [
  { id: 'monday', label: 'Lunes', day_of_week: 1 },
  { id: 'tuesday', label: 'Martes', day_of_week: 2 },
  { id: 'wednesday', label: 'Miércoles', day_of_week: 3 },
  { id: 'thursday', label: 'Jueves', day_of_week: 4 },
  { id: 'friday', label: 'Viernes', day_of_week: 5 },
  { id: 'saturday', label: 'Sábado', day_of_week: 6 },
  { id: 'sunday', label: 'Domingo', day_of_week: 0 },
];

type DaySchedule = {
  morning_active: boolean;
  afternoon_active: boolean;
  break_active: boolean;
  morning: { start: string; end: string };
  break: { start: string; end: string };
  afternoon: { start: string; end: string };
};

type StaffSchedule = Record<string, DaySchedule>;

interface StaffAvailabilitySettingsProps {
  staffMembers: StaffMember[] | undefined;
  availability: Availability[] | undefined;
  isLoading?: boolean;
  onSave?: () => void;
}

export function StaffAvailabilitySettings({
  staffMembers,
  availability,
  isLoading = false,
  onSave,
}: StaffAvailabilitySettingsProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [schedule, setSchedule] = useState<StaffSchedule>(getDefaultSchedule());

  function getDefaultSchedule(): StaffSchedule {
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
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }

  // Load staff availability when staff is selected
  useEffect(() => {
    if (!selectedStaff || !availability) return;

    const newSchedule = getDefaultSchedule();
    const staffAvailability = availability.filter((a) => a.staff_id === selectedStaff.id && a.is_active);

    for (const day of DAYS) {
      const rows = staffAvailability
        .filter((a) => a.day_of_week === day.day_of_week)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      const morningRow = rows[0];
      const afternoonRow = rows[1];

      if (morningRow) {
        newSchedule[day.id].morning_active = true;
        newSchedule[day.id].morning = {
          start: morningRow.start_time,
          end: morningRow.end_time,
        };
      } else {
        newSchedule[day.id].morning_active = false;
      }

      if (afternoonRow) {
        newSchedule[day.id].afternoon_active = true;
        newSchedule[day.id].afternoon = {
          start: afternoonRow.start_time,
          end: afternoonRow.end_time,
        };
      } else {
        newSchedule[day.id].afternoon_active = false;
      }

      if (morningRow && afternoonRow && toMinutes(morningRow.end_time) < toMinutes(afternoonRow.start_time)) {
        newSchedule[day.id].break_active = true;
        newSchedule[day.id].break = {
          start: morningRow.end_time,
          end: afternoonRow.start_time,
        };
      } else {
        newSchedule[day.id].break_active = false;
        newSchedule[day.id].break = { start: '13:00', end: '14:00' };
      }
    }

    setSchedule(newSchedule);
  }, [selectedStaff, availability]);

  const handleStaffSelect = (staffId: string) => {
    const staff = staffMembers?.find((s) => s.id === staffId);
    setSelectedStaff(staff || null);
  };

  const handleSaveSchedule = async () => {
    if (!selectedStaff || !user?.id) {
      toast({
        title: 'Error',
        description: 'Selecciona un trabajador',
        variant: 'destructive',
      });
      return;
    }

    for (const day of DAYS) {
      const daySchedule = schedule[day.id];

      if (daySchedule.morning_active) {
        const effectiveMorningEnd = daySchedule.break_active ? daySchedule.break.start : daySchedule.morning.end;
        if (toMinutes(daySchedule.morning.start) >= toMinutes(effectiveMorningEnd)) {
          toast({
            title: 'Horario invalido',
            description: `${day.label}: la hora de inicio de la manana debe ser menor que la de fin`,
            variant: 'destructive',
          });
          return;
        }
      }

      if (daySchedule.afternoon_active) {
        const effectiveAfternoonStart = daySchedule.break_active ? daySchedule.break.end : daySchedule.afternoon.start;
        if (toMinutes(effectiveAfternoonStart) >= toMinutes(daySchedule.afternoon.end)) {
          toast({
            title: 'Horario invalido',
            description: `${day.label}: la hora de inicio de la tarde debe ser menor que la de fin`,
            variant: 'destructive',
          });
          return;
        }
      }

      if (daySchedule.break_active) {
        if (!daySchedule.morning_active || !daySchedule.afternoon_active) {
          toast({
            title: 'Horario invalido',
            description: `${day.label}: para usar descanso debes activar manana y tarde`,
            variant: 'destructive',
          });
          return;
        }

        if (toMinutes(daySchedule.break.start) >= toMinutes(daySchedule.break.end)) {
          toast({
            title: 'Horario invalido',
            description: `${day.label}: la hora de inicio del descanso debe ser menor que la de fin`,
            variant: 'destructive',
          });
          return;
        }
      }
    }

    setIsSaving(true);
    try {
      // Delete existing availability for this staff
      const { error: deleteError } = await supabase
        .from('availability')
        .delete()
        .eq('user_id', user.id)
        .eq('staff_id', selectedStaff.id);

      if (deleteError) throw deleteError;

      // Insert new availability
      const rowsToInsert: TablesInsert<'availability'>[] = [];
      for (const day of DAYS) {
        const daySchedule = schedule[day.id];

        if (daySchedule.morning_active) {
          rowsToInsert.push({
            user_id: user.id,
            staff_id: selectedStaff.id,
            day_of_week: day.day_of_week,
            start_time: daySchedule.morning.start,
            end_time: daySchedule.break_active ? daySchedule.break.start : daySchedule.morning.end,
            is_active: true,
          });
        }

        if (daySchedule.afternoon_active) {
          rowsToInsert.push({
            user_id: user.id,
            staff_id: selectedStaff.id,
            day_of_week: day.day_of_week,
            start_time: daySchedule.break_active ? daySchedule.break.end : daySchedule.afternoon.start,
            end_time: daySchedule.afternoon.end,
            is_active: true,
          });
        }
      }

      if (rowsToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('availability')
          .insert(rowsToInsert);
        if (insertError) throw insertError;
      }

      toast({
        title: 'Disponibilidad guardada',
        description: `Horarios de ${selectedStaff.name} actualizados`,
      });

      onSave?.();
      setDialogOpen(false);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Error inesperado',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const updateDay = (dayId: string, next: Partial<DaySchedule>) => {
    setSchedule((prev) => ({
      ...prev,
      [dayId]: { ...prev[dayId], ...next },
    }));
  };

  const updateTime = (
    dayId: string,
    block: 'morning' | 'afternoon' | 'break',
    field: 'start' | 'end',
    value: string,
  ) => {
    setSchedule((prev) => ({
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

  if (!staffMembers || staffMembers.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6 text-center">
          <Settings2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground">
            Crea trabajadores primero para gestionar su disponibilidad
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setSelectedStaff(null);
          setSchedule(getDefaultSchedule());
          setDialogOpen(true);
        }}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Configurar disponibilidad por trabajador
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Disponibilidad de trabajadores</DialogTitle>
            <DialogDescription>
              Define horarios específicos para cada trabajador. Si no hay horarios definidos, usará los horarios globales.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 overflow-y-auto pr-1 flex-1">
            {/* Staff selector */}
            <div>
              <Label>Trabajador</Label>
              <Select value={selectedStaff?.id || ''} onValueChange={handleStaffSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un trabajador" />
                </SelectTrigger>
                <SelectContent>
                  {staffMembers.map((staff) => (
                    <SelectItem key={staff.id} value={staff.id}>
                      {staff.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Schedule grid */}
            {selectedStaff && (
              <div className="space-y-3">
                <Label>Horarios disponibles</Label>
                <div className="grid gap-3">
                  {DAYS.map((day) => (
                    <div
                      key={day.id}
                      className={cn(
                        'rounded-lg border p-3 transition-colors',
                        schedule[day.id].morning_active || schedule[day.id].afternoon_active
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-border bg-muted/30'
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex-1 min-w-[120px]">
                          <p className="font-medium">{day.label}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-xs">
                          <label className="inline-flex items-center gap-2 text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={schedule[day.id].morning_active}
                              onChange={() =>
                                updateDay(day.id, { morning_active: !schedule[day.id].morning_active })
                              }
                              className="h-4 w-4 rounded"
                            />
                            Manana
                          </label>

                          <label className="inline-flex items-center gap-2 text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={schedule[day.id].afternoon_active}
                              onChange={() =>
                                updateDay(day.id, { afternoon_active: !schedule[day.id].afternoon_active })
                              }
                              className="h-4 w-4 rounded"
                            />
                            Tarde
                          </label>

                          <label className="inline-flex items-center gap-2 text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={schedule[day.id].break_active}
                              onChange={() =>
                                updateDay(day.id, { break_active: !schedule[day.id].break_active })
                              }
                              className="h-4 w-4 rounded"
                            />
                            Descanso
                          </label>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        {schedule[day.id].morning_active && (
                          <div className="rounded-md border p-2 space-y-1">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Manana</p>
                            <div className="flex items-center gap-2">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              <input
                                type="time"
                                value={schedule[day.id].morning.start}
                                onChange={(e) => updateTime(day.id, 'morning', 'start', e.target.value)}
                                className="h-8 px-2 rounded border border-input text-sm"
                              />
                              <span className="text-xs text-muted-foreground">-</span>
                              <input
                                type="time"
                                value={schedule[day.id].morning.end}
                                onChange={(e) => updateTime(day.id, 'morning', 'end', e.target.value)}
                                className="h-8 px-2 rounded border border-input text-sm"
                              />
                            </div>
                          </div>
                        )}

                        {schedule[day.id].break_active && (
                          <div className="rounded-md border p-2 space-y-1">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Descanso</p>
                            <div className="flex items-center gap-2">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              <input
                                type="time"
                                value={schedule[day.id].break.start}
                                onChange={(e) => updateTime(day.id, 'break', 'start', e.target.value)}
                                className="h-8 px-2 rounded border border-input text-sm"
                              />
                              <span className="text-xs text-muted-foreground">-</span>
                              <input
                                type="time"
                                value={schedule[day.id].break.end}
                                onChange={(e) => updateTime(day.id, 'break', 'end', e.target.value)}
                                className="h-8 px-2 rounded border border-input text-sm"
                              />
                            </div>
                          </div>
                        )}

                        {schedule[day.id].afternoon_active && (
                          <div className="rounded-md border p-2 space-y-1">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tarde</p>
                            <div className="flex items-center gap-2">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              <input
                                type="time"
                                value={schedule[day.id].afternoon.start}
                                onChange={(e) => updateTime(day.id, 'afternoon', 'start', e.target.value)}
                                className="h-8 px-2 rounded border border-input text-sm"
                              />
                              <span className="text-xs text-muted-foreground">-</span>
                              <input
                                type="time"
                                value={schedule[day.id].afternoon.end}
                                onChange={(e) => updateTime(day.id, 'afternoon', 'end', e.target.value)}
                                className="h-8 px-2 rounded border border-input text-sm"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {!schedule[day.id].morning_active && !schedule[day.id].afternoon_active && (
                        <p className="mt-3 text-xs text-muted-foreground">Dia sin disponibilidad.</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveSchedule} disabled={isSaving || !selectedStaff}>
              {isSaving ? 'Guardando...' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
