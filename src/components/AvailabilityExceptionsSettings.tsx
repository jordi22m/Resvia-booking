import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Trash2, Plus } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useAvailabilityExceptionsByUserId, useCreateAvailabilityException, useDeleteAvailabilityException, useUpdateAvailabilityException } from '@/hooks/use-availability-exceptions';
import { cn } from '@/lib/utils';
import type { AvailabilityException } from '@/hooks/use-availability-exceptions';

export function AvailabilityExceptionsSettings() {
  const { user } = useAuth();
  const { toast } = useToast();

  // Query for existing exceptions
  const { data: exceptions = [], isLoading: loadingExceptions } = useAvailabilityExceptionsByUserId(user?.id);

  // Mutations
  const createException = useCreateAvailabilityException(user?.id);
  const updateException = useUpdateAvailabilityException(user?.id);
  const deleteException = useDeleteAvailabilityException(user?.id);

  // Form state for new exception
  const [newException, setNewException] = useState({
    date: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
    is_closed: true,
    start_time: '09:00',
    end_time: '18:00',
    reason: '',
  });

  const handleAddException = async () => {
    if (!newException.date) {
      toast({
        title: 'Error',
        description: 'Selecciona una fecha',
        variant: 'destructive'
      });
      return;
    }

    try {
      await createException.mutateAsync({
        exception_date: newException.date,
        is_closed: newException.is_closed,
        start_time: newException.is_closed ? null : newException.start_time,
        end_time: newException.is_closed ? null : newException.end_time,
        reason: newException.reason || null,
      });

      toast({
        title: 'Éxito',
        description: newException.is_closed ? 'Día bloqueado' : 'Horario personalizado agregado',
      });

      // Reset form
      setNewException({
        date: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
        is_closed: true,
        start_time: '09:00',
        end_time: '18:00',
        reason: '',
      });
    } catch (err) {
      console.error('Error creating exception:', err);
      toast({
        title: 'Error',
        description: 'No se pudo agregar la excepción',
        variant: 'destructive'
      });
    }
  };

  const handleDeleteException = async (exceptionId: string) => {
    try {
      await deleteException.mutateAsync(exceptionId);
      toast({
        title: 'Éxito',
        description: 'Excepción eliminada',
      });
    } catch (err) {
      console.error('Error deleting exception:', err);
      toast({
        title: 'Error',
        description: 'No se pudo eliminar la excepción',
        variant: 'destructive'
      });
    }
  };

  // Sort exceptions by date
  const sortedExceptions = [...exceptions].sort((a, b) =>
    new Date(a.exception_date).getTime() - new Date(b.exception_date).getTime()
  );

  return (
    <div className="space-y-6">
      {/* Add new exception */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Agregar Excepción
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-foreground">Fecha</label>
              <Input
                type="date"
                value={newException.date}
                onChange={(e) => setNewException({ ...newException, date: e.target.value })}
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Motivo (opcional)</label>
              <Input
                type="text"
                placeholder="Ej: Feriado, Cierre especial"
                value={newException.reason}
                onChange={(e) => setNewException({ ...newException, reason: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="is-closed"
                checked={newException.is_closed}
                onCheckedChange={(checked) =>
                  setNewException({ ...newException, is_closed: checked as boolean })
                }
              />
              <label htmlFor="is-closed" className="text-sm font-medium text-foreground cursor-pointer">
                Cerrado todo el día
              </label>
            </div>

            {!newException.is_closed && (
              <div className="grid gap-3 md:grid-cols-2 pl-6">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Desde</label>
                  <Input
                    type="time"
                    value={newException.start_time}
                    onChange={(e) => setNewException({ ...newException, start_time: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Hasta</label>
                  <Input
                    type="time"
                    value={newException.end_time}
                    onChange={(e) => setNewException({ ...newException, end_time: e.target.value })}
                    className="mt-1"
                  />
                </div>
              </div>
            )}
          </div>

          <Button
            onClick={handleAddException}
            disabled={createException.isPending || !newException.date}
            className="w-full"
          >
            {createException.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Agregar Excepción
          </Button>
        </CardContent>
      </Card>

      {/* List of exceptions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Excepciones Activas</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {sortedExceptions.length} excepción{sortedExceptions.length !== 1 ? 'es' : ''} configurada{sortedExceptions.length !== 1 ? 's' : ''}
          </p>
        </CardHeader>
        <CardContent>
          {loadingExceptions ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : sortedExceptions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No hay excepciones configuradas</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedExceptions.map((exception) => (
                <div
                  key={exception.id}
                  className={cn(
                    'flex items-center justify-between gap-4 p-3 rounded-lg border',
                    exception.is_closed ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-foreground">
                      {format(new Date(exception.exception_date), 'EEEE, d MMMM yyyy', { locale: es })}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {exception.is_closed ? (
                        <span className="font-medium">Cerrado todo el día</span>
                      ) : (
                        <span>
                          {exception.start_time} - {exception.end_time}
                        </span>
                      )}
                      {exception.reason && (
                        <span className="ml-2">({exception.reason})</span>
                      )}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteException(exception.id)}
                    disabled={deleteException.isPending}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    {deleteException.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
