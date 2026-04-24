import { addMinutes, format, getDay, isBefore, isSameDay, startOfDay } from 'date-fns';
import type { Availability } from '@/hooks/use-availability';
import type { Appointment } from '@/hooks/use-appointments';
import type { AvailabilityException } from '@/hooks/use-availability-exceptions';
import type { CalendarBlock } from '@/hooks/use-calendar-blocks';

export interface TimeSlot {
  time: string;
  available: boolean;
  reason?: string;
}

export interface DayAvailabilitySummary {
  isAvailable: boolean;
  availableSlots: number;
  totalSlots: number;
}

interface SlotFitMetrics {
  totalGap: number;
  largestGap: number;
  gapCount: number;
}

export interface BookingRules {
  allowWeekends?: boolean;
  slotMinutes?: number;
  bufferMinutes?: number;
  minNoticeMinutes?: number;
  maxDaysAhead?: number;
  minGapMinutes?: number;
  timezone?: string | null;
}

export interface SlotQueryOptions extends BookingRules {
  staffId?: string | null;
  now?: Date;
  serviceIntervalMinutes?: number | null;
  exceptions?: AvailabilityException[];
  calendarBlocks?: CalendarBlock[];
}

const DEFAULT_RULES: Required<Omit<BookingRules, 'timezone'>> = {
  allowWeekends: true,
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  maxDaysAhead: 60,
  minGapMinutes: 0,
};

const NO_STAFF_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';

