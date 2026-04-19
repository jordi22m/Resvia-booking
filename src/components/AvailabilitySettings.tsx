import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import type { TablesInsert } from '@/integrations/supabase/types';

const DAYS = [
  { id: 'monday', label: 'Lunes', day_of_week: 1 },
  { id: 'tuesday', label: 'Martes', day_of_week: 2 },
  { id: 'wednesday', label: 'Miercoles', day_of_week: 3 },
  { id: 'thursday', label: 'Jueves', day_of_week: 4 },
  { id: 'friday', label: 'Viernes', day_of_week: 5 },
  { id: 'saturday', label: 'Sabado', day_of_week: 6 },
  { id: 'sunday', label: 'Domingo', day_of_week: 0 },
];

interface DaySchedule {
  morning_active: boolean;
  afternoon_active: boolean;
  morning: { start: string; end: string };
  afternoon: { start: string; end: string };
}

export function AvailabilitySettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const getDefaultSchedule = () => {
    return Object.fromEntries(
      DAYS.map(day => [
        day.id,
        {
          morning_active: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(day.id),
          afternoon_active: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(day.id),
          morning: { start: '09:00', end: '13:00' },
          afternoon: { start: '14:00', end: '18:00' }
        }
      ])
    );
  };

  const [availability, setAvailability] = useState<Record<string, DaySchedule>>(() => getDefaultSchedule());

  useEffect(() => {
    if (!user?.id) return;

    const loadAvailability = async () => {
      setIsLoading(true);
      const base = getDefaultSchedule();
      const { data, error } = await supabase
        .from('availability')
        .select('*')
        .eq('user_id', user.id)
        .is('staff_id', null)
        .eq('is_active', true);

      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        setIsLoading(false);
        return;
      }

      const byDay = new Map<number, typeof data>();
      for (const row of data || []) {
        const list = byDay.get(row.day_of_week) || [];
        list.push(row);
        byDay.set(row.day_of_week, list);
      }

      for (const day of DAYS) {
        const rows = (byDay.get(day.day_of_week) || []).sort((a, b) => a.start_time.localeCompare(b.start_time));
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
      }

      setAvailability(base);
      setIsLoading(false);
    };

    void loadAvailability();
  }, [user?.id]);

  const handleSaveAvailability = async () => {
    if (!user?.id) {
      toast({ title: 'Error', description: 'Usuario no identificado', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const rowsToInsert: TablesInsert<'availability'>[] = [];
      for (const day of DAYS) {
        const schedule = availability[day.id];
        if (!schedule) continue;

        if (schedule.morning_active) {
          rowsToInsert.push({
            user_id: user.id,
            day_of_week: day.day_of_week,
            start_time: schedule.morning.start,
            end_time: schedule.morning.end,
            is_active: true,
            staff_id: null,
          });
        }

        if (schedule.afternoon_active) {
          rowsToInsert.push({
            user_id: user.id,
            day_of_week: day.day_of_week,
            start_time: schedule.afternoon.start,
            end_time: schedule.afternoon.end,
            is_active: true,
            staff_id: null,
          });
        }
      }

      const { error: deleteError } = await supabase
        .from('availability')
        .delete()
        .eq('user_id', user.id)
        .is('staff_id', null);

      if (deleteError) throw deleteError;

      if (rowsToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('availability')
          .insert(rowsToInsert);
        if (insertError) throw insertError;
      }

      toast({ title: 'Disponibilidad guardada' });
    } catch (e: unknown) {
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : 'Error inesperado',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleMorning = (dayId: string) => {
    setAvailability(prev => ({
      ...prev,
      [dayId]: { ...prev[dayId], morning_active: !prev[dayId].morning_active }
    }));
  };

  const toggleAfternoon = (dayId: string) => {
    setAvailability(prev => ({
      ...prev,
      [dayId]: { ...prev[dayId], afternoon_active: !prev[dayId].afternoon_active }
    }));
  };

  const updateMorningTime = (dayId: string, field: 'start' | 'end', value: string) => {
    setAvailability(prev => ({
      ...prev,
      [dayId]: {
        ...prev[dayId],
        morning: { ...prev[dayId].morning!, [field]: value }
      }
    }));
  };

  const updateAfternoonTime = (dayId: string, field: 'start' | 'end', value: string) => {
    setAvailability(prev => ({
      ...prev,
      [dayId]: {
        ...prev[dayId],
        afternoon: { ...prev[dayId].afternoon!, [field]: value }
      }
    }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Disponibilidad</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Cargando disponibilidad...
          </div>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Configura manana y tarde de forma independiente para cada dia.
        </p>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2 font-medium">Día</th>
                <th className="text-left py-2 px-2 font-medium">Mañana</th>
                <th className="text-left py-2 px-2 font-medium">Tarde</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map(day => {
                const daySchedule = availability[day.id] || {
                  morning_active: false,
                  afternoon_active: false,
                  morning: { start: '09:00', end: '13:00' },
                  afternoon: { start: '14:00', end: '18:00' }
                };
                return (
                  <tr key={day.id} className="border-b hover:bg-secondary/50 transition-colors">
                    <td className="py-3 px-2 font-medium text-foreground">{day.label}</td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2 mb-2">
                        <Checkbox
                          checked={daySchedule.morning_active}
                          onCheckedChange={() => toggleMorning(day.id)}
                        />
                        <span className="text-xs text-muted-foreground">Activa mañana</span>
                      </div>
                      {daySchedule.morning_active ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="time"
                            value={daySchedule.morning?.start || '09:00'}
                            onChange={e => updateMorningTime(day.id, 'start', e.target.value)}
                            className="w-24 h-8 text-xs"
                          />
                          <span className="text-xs text-muted-foreground">-</span>
                          <Input
                            type="time"
                            value={daySchedule.morning?.end || '13:00'}
                            onChange={e => updateMorningTime(day.id, 'end', e.target.value)}
                            className="w-24 h-8 text-xs"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Mañana cerrada</span>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2 mb-2">
                        <Checkbox
                          checked={daySchedule.afternoon_active}
                          onCheckedChange={() => toggleAfternoon(day.id)}
                        />
                        <span className="text-xs text-muted-foreground">Activa tarde</span>
                      </div>
                      {daySchedule.afternoon_active ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="time"
                            value={daySchedule.afternoon?.start || '14:00'}
                            onChange={e => updateAfternoonTime(day.id, 'start', e.target.value)}
                            className="w-24 h-8 text-xs"
                          />
                          <span className="text-xs text-muted-foreground">-</span>
                          <Input
                            type="time"
                            value={daySchedule.afternoon?.end || '18:00'}
                            onChange={e => updateAfternoonTime(day.id, 'end', e.target.value)}
                            className="w-24 h-8 text-xs"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Tarde cerrada</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Button size="sm" onClick={handleSaveAvailability} disabled={isSaving} translate="no">
          <span className="inline-flex h-4 w-4 items-center justify-center">
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
          </span>
          <span>Guardar disponibilidad</span>
        </Button>
      </CardContent>
    </Card>
  );
}

