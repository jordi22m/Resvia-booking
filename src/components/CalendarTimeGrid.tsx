import { useMemo, useCallback } from 'react';
import { format, addDays, startOfWeek, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AppointmentCard } from '@/components/AppointmentCard';

interface Appointment {
  id: string;
  customer_id: string;
  service_id: string;
  staff_id?: string | null;
  date: string;
  start_time: string;
  end_time: string;
  status?: string;
  notes?: string | null;
}

interface CalendarItem {
  customer?: { id: string; name: string };
  service?: { id: string; name: string; duration: number };
  staff?: { id: string; name: string };
}

interface CalendarTimeGridProps {
  currentDate: Date;
  viewMode: 'day' | 'week';
  appointments: Appointment[];
  onSlotClick: (date: Date, hour: number) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  onAppointmentDrag?: (appointmentId: string, startTime: string) => void;
  availability?: any[];
  customers?: any[];
  services?: any[];
  staff?: any[];
}

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 08:00 to 20:00

function getAppointmentStatusClasses(status?: string) {
  switch (status) {
    case 'confirmed':
      return {
        surface: 'bg-emerald-500/20 dark:bg-emerald-500/20',
        sideBorder: 'border-l-emerald-600 dark:border-l-emerald-400',
        hoverBorder: 'hover:ring-1 hover:ring-emerald-400/60',
        badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
        text: 'text-emerald-950 dark:text-emerald-100',
        badgeText: 'Confirmada',
      };
    case 'cancelled':
    case 'canceled':
      return {
        surface: 'bg-red-500/20 dark:bg-red-500/20',
        sideBorder: 'border-l-red-600 dark:border-l-red-400',
        hoverBorder: 'hover:ring-1 hover:ring-red-400/60',
        badge: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
        text: 'text-red-950 dark:text-red-100',
        badgeText: 'Cancelada',
      };
    case 'completed':
      return {
        surface: 'bg-sky-500/20 dark:bg-sky-500/20',
        sideBorder: 'border-l-sky-600 dark:border-l-sky-400',
        hoverBorder: 'hover:ring-1 hover:ring-sky-400/60',
        badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
        text: 'text-sky-950 dark:text-sky-100',
        badgeText: 'Completada',
      };
    case 'pending':
    default:
      return {
        surface: 'bg-amber-500/20 dark:bg-amber-500/20',
        sideBorder: 'border-l-amber-600 dark:border-l-amber-400',
        hoverBorder: 'hover:ring-1 hover:ring-amber-400/60',
        badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
        text: 'text-amber-950 dark:text-amber-100',
        badgeText: 'Pendiente',
      };
  }
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function getAppointmentLayout(appts: Appointment[]) {
  const sorted = [...appts].sort((a, b) => {
    const startA = parseTimeToMinutes(a.start_time || '00:00');
    const startB = parseTimeToMinutes(b.start_time || '00:00');
    if (startA !== startB) return startA - startB;
    return parseTimeToMinutes(a.end_time || '00:00') - parseTimeToMinutes(b.end_time || '00:00');
  });

  const columns: Appointment[][] = [];
  const layoutItems: (Appointment & { column: number; totalColumns: number })[] = [];

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
}

function TimeGridColumn({
  day,
  dayAppointments,
  isToday,
  isWorkingHour,
  onSlotClick,
  onAppointmentClick,
  customers,
  services,
  staff,
}: {
  day: Date;
  dayAppointments: Appointment[];
  isToday: boolean;
  isWorkingHour: (hour: number) => boolean;
  onSlotClick: (hour: number) => void;
  onAppointmentClick: (apt: Appointment) => void;
  customers?: any[];
  services?: any[];
  staff?: any[];
}) {
  const layoutItems = useMemo(() => getAppointmentLayout(dayAppointments), [dayAppointments]);

  return (
    <div className="flex-1 min-w-[100px] border-r border-border last:border-r-0 bg-background/50 dark:bg-background/30">
      {/* Day Header */}
      <div
        className={cn(
          'h-14 border-b border-border flex flex-col items-center justify-center sticky top-0 z-10 backdrop-blur-sm transition-colors',
          isToday ? 'bg-primary/10 dark:bg-primary/20' : 'bg-background/95 dark:bg-background/80',
        )}
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{format(day, 'EEE', { locale: es })}</span>
        <span className={cn('text-lg font-bold', isToday ? 'text-primary dark:text-primary' : 'text-foreground')}>
          {format(day, 'd')}
        </span>
      </div>

      {/* Time Slots */}
      <div className="relative">
        {HOURS.map((hour) => (
          <div
            key={hour}
            role="button"
            tabIndex={0}
            onClick={() => onSlotClick(hour)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSlotClick(hour);
              }
            }}
            className={cn(
              'h-20 border-b border-border/50 px-1 py-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              isWorkingHour(hour)
                ? 'bg-primary/5 dark:bg-primary/5 hover:bg-primary/10 dark:hover:bg-primary/15'
                : 'bg-muted/20 dark:bg-muted/10 hover:bg-muted/30 dark:hover:bg-muted/20',
            )}
          />
        ))}

        {/* Appointments */}
        <TooltipProvider>
          {layoutItems.map((apt) => {
            const [startH, startM] = (apt.start_time || '09:00').split(':').map(Number);
            const [endH, endM] = (apt.end_time || '09:30').split(':').map(Number);
            const top = (startH - 8) * 80 + (startM / 60) * 80;
            const height = ((endH - startH) * 60 + (endM - startM)) / 60 * 80;
            const customer = customers?.find((c) => c.id === apt.customer_id);
            const service = services?.find((s) => s.id === apt.service_id);
            const member = staff?.find((s) => s.id === apt.staff_id);
            const statusStyle = getAppointmentStatusClasses(apt.status);
            const width = `calc(${100 / Math.max(apt.totalColumns, 1)}% - 6px)`;
            const left = `calc(${(100 / Math.max(apt.totalColumns, 1)) * apt.column}% + 4px)`;

            return (
              <AppointmentCard
                key={apt.id}
                apt={apt}
                top={top}
                left={left}
                width={width}
                height={height}
                statusStyle={statusStyle}
                customerName={customer?.name || 'Cliente'}
                serviceName={service?.name || 'Servicio'}
                staffName={member?.name}
                onClick={() => onAppointmentClick(apt)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', JSON.stringify({ appointmentId: apt.id, originalTime: apt.start_time }));
                }}
              />
            );
          })}
        </TooltipProvider>
      </div>
    </div>
  );
}