function toMinutes(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function normalizeRules(options?: SlotQueryOptions): Required<Omit<BookingRules, 'timezone'>> {
  return {
    allowWeekends: options?.allowWeekends ?? DEFAULT_RULES.allowWeekends,
    slotMinutes: Math.max(5, options?.slotMinutes ?? DEFAULT_RULES.slotMinutes),
    bufferMinutes: Math.max(0, options?.bufferMinutes ?? DEFAULT_RULES.bufferMinutes),
    minNoticeMinutes: Math.max(0, options?.minNoticeMinutes ?? DEFAULT_RULES.minNoticeMinutes),
    maxDaysAhead: Math.max(0, options?.maxDaysAhead ?? DEFAULT_RULES.maxDaysAhead),
    minGapMinutes: Math.max(0, options?.minGapMinutes ?? DEFAULT_RULES.minGapMinutes),
  };
}

function isSameStaff(staffA: string | null | undefined, staffB: string | null | undefined): boolean {
  return (staffA || NO_STAFF_PLACEHOLDER) === (staffB || NO_STAFF_PLACEHOLDER);
}

function hasSplitWindowShape(slot: Availability): boolean {
  return Boolean(
    slot.morning_active === true ||
    slot.afternoon_active === true
  );
}

function expandAvailabilityToWindows(slot: Availability): Availability[] {
  if (!hasSplitWindowShape(slot)) {
    return [slot];
  }

  const windows: Availability[] = [];

  if (slot.morning_active) {
    const morning_start = slot.morning_start_time || slot.start_time;
    const morning_end = slot.morning_end_time || slot.end_time;
    if (morning_start && morning_end) {
      windows.push({
        ...slot,
        start_time: morning_start,
        end_time: morning_end,
      });
    }
  }

  if (slot.afternoon_active) {
    const afternoon_start = slot.afternoon_start_time || slot.start_time;
    const afternoon_end = slot.afternoon_end_time || slot.end_time;
    if (afternoon_start && afternoon_end) {
      windows.push({
        ...slot,
        start_time: afternoon_start,
        end_time: afternoon_end,
      });
    }
  }

  return windows;
}

function getDayAvailabilities(
  availability: Availability[],
  dayOfWeek: number,
  staffId?: string | null
): Availability[] {
  return availability
    .filter((slot) => slot.day_of_week === dayOfWeek)
    .filter((slot) => {
      if (!staffId) return true;
      return !slot.staff_id || isSameStaff(slot.staff_id, staffId);
    })
    .flatMap((slot) => expandAvailabilityToWindows(slot))
    .filter((slot) => Boolean(slot.start_time && slot.end_time))
    .filter((slot) => toMinutes(slot.end_time) > toMinutes(slot.start_time))
    .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
}

function getAppointmentEndMinutes(appointment: Appointment): number {
  const start = toMinutes(appointment.start_time);
  if (appointment.end_time) {
    return toMinutes(appointment.end_time);
  }
  return start + 30;
}

function getDayAppointments(
  appointments: Appointment[],
  date: Date,
  staffId?: string | null
): Appointment[] {
  const dateStr = format(date, 'yyyy-MM-dd');

  return appointments.filter((appointment) => {
    if (
      appointment.date !== dateStr ||
      appointment.status === 'canceled' ||
      (staffId !== undefined && !isSameStaff(appointment.staff_id, staffId))
    ) {
      return false;
    }

    return true;
  });
}

function getContainingWindow(
  dayAvailabilities: Availability[],
  startMinutes: number,
  endMinutes: number
): Availability | undefined {
  return dayAvailabilities.find((window) => {
    const windowStart = toMinutes(window.start_time);
    const windowEnd = toMinutes(window.end_time);
    return startMinutes >= windowStart && endMinutes <= windowEnd;
  });
}

function parseCalendarBlockDate(value: string): Date | null {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function getDayCalendarBlocks(
  date: Date,
  calendarBlocks?: CalendarBlock[]
): CalendarBlock[] {
  if (!calendarBlocks?.length) return [];

  const dayStart = startOfDay(date);
  const dayEnd = addMinutes(dayStart, 24 * 60);

  return calendarBlocks.filter((block) => {
    const blockStart = parseCalendarBlockDate(block.start_time);
    const blockEnd = parseCalendarBlockDate(block.end_time);
    if (!blockStart || !blockEnd) return false;
    return blockStart < dayEnd && blockEnd > dayStart;
  });
}

function hasClosedDayBlock(date: Date, calendarBlocks?: CalendarBlock[]): boolean {
  return getDayCalendarBlocks(date, calendarBlocks).some((block) => block.type === 'closed');
}

function hasCalendarBlockCollision(
  date: Date,
  requestedStartMinutes: number,
  requestedEndMinutes: number,
  calendarBlocks?: CalendarBlock[]
): boolean {
  const dayStart = startOfDay(date);
  const requestStartDate = addMinutes(dayStart, requestedStartMinutes);
  const requestEndDate = addMinutes(dayStart, requestedEndMinutes);

  return getDayCalendarBlocks(date, calendarBlocks)
    .filter((block) => block.type === 'blocked' || block.type === 'closed')
    .some((block) => {
      const blockStart = parseCalendarBlockDate(block.start_time);
      const blockEnd = parseCalendarBlockDate(block.end_time);
      if (!blockStart || !blockEnd) return false;
      return requestStartDate < blockEnd && requestEndDate > blockStart;
    });
}

function getSlotFitMetrics(
  dayAvailabilities: Availability[],
  appointments: Appointment[],
  startMinutes: number,
  endMinutes: number
): SlotFitMetrics {
  const containingWindow = getContainingWindow(dayAvailabilities, startMinutes, endMinutes);
  if (!containingWindow) {
    return {
      totalGap: Number.POSITIVE_INFINITY,
      largestGap: Number.POSITIVE_INFINITY,
      gapCount: Number.POSITIVE_INFINITY,
    };
  }

  const windowStart = toMinutes(containingWindow.start_time);
  const windowEnd = toMinutes(containingWindow.end_time);

  const sortedAppointments = appointments
    .map((appointment) => ({
      start: toMinutes(appointment.start_time),
      end: getAppointmentEndMinutes(appointment),
    }))
    .filter((appointment) => appointment.end > windowStart && appointment.start < windowEnd)
    .sort((a, b) => a.start - b.start);

  const previousAppointment = [...sortedAppointments]
    .reverse()
    .find((appointment) => appointment.end <= startMinutes);
  const nextAppointment = sortedAppointments.find((appointment) => appointment.start >= endMinutes);

  const leftBoundary = previousAppointment?.end ?? windowStart;
  const rightBoundary = nextAppointment?.start ?? windowEnd;
  const leftGap = Math.max(0, startMinutes - leftBoundary);
  const rightGap = Math.max(0, rightBoundary - endMinutes);
  const gaps = [leftGap, rightGap].filter((gap) => gap > 0);

  return {
    totalGap: gaps.reduce((sum, gap) => sum + gap, 0),
    largestGap: gaps.length ? Math.max(...gaps) : 0,
    gapCount: gaps.length,
  };
}

/**
 * Get availability windows for a date, considering exceptions
 * If exception overrides hours, use those instead of normal availability
 */
function getDayAvailabilitiesWithExceptions(
  availability: Availability[],
  dayOfWeek: number,
  selectedDate: Date,
  staffId?: string | null,
  exceptions?: AvailabilityException[]
): Availability[] {
  // Check if date has an exception that overrides normal availability
  const dateStr = format(selectedDate, 'yyyy-MM-dd');
  const dayException = exceptions?.find(e => e.exception_date === dateStr);

  // If exception has custom hours, use only those
  if (dayException && !dayException.is_closed && dayException.start_time && dayException.end_time) {
    return [
      {
        ...dayException,
        day_of_week: dayOfWeek,
        is_active: true,
      } as Availability,
    ];
  }

  // Otherwise use normal day-of-week availability
  return getDayAvailabilities(availability, dayOfWeek, staffId);
}

function hasDateWindowAvailability(date: Date, options?: SlotQueryOptions): boolean {
  const now = options?.now ?? new Date();
  const rules = normalizeRules(options);
  const dayStart = startOfDay(date);
  const nowDayStart = startOfDay(now);

  if (isBefore(dayStart, nowDayStart)) {
    return false;
  }

  // Check if date is completely blocked by exception
  const exceptions = options?.exceptions ?? [];
  const dateStr = format(date, 'yyyy-MM-dd');
  const dayException = exceptions.find(e => e.exception_date === dateStr);
  if (dayException?.is_closed) {
    return false;
  }

  if (hasClosedDayBlock(date, options?.calendarBlocks)) {
    return false;
  }

  if (!rules.allowWeekends) {
    const day = getDay(date);
    if (day === 0 || day === 6) {
      return false;
    }
  }

  const diffMs = dayStart.getTime() - nowDayStart.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays > rules.maxDaysAhead) {
    return false;
  }
  return true;
}

/**
 * Simula la inserción de una nueva cita y comprueba si algún hueco libre
 * resultante es mayor que 0 pero menor que minGap (hueco muerto no aprovechable).
 * Los intervalos se expresan en minutos desde medianoche.
 */
export function createsBadGap(
  appointments: Appointment[],
  newStart: number,
  newEnd: number,
  minGap: number
): boolean {
  if (minGap <= 0) return false;

  const intervals: [number, number][] = appointments
    .filter((a) => a.status !== 'canceled' && a.start_time)
    .map((a) => [toMinutes(a.start_time), getAppointmentEndMinutes(a)] as [number, number]);

  // Añadir la cita propuesta
  intervals.push([newStart, newEnd]);

  // Ordenar por hora de inicio
  intervals.sort((a, b) => a[0] - b[0]);

  // Merge de intervalos solapados para evitar falsos positivos
  const merged: [number, number][] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1]) {
      last[1] = Math.max(last[1], interval[1]);
    } else {
      merged.push([...interval] as [number, number]);
    }
  }

  // Comprobar huecos entre intervalos consecutivos
  for (let i = 0; i < merged.length - 1; i++) {
    const gap = merged[i + 1][0] - merged[i][1];
    if (gap > 0 && gap < minGap) {
      return true;
    }
  }

  return false;
}

