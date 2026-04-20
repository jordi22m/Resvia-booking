import { addMinutes, format, getDay, isBefore, isSameDay, startOfDay } from 'date-fns';
import type { Availability } from '@/hooks/use-availability';
import type { Appointment } from '@/hooks/use-appointments';

console.log("DATE:", selectedDate);
console.log("AVAILABILITY:", availability);
console.log("APPOINTMENTS:", appointments);

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

export interface BookingRules {
  allowWeekends?: boolean;
  slotMinutes?: number;
  bufferMinutes?: number;
  minNoticeMinutes?: number;
  maxDaysAhead?: number;
  timezone?: string | null;
}

export interface SlotQueryOptions extends BookingRules {
  staffId?: string | null;
  now?: Date;
}

const DEFAULT_RULES: Required<Omit<BookingRules, 'timezone'>> = {
  allowWeekends: true,
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  maxDaysAhead: 60,
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
  };
}

function isSameStaff(staffA: string | null | undefined, staffB: string | null | undefined): boolean {
  return (staffA || NO_STAFF_PLACEHOLDER) === (staffB || NO_STAFF_PLACEHOLDER);
}

function hasSplitWindowShape(slot: Availability): boolean {
  return Boolean(
    slot.morning_active !== undefined ||
    slot.afternoon_active !== undefined ||
    slot.morning_start_time ||
    slot.morning_end_time ||
    slot.afternoon_start_time ||
    slot.afternoon_end_time
  );
}

function expandAvailabilityToWindows(slot: Availability): Availability[] {
  if (!hasSplitWindowShape(slot)) {
    return [slot];
  }

  const windows: Availability[] = [];

  if (slot.morning_active && slot.morning_start_time && slot.morning_end_time) {
    windows.push({
      ...slot,
      start_time: slot.morning_start_time,
      end_time: slot.morning_end_time,
    });
  }

  if (slot.afternoon_active && slot.afternoon_start_time && slot.afternoon_end_time) {
    windows.push({
      ...slot,
      start_time: slot.afternoon_start_time,
      end_time: slot.afternoon_end_time,
    });
  }

  return windows;
}

function getDayAvailabilities(
  availability: Availability[],
  dayOfWeek: number,
  staffId?: string | null
): Availability[] {
  // getDay() devuelve 0=Dom,1=Lun...6=Sab
  // BD usa 1=Lun,2=Mar...6=Sab,7=Dom
  const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek;

  return availability
    .filter((slot) => slot.day_of_week === isoDay)
    .filter((slot) => !slot.staff_id || isSameStaff(slot.staff_id, staffId))
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
  return start + (appointment.service?.duration || 30);
}

function hasDateWindowAvailability(date: Date, options?: SlotQueryOptions): boolean {
  const now = options?.now ?? new Date();
  const rules = normalizeRules(options);
  const dayStart = startOfDay(date);
  const nowDayStart = startOfDay(now);

  if (isBefore(dayStart, nowDayStart)) {
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
 return true;
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
  const dayOfWeek = getDay(selectedDate);
  const dayAvailabilities = getDayAvailabilities(availability, dayOfWeek, options?.staffId);
  console.log("DAY AVAILABILITIES:", dayAvailabilities);
  if (dayAvailabilities.length === 0) {
    return [];
  }

  const slots: TimeSlot[] = [];
  const seenTimes = new Set<string>();

  for (const window of dayAvailabilities) {
    const start = new Date(`1970-01-01T${window.start_time}`);
    const end = new Date(`1970-01-01T${window.end_time}`);
    let currentTime = new Date(start);

    while (currentTime < end) {
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
      currentTime = addMinutes(currentTime, rules.slotMinutes);
    }
  }

  return slots.sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
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

  return !appointments.some(appointment => {
    if (
      appointment.date !== dateStr ||
      (options?.staffId !== undefined && !isSameStaff(appointment.staff_id, options.staffId)) ||
      appointment.status === 'cancelled' ||
      appointment.status === 'canceled'
    ) {
      return false;
    }

    const aptStartMinutes = toMinutes(appointment.start_time) - rules.bufferMinutes;
    const aptEndMinutes = getAppointmentEndMinutes(appointment) + rules.bufferMinutes;

    return requestedStartMinutes < aptEndMinutes && requestedEndMinutes > aptStartMinutes;
  });
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