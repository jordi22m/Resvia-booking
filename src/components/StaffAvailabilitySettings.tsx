import { useEffect, useState } from 'react';
import { Settings2, ChevronDown, Clock, Plus, Trash2 } from 'lucide-react';
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

interface StaffSchedule {
  [dayId: string]: {
    is_available: boolean;
    start_time: string;
    end_time: string;
  };
}

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
    const defaultSchedule: StaffSchedule = {};
    for (const day of DAYS) {
      defaultSchedule[day.id] = {
        is_available: false,
        start_time: '09:00',
        end_time: '18:00',
      };
    }
    return defaultSchedule;
  }

  // Load staff availability when staff is selected
  useEffect(() => {
    if (!selectedStaff || !availability) return;

    const newSchedule = getDefaultSchedule();
    const staffAvailability = availability.filter(
      (a) => a.staff_id === selectedStaff.id && a.is_active
    );

    for (const day of DAYS) {
      const dayAvailability = staffAvailability.find(
        (a) => a.day_of_week === day.day_of_week
      );
      if (dayAvailability) {
        newSchedule[day.id] = {
          is_available: true,
          start_time: dayAvailability.start_time,
          end_time: dayAvailability.end_time,
        };
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
        if (daySchedule.is_available) {
          rowsToInsert.push({
            user_id: user.id,
            staff_id: selectedStaff.id,
            day_of_week: day.day_of_week,
            start_time: daySchedule.start_time,
            end_time: daySchedule.end_time,
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

  const toggleDay = (dayId: string) => {
    setSchedule((prev) => ({
      ...prev,
      [dayId]: {
        ...prev[dayId],
        is_available: !prev[dayId].is_available,
      },
    }));
  };

  const updateTime = (dayId: string, field: 'start_time' | 'end_time', value: string) => {
    setSchedule((prev) => ({
      ...prev,
      [dayId]: {
        ...prev[dayId],
        [field]: value,
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Disponibilidad de trabajadores</DialogTitle>
            <DialogDescription>
              Define horarios específicos para cada trabajador. Si no hay horarios definidos, usará los horarios globales.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
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
                <div className="grid gap-3 max-h-96 overflow-y-auto pr-2">
                  {DAYS.map((day) => (
                    <div
                      key={day.id}
                      className={cn(
                        'rounded-lg border p-3 transition-colors',
                        schedule[day.id].is_available
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-border bg-muted/30'
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={schedule[day.id].is_available}
                              onChange={() => toggleDay(day.id)}
                              className="h-4 w-4 rounded"
                            />
                            <span className="font-medium">{day.label}</span>
                          </label>
                        </div>

                        {schedule[day.id].is_available && (
                          <div className="flex items-center gap-2 flex-wrap justify-end">
                            <div className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              <input
                                type="time"
                                value={schedule[day.id].start_time}
                                onChange={(e) =>
                                  updateTime(day.id, 'start_time', e.target.value)
                                }
                                className="h-8 px-2 rounded border border-input text-sm"
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">-</span>
                            <input
                              type="time"
                              value={schedule[day.id].end_time}
                              onChange={(e) =>
                                updateTime(day.id, 'end_time', e.target.value)
                              }
                              className="h-8 px-2 rounded border border-input text-sm"
                            />
                          </div>
                        )}
                      </div>
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