export function generateTimeSlots(
  availability: Availability[],
  appointments: Appointment[],
  selectedDate: Date,
  serviceDuration: number = 30,
  options?: SlotQueryOptions
): TimeSlot[] {
  if (!hasDateWindowAvailability(selectedDate, options)) {
    return [];
  }

  const rules = normalizeRules(options);
  const interval = Math.max(5, options?.serviceIntervalMinutes || rules.slotMinutes);
  const dayOfWeek = getDay(selectedDate);
  const dayAvailabilities = getDayAvailabilitiesWithExceptions(
    availability,
    dayOfWeek,
    selectedDate,
    options?.staffId,
    options?.exceptions
  );
  if (dayAvailabilities.length === 0) {
    return [];
  }

  const slots: TimeSlot[] = [];
  const seenTimes = new Set<string>();

  for (const window of dayAvailabilities) {
    const start = new Date(`1970-01-01T${window.start_time}`);
    const end = new Date(`1970-01-01T${window.end_time}`);
    // El slot solo es válido si el servicio completo cabe dentro de la ventana.
    // Restamos la duración del servicio para que el bucle no genere slots inválidos.
    const latestStart = new Date(end.getTime() - serviceDuration * 60_000);
    let currentTime = new Date(start);

    while (currentTime <= latestStart) {
      const timeString = format(currentTime, 'HH:mm');
      if (!seenTimes.has(timeString)) {
        const available = isTimeSlotAvailable(
          dayAvailabilities,
          appointments,
          selectedDate,
          timeString,
          serviceDuration,
          options
        );

        if (available) {
          slots.push({
            time: timeString,
            available: true,
          });
        }
        seenTimes.add(timeString);
      }
      currentTime = addMinutes(currentTime, interval);
    }
  }

  return slots.sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
}

export function getBestAvailableSlots(
  availability: Availability[],
  appointments: Appointment[],
  date: Date,
  serviceDuration: number = 30,
  options?: SlotQueryOptions
): string[] {
  const dayOfWeek = getDay(date);
  const dayAvailabilities = getDayAvailabilities(availability, dayOfWeek, options?.staffId);
  const dayAppointments = getDayAppointments(appointments, date, options?.staffId);

  return generateTimeSlots(availability, appointments, date, serviceDuration, options)
    .map((slot) => {
      const startMinutes = toMinutes(slot.time);
      const endMinutes = startMinutes + serviceDuration;
      const metrics = getSlotFitMetrics(dayAvailabilities, dayAppointments, startMinutes, endMinutes);

      return {
        time: slot.time,
        startMinutes,
        ...metrics,
      };
    })
    .sort((a, b) => {
      if (a.totalGap !== b.totalGap) {
        return a.totalGap - b.totalGap;
      }
      if (a.largestGap !== b.largestGap) {
        return a.largestGap - b.largestGap;
      }
      if (a.gapCount !== b.gapCount) {
        return a.gapCount - b.gapCount;
      }
      return a.startMinutes - b.startMinutes;
    })
    .slice(0, 5)
    .map((slot) => slot.time);
}