export function CalendarTimeGrid({
  currentDate,
  viewMode,
  appointments = [],
  onSlotClick,
  onAppointmentClick,
  availability = [],
  customers = [],
  services = [],
  staff = [],
}: CalendarTimeGridProps) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const displayDays = viewMode === 'day' ? [currentDate] : weekDays;

  const isWorkingHour = useCallback(
    (date: Date, hour: number): boolean => {
      if (!availability?.length) return false;
      const dayOfWeek = date.getDay();
      return availability
        .filter((a) => a.day_of_week === dayOfWeek)
        .some((slot) => {
          const startH = parseInt(slot.start_time.split(':')[0], 10);
          const endH = parseInt(slot.end_time.split(':')[0], 10);
          return hour >= startH && hour < endH;
        });
    },
    [availability],
  );

  const getAppointmentsForDay = useCallback(
    (date: Date) => {
      const dateStr = format(date, 'yyyy-MM-dd');
      return appointments.filter((a) => a.date === dateStr);
    },
    [appointments],
  );

  return (
    <div className="flex-1 overflow-auto bg-muted/5 dark:bg-muted/5 border-t border-border">
      <div className="flex min-w-full">
        {/* Time Column Header */}
        <div className="w-20 shrink-0 border-r border-border bg-background/95 dark:bg-background/90 sticky left-0 z-20">
          <div className="h-14 border-b border-border bg-background/98 dark:bg-background/95 flex items-center justify-center">
            <span className="text-xs font-semibold text-muted-foreground">Hora</span>
          </div>
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="h-20 border-b border-border/50 flex items-start justify-center pt-1.5"
            >
              <span className="text-xs font-semibold text-muted-foreground">{hour.toString().padStart(2, '0')}:00</span>
            </div>
          ))}
        </div>

        {/* Day Columns */}
        {displayDays.map((day) => {
          const dayAppointments = getAppointmentsForDay(day);
          const isToday = isSameDay(day, new Date());

          return (
            <TimeGridColumn
              key={day.toISOString()}
              day={day}
              dayAppointments={dayAppointments}
              isToday={isToday}
              isWorkingHour={(hour) => isWorkingHour(day, hour)}
              onSlotClick={(hour) => onSlotClick(day, hour)}
              onAppointmentClick={onAppointmentClick}
              customers={customers}
              services={services}
              staff={staff}
            />
          );
        })}
      </div>
    </div>
  );
}
