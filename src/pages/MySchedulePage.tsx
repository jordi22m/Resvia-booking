import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import type { Tables } from '@/integrations/supabase/types';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS: Record<string, { name: string; dayOfWeek: number }> = {
  monday: { name: 'Lunes', dayOfWeek: 1 },
  tuesday: { name: 'Martes', dayOfWeek: 2 },
  wednesday: { name: 'Miércoles', dayOfWeek: 3 },
  thursday: { name: 'Jueves', dayOfWeek: 4 },
  friday: { name: 'Viernes', dayOfWeek: 5 },
  saturday: { name: 'Sábado', dayOfWeek: 6 },
  sunday: { name: 'Domingo', dayOfWeek: 0 },
};

type AvailabilityRow = Tables<'availability'>;

interface DaySchedule {
  day: string;
  dayOfWeek: number;
  isActive: boolean;
  startTime: string;
  endTime: string;
}

export default function MySchedulePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityRow[] | null>(null);
  const [schedule, setSchedule] = useState<DaySchedule[]>(
    DAYS.map((day) => ({
      day,
      dayOfWeek: DAY_LABELS[day].dayOfWeek,
      isActive: false,
      startTime: '09:00',
      endTime: '18:00',
    }))
  );

  // Load availability on mount
  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('availability')
          .select('*')
          .eq('user_id', user.id)
          .is('staff_id', null);

        if (error) throw error;
        
        setAvailability(data || []);

        // Initialize schedule from loaded data
        const newSchedule = DAYS.map((day) => {
          const dayOfWeek = DAY_LABELS[day].dayOfWeek;
          const existing = data?.find(
            (a) =>
              a.day_of_week === dayOfWeek &&
              !a.staff_id
          );

          return {
            day,
            dayOfWeek,
            isActive: !!existing?.is_active,
            startTime: existing?.start_time || '09:00',
            endTime: existing?.end_time || '18:00',
          };
        });
        setSchedule(newSchedule);
      } catch (err) {
        console.error('Error loading availability:', err);
        toast({
          title: 'Error',
          description: 'No se pudo cargar tu horario',
          variant: 'destructive',
        });
      }
    })();
  }, [user, toast]);

  const handleToggleDay = (dayIndex: number) => {
    setSchedule((prev) => {
      const updated = [...prev];
      updated[dayIndex].isActive = !updated[dayIndex].isActive;
      return updated;
    });
  };

  const handleTimeChange = (dayIndex: number, field: 'startTime' | 'endTime', value: string) => {
    setSchedule((prev) => {
      const updated = [...prev];
      if (field === 'startTime') {
        updated[dayIndex].startTime = value;
      } else {
        updated[dayIndex].endTime = value;
      }
      return updated;
    });
  };

  const handleSaveSchedule = async () => {
    if (!user) return;

    setLoading(true);
    try {
      // Delete existing availability
      await supabase
        .from('availability')
        .delete()
        .eq('user_id', user.id)
        .is('staff_id', null);

      // Insert new availability rows
      const rowsToInsert = schedule
        .filter((day) => day.isActive)
        .map((day) => ({
          user_id: user.id,
          staff_id: null, // This is the user's own availability
          day_of_week: day.dayOfWeek,
          start_time: day.startTime,
          end_time: day.endTime,
          is_active: true,
        }));

      if (rowsToInsert.length > 0) {
        const { error } = await supabase.from('availability').insert(rowsToInsert);
        if (error) throw error;
      }

      // Invalidate queries to refresh data
      qc.invalidateQueries({ queryKey: ['availability'] });

      toast({
        title: 'Éxito',
        description: 'Tu horario ha sido actualizado',
      });
    } catch (err) {
      console.error('Error saving schedule:', err);
      toast({
        title: 'Error',
        description: 'No se pudo guardar tu horario',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Mi Horario</h1>
        <p className="text-muted-foreground">
          Configura tu disponibilidad laboral. Los clientes solo podrán reservar en estos horarios.
        </p>
      </div>

      {/* Schedule Card */}
      <Card>
        <CardHeader>
          <CardTitle>Disponibilidad Semanal</CardTitle>
          <CardDescription>
            Marca los días que trabajas y establece tus horarios
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Days Grid */}
          <div className="space-y-4">
            {schedule.map((day, dayIndex) => (
              <div
                key={day.day}
                className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                {/* Day Name and Checkbox */}
                <div className="flex items-center gap-3 min-w-fit">
                  <Checkbox
                    id={`day-${day.day}`}
                    checked={day.isActive}
                    onCheckedChange={() => handleToggleDay(dayIndex)}
                  />
                  <Label
                    htmlFor={`day-${day.day}`}
                    className="font-semibold min-w-20 cursor-pointer"
                  >
                    {DAY_LABELS[day.day].name}
                  </Label>
                </div>

                {/* Time Inputs */}
                {day.isActive && (
                  <div className="flex items-center gap-2 flex-1">
                    <div className="flex-1 flex items-center gap-2">
                      <Input
                        type="time"
                        value={day.startTime}
                        onChange={(e) =>
                          handleTimeChange(dayIndex, 'startTime', e.target.value)
                        }
                        className="w-32"
                      />
                      <span className="text-muted-foreground">-</span>
                      <Input
                        type="time"
                        value={day.endTime}
                        onChange={(e) =>
                          handleTimeChange(dayIndex, 'endTime', e.target.value)
                        }
                        className="w-32"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              onClick={handleSaveSchedule}
              disabled={loading}
              className="px-6"
            >
              {loading ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="pt-6">
          <p className="text-sm text-blue-900">
            <strong>💡 Tip:</strong> Tu horario será visible para los clientes en el enlace de reserva.
            Si no estás disponible en un horario, los clientes no podrán reservarte en esas horas.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