export function getAvailableDays(
  availability: Availability[],
  appointments: Appointment[],
  startDate: Date,
  daysCount: number = 30,
  serviceDuration: number = 30,
  options?: SlotQueryOptions
): Date[] {
  const availableDays: Date[] = [];

  for (let i = 0; i < daysCount; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);

    if (isDayAvailable(availability, appointments, date, serviceDuration, options)) {
      availableDays.push(date);
    }
  }

  return availableDays;
}

export function isTimeSlotAvailable(
  availability: Availability[],
  appointments: Appointment[],
  date: Date,
  startTime: string,
  duration: number = 30,
  options?: SlotQueryOptions
): boolean {
  if (!hasDateWindowAvailability(date, options)) {
    return false;
  }

  const rules = normalizeRules(options);
  const dayOfWeek = getDay(date);
  const dayAvailabilities = getDayAvailabilities(availability, dayOfWeek, options?.staffId);
  if (dayAvailabilities.length === 0 || duration <= 0) {
    return false;
  }

  const requestedStartMinutes = toMinutes(startTime);
  const requestedEndMinutes = requestedStartMinutes + duration;

  if (isSameDay(date, options?.now ?? new Date())) {
    const now = options?.now ?? new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (requestedStartMinutes < nowMinutes + rules.minNoticeMinutes) {
      return false;
    }
  }

  const fitsInAnyWindow = dayAvailabilities.some((window) => {
    const windowStart = toMinutes(window.start_time);
    const windowEnd = toMinutes(window.end_time);
    return requestedStartMinutes >= windowStart && requestedEndMinutes <= windowEnd;
  });
  if (!fitsInAnyWindow) {
    return false;
  }

  const dateStr = format(date, 'yyyy-MM-dd');

  const dayAppointments = getDayAppointments(appointments, date, options?.staffId);

  // Comprobar colisión con citas existentes (incluyendo buffer)
  const hasCollision = dayAppointments.some((appointment) => {
    const aptStartMinutes = toMinutes(appointment.start_time) - rules.bufferMinutes;
    const aptEndMinutes = getAppointmentEndMinutes(appointment) + rules.bufferMinutes;
    return requestedStartMinutes < aptEndMinutes && requestedEndMinutes > aptStartMinutes;
  });

  if (hasCollision) {
    return false;
  }

  if (hasCalendarBlockCollision(date, requestedStartMinutes, requestedEndMinutes, options?.calendarBlocks)) {
    return false;
  }

  // Comprobar que la cita propuesta no genera huecos muertos no aprovechables
  if (rules.minGapMinutes > 0) {
    if (createsBadGap(dayAppointments, requestedStartMinutes, requestedEndMinutes, rules.minGapMinutes)) {
      return false;
    }
  }

  return true;
}

export function isDayAvailable(
  availability: Availability[],
  appointments: Appointment[],
  date: Date,
  serviceDuration: number = 30,
  options?: SlotQueryOptions
): boolean {
  if (isBefore(startOfDay(date), startOfDay(options?.now ?? new Date()))) {
    return false;
  }

  const slots = generateTimeSlots(availability, appointments, date, serviceDuration, options);
  return slots.length > 0;
}

export function getAvailableSlotCount(
  availability: Availability[],
  appointments: Appointment[],
  date: Date,
  serviceDuration: number = 30,
  options?: SlotQueryOptions
): number {
  const dayAppointments = appointments.filter((apt) => apt.date === format(date, 'yyyy-MM-dd'));
  const slots = generateTimeSlots(availability, dayAppointments, date, serviceDuration, options);
  return slots.length;
}

export function getDayAvailabilitySummary(
  availability: Availability[],
  appointments: Appointment[],
  date: Date,
  serviceDuration: number = 30,
  options?: SlotQueryOptions
): DayAvailabilitySummary {
  const dayAppointments = appointments.filter((apt) => apt.date === format(date, 'yyyy-MM-dd'));
  const slots = generateTimeSlots(availability, dayAppointments, date, serviceDuration, options);
  const availableSlots = slots.length;

  return {
    isAvailable: availableSlots > 0,
    availableSlots,
    totalSlots: slots.length,
  };
}