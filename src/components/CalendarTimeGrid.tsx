import { useMemo, useCallback, useState } from 'react';
import { format, addDays, startOfWeek, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AppointmentCard } from '@/components/AppointmentCard';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CalendarBlock } from '@/hooks/use-calendar-blocks';

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
  calendarBlocks?: CalendarBlock[];
  onSlotClick: (date: Date, hour: number) => void;
  onSlotAction?: (payload: { date: Date; hour: number; action: 'booking' | 'blocked' | 'closed' }) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  onBlockClick?: (block: CalendarBlock) => void;
  onAppointmentDrag?: (appointmentId: string, startTime: string) => void;
  availability?: any[];
  customers?: any[];
  services?: any[];
  staff?: any[];
}

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 08:00 to 20:00

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.min(totalMinutes, 24 * 60 - 1));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function parseTimestamp(value: string): Date {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return new Date(normalized);
}

type GridItem = {
  id: string;
  kind: 'booking' | 'blocked' | 'closed';
  startMinutes: number;
  endMinutes: number;
  appointment?: Appointment;
  block?: CalendarBlock;
};

type GridLayoutItem = GridItem & { column: number; totalColumns: number };

function getGridLayout(items: GridItem[]): GridLayoutItem[] {
  const sorted = [...items].sort((a, b) => {
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    return a.endMinutes - b.endMinutes;
  });

  const columnLastEnd: number[] = [];
  const layout: GridLayoutItem[] = [];

  for (const item of sorted) {
    let assignedColumn = -1;
    for (let i = 0; i < columnLastEnd.length; i++) {
      if (columnLastEnd[i] <= item.startMinutes) {
        assignedColumn = i;
        break;
      }
    }

    if (assignedColumn === -1) {
      assignedColumn = columnLastEnd.length;
      columnLastEnd.push(item.endMinutes);
    } else {
      columnLastEnd[assignedColumn] = item.endMinutes;
    }

    layout.push({
      ...item,
      column: assignedColumn,
      totalColumns: 0,
    });
  }

  const totalColumns = Math.max(1, columnLastEnd.length);
  return layout.map((item) => ({ ...item, totalColumns }));
}

function getDayBlocks(day: Date, blocks: CalendarBlock[]): GridItem[] {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  return blocks
    .map((block) => {
      const blockStart = parseTimestamp(block.start_time);
      const blockEnd = parseTimestamp(block.end_time);
      if (Number.isNaN(blockStart.getTime()) || Number.isNaN(blockEnd.getTime())) return null;
      if (blockEnd <= dayStart || blockStart >= dayEnd) return null;

      const clippedStart = blockStart < dayStart ? dayStart : blockStart;
      const clippedEnd = blockEnd > dayEnd ? dayEnd : blockEnd;

      const startMinutes = Math.floor((clippedStart.getTime() - dayStart.getTime()) / 60000);
      const endMinutes = Math.floor((clippedEnd.getTime() - dayStart.getTime()) / 60000);

      if (endMinutes <= startMinutes) return null;

      return {
        id: block.id,
        kind: block.type === 'closed' ? 'closed' : 'blocked',
        startMinutes,
        endMinutes,
        block,
      } as GridItem;
    })
    .filter((item): item is GridItem => Boolean(item));
}

function TimeGridColumn({
  day,
  dayAppointments,
  dayBlocks,
  isToday,
  isWorkingHour,
  onSlotClick,
  onSlotAction,
  onAppointmentClick,
  onBlockClick,
  customers,
  services,
  staff,
}: {
  day: Date;
  dayAppointments: Appointment[];
  dayBlocks: CalendarBlock[];
  isToday: boolean;
  isWorkingHour: (hour: number) => boolean;
  onSlotClick: (hour: number) => void;
  onSlotAction?: (hour: number, action: 'booking' | 'blocked' | 'closed') => void;
  onAppointmentClick: (apt: Appointment) => void;
  onBlockClick?: (block: CalendarBlock) => void;
  customers?: any[];
  services?: any[];
  staff?: any[];
}) {
  const [openSlotMenuHour, setOpenSlotMenuHour] = useState<number | null>(null);

  const layoutItems = useMemo(() => {
    const bookingItems: GridItem[] = dayAppointments.map((apt) => ({
      id: apt.id,
      kind: 'booking',
      startMinutes: parseTimeToMinutes(apt.start_time || '00:00'),
      endMinutes: parseTimeToMinutes(apt.end_time || '00:00'),
      appointment: apt,
    }));

    const blockItems = getDayBlocks(day, dayBlocks);
    return getGridLayout([...bookingItems, ...blockItems]);
  }, [day, dayAppointments, dayBlocks]);

  const runSlotAction = (hour: number, action: 'booking' | 'blocked' | 'closed') => {
    if (action === 'booking' && !onSlotAction) {
      onSlotClick(hour);
    }
    onSlotAction?.(hour, action);
    setOpenSlotMenuHour(null);
  };

  return (
    <div className="flex-1 min-w-[100px] border-r border-slate-100 dark:border-slate-800/50 last:border-r-0 bg-white/70 dark:bg-slate-900/35">
      {/* Day Header */}
      <div
        className={cn(
          'h-14 border-b border-slate-100 dark:border-slate-800/60 flex flex-col items-center justify-center sticky top-0 z-10 backdrop-blur-md transition-colors',
          isToday ? 'bg-primary/15 dark:bg-primary/25' : 'bg-white/95 dark:bg-slate-900/90',
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
          <Popover
            key={hour}
            open={openSlotMenuHour === hour}
            onOpenChange={(nextOpen) => setOpenSlotMenuHour(nextOpen ? hour : null)}
          >
            <PopoverTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpenSlotMenuHour(hour);
                  }
                }}
                className={cn(
                  'h-20 border-b border-slate-100 dark:border-slate-800/50 px-1 py-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  isWorkingHour(hour)
                    ? 'bg-primary/5 dark:bg-primary/10 hover:bg-primary/10 dark:hover:bg-primary/20'
                    : 'bg-slate-50/60 dark:bg-slate-900/30 hover:bg-slate-100/70 dark:hover:bg-slate-800/45',
                )}
              />
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="start">
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => runSlotAction(hour, 'booking')}
                  className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-accent transition-colors"
                >
                  Nueva cita
                </button>
                <button
                  type="button"
                  onClick={() => runSlotAction(hour, 'blocked')}
                  className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-accent transition-colors"
                >
                  Bloquear horario
                </button>
                <button
                  type="button"
                  onClick={() => runSlotAction(hour, 'closed')}
                  className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-accent transition-colors"
                >
                  Cerrar día completo
                </button>
              </div>
            </PopoverContent>
          </Popover>
        ))}

        {/* Appointments */}
        <TooltipProvider delayDuration={180} skipDelayDuration={80}>
          {layoutItems.map((apt) => {
            const visibleStart = 8 * 60;
            const visibleEnd = 21 * 60;
            const clippedStart = Math.max(apt.startMinutes, visibleStart);
            const clippedEnd = Math.min(apt.endMinutes, visibleEnd);

            if (clippedEnd <= clippedStart) return null;

            const top = ((clippedStart - visibleStart) / 60) * 80;
            const height = ((clippedEnd - clippedStart) / 60) * 80;

            const width = `calc(${100 / Math.max(apt.totalColumns, 1)}% - 6px)`;
            const left = `calc(${(100 / Math.max(apt.totalColumns, 1)) * apt.column}% + 4px)`;

            const isBooking = apt.kind === 'booking' && apt.appointment;
            const customer = isBooking ? customers?.find((c) => c.id === apt.appointment?.customer_id) : null;
            const service = isBooking ? services?.find((s) => s.id === apt.appointment?.service_id) : null;
            const member = isBooking ? staff?.find((s) => s.id === apt.appointment?.staff_id) : null;

            const cardStatus = isBooking
              ? (apt.appointment?.status || 'pending')
              : apt.kind;

            return (
              <AppointmentCard
                key={apt.id}
                apt={{
                  id: apt.id,
                  start_time: isBooking ? apt.appointment!.start_time : minutesToTime(clippedStart),
                  end_time: isBooking ? apt.appointment!.end_time : minutesToTime(clippedEnd),
                  notes: isBooking ? apt.appointment!.notes : apt.block?.reason || null,
                }}
                top={top}
                left={left}
                width={width}
                height={height}
                status={cardStatus}
                customerName={
                  isBooking
                    ? customer?.name || 'Cliente'
                    : apt.kind === 'closed'
                      ? 'Día cerrado'
                      : 'Horario bloqueado'
                }
                serviceName={
                  isBooking
                    ? service?.name || 'Servicio'
                    : apt.block?.reason || (apt.kind === 'closed' ? 'Negocio cerrado' : 'No disponible')
                }
                staffName={isBooking ? member?.name : undefined}
                accentColor={isBooking ? member?.color || undefined : undefined}
                onClick={() => {
                  if (isBooking) {
                    onAppointmentClick(apt.appointment!);
                  } else if (apt.block && onBlockClick) {
                    onBlockClick(apt.block);
                  }
                }}
                onDragStart={(e) => {
                  if (!isBooking) return;
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', JSON.stringify({ appointmentId: apt.id, originalTime: apt.appointment!.start_time }));
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
  calendarBlocks = [],
  onSlotClick,
  onSlotAction,
  onAppointmentClick,
  onBlockClick,
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

  const getBlocksForDay = useCallback(
    (date: Date) => {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      return calendarBlocks.filter((block) => {
        const start = parseTimestamp(block.start_time);
        const end = parseTimestamp(block.end_time);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
        return start < dayEnd && end > dayStart;
      });
    },
    [calendarBlocks],
  );

  return (
    <div className="flex-1 overflow-auto bg-slate-50/70 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-800/60">
      <div className="flex min-w-full">
        {/* Time Column Header */}
        <div className="w-20 shrink-0 border-r border-slate-100 dark:border-slate-800/60 bg-white/95 dark:bg-slate-900/90 sticky left-0 z-20 shadow-[1px_0_0_rgba(15,23,42,0.04)]">
          <div className="h-14 border-b border-slate-100 dark:border-slate-800/60 bg-white/98 dark:bg-slate-900/95 flex items-center justify-center">
            <span className="text-xs font-semibold text-muted-foreground">Hora</span>
          </div>
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="h-20 border-b border-slate-100 dark:border-slate-800/50 flex items-start justify-center pt-1.5"
            >
              <span className="text-xs font-semibold text-muted-foreground">{hour.toString().padStart(2, '0')}:00</span>
            </div>
          ))}
        </div>

        {/* Day Columns */}
        {displayDays.map((day) => {
          const dayAppointments = getAppointmentsForDay(day);
          const dayBlocks = getBlocksForDay(day);
          const isToday = isSameDay(day, new Date());

          return (
            <TimeGridColumn
              key={day.toISOString()}
              day={day}
              dayAppointments={dayAppointments}
              dayBlocks={dayBlocks}
              isToday={isToday}
              isWorkingHour={(hour) => isWorkingHour(day, hour)}
              onSlotClick={(hour) => onSlotClick(day, hour)}
              onSlotAction={(hour, action) => onSlotAction?.({ date: day, hour, action })}
              onAppointmentClick={onAppointmentClick}
              onBlockClick={onBlockClick}
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
