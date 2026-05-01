import { addDays } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { generateTimeSlots, getBestAvailableSlots, getDayAvailabilitySummary, isTimeSlotAvailable } from '@/lib/booking-utils';
import type { Availability } from '@/hooks/use-availability';
import type { Appointment } from '@/hooks/use-appointments';

const baseAvailability: Availability = {
  id: 'availability-1',
  user_id: 'user-1',
  day_of_week: 1,
  start_time: '09:00',
  end_time: '12:00',
  is_active: true,
  staff_id: null,
  created_at: '2026-04-20T00:00:00.000Z',
  morning_active: null,
  morning_start_time: null,
  morning_end_time: null,
  afternoon_active: null,
  afternoon_start_time: null,
  afternoon_end_time: null,
};

const baseAppointment: Appointment = {
  id: 'appointment-1',
  user_id: 'user-1',
  customer_id: 'customer-1',
  service_id: 'service-1',
  staff_id: null,
  date: '2026-04-20',
  start_time: '09:30',
  end_time: '10:00',
  status: 'confirmed',
  notes: '',
  created_at: '2026-04-20T00:00:00.000Z',
  updated_at: '2026-04-20T00:00:00.000Z',
};

describe('booking-utils', () => {
  it('genera horarios disponibles dentro de la ventana configurada', () => {
    const selectedDate = new Date(2026, 3, 20, 9, 0, 0);

    const slots = generateTimeSlots(
      [baseAvailability],
      [],
      selectedDate,
      30,
      {
        now: new Date(2026, 3, 19, 10, 0, 0),
        slotMinutes: 30,
      }
    );

    expect(slots.map((slot) => slot.time)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });

  it('bloquea horarios ocupados y resume bien la disponibilidad diaria', () => {
    const selectedDate = new Date(2026, 3, 20, 9, 0, 0);

    const summary = getDayAvailabilitySummary(
      [baseAvailability],
      [baseAppointment],
      selectedDate,
      30,
      {
        now: new Date(2026, 3, 19, 10, 0, 0),
        slotMinutes: 30,
      }
    );

    expect(isTimeSlotAvailable([baseAvailability], [baseAppointment], selectedDate, '09:30', 30, {
      now: new Date(2026, 3, 19, 10, 0, 0),
      slotMinutes: 30,
    })).toBe(false);
    expect(summary.isAvailable).toBe(true);
    expect(summary.availableSlots).toBe(5);
  });

  it('respeta el limite maximo de dias por adelantado', () => {
    const now = new Date(2026, 3, 20, 10, 0, 0);
    const blockedDate = addDays(now, 8);

    const slots = generateTimeSlots(
      [baseAvailability],
      [],
      blockedDate,
      30,
      {
        now,
        maxDaysAhead: 7,
      }
    );

    expect(slots).toEqual([]);
  });

  it('usa el mismo day_of_week que guarda la configuracion publica', () => {
    const sundayAvailability: Availability = {
      ...baseAvailability,
      id: 'availability-sunday',
      day_of_week: 0,
    };

    const sunday = new Date(2026, 3, 19, 9, 0, 0);

    const slots = generateTimeSlots(
      [sundayAvailability],
      [],
      sunday,
      30,
      {
        now: new Date(2026, 3, 18, 10, 0, 0),
        slotMinutes: 30,
      }
    );

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]?.time).toBe('09:00');
  });

  it('prioriza slots que encajan mejor en la agenda', () => {
    const selectedDate = new Date(2026, 3, 20, 9, 0, 0);
    const appointments: Appointment[] = [
      {
        ...baseAppointment,
        id: 'appointment-early',
        start_time: '09:00',
        end_time: '09:30',
      },
      {
        ...baseAppointment,
        id: 'appointment-late',
        start_time: '11:00',
        end_time: '11:30',
      },
    ];

    const bestSlots = getBestAvailableSlots(
      [baseAvailability],
      appointments,
      selectedDate,
      30,
      {
        now: new Date(2026, 3, 19, 10, 0, 0),
        slotMinutes: 30,
      }
    );

    expect(bestSlots).toEqual(['11:30', '10:00', '09:30', '10:30']);
  });

  it('devuelve un maximo de cinco sugerencias para WhatsApp', () => {
    const selectedDate = new Date(2026, 3, 20, 9, 0, 0);

    const bestSlots = getBestAvailableSlots(
      [
        {
          ...baseAvailability,
          end_time: '13:00',
        },
      ],
      [],
      selectedDate,
      30,
      {
        now: new Date(2026, 3, 19, 10, 0, 0),
        slotMinutes: 30,
      }
    );

    expect(bestSlots).toHaveLength(5);
  });

  it('permite configurar intervalo por servicio y evita overflow al cierre', () => {
    const selectedDate = new Date(2026, 3, 20, 9, 0, 0);

    const slotsEveryHour = generateTimeSlots(
      [baseAvailability],
      [],
      selectedDate,
      60,
      {
        now: new Date(2026, 3, 19, 10, 0, 0),
        slotMinutes: 30,
        serviceSlotStepMinutes: 60,
      }
    );

    const slotsEveryThirty = generateTimeSlots(
      [baseAvailability],
      [],
      selectedDate,
      30,
      {
        now: new Date(2026, 3, 19, 10, 0, 0),
        slotMinutes: 30,
        serviceSlotStepMinutes: 30,
      }
    );

    expect(slotsEveryHour.map((slot) => slot.time)).toEqual(['09:00', '10:00', '11:00']);
    expect(slotsEveryThirty.map((slot) => slot.time)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
    expect(slotsEveryHour.map((slot) => slot.time)).not.toContain('11:30');
  });

  it('mantiene la rejilla global aunque el servicio tenga un paso mayor', () => {
    const shiftedAvailability: Availability = {
      ...baseAvailability,
      id: 'availability-shifted',
      start_time: '09:30',
      end_time: '13:30',
    };
    const selectedDate = new Date(2026, 3, 20, 9, 30, 0);

    const slots = generateTimeSlots(
      [shiftedAvailability],
      [],
      selectedDate,
      60,
      {
        now: new Date(2026, 3, 19, 10, 0, 0),
        slotMinutes: 30,
        serviceSlotStepMinutes: 60,
      }
    );

    expect(slots.map((slot) => slot.time)).toEqual(['10:00', '11:00', '12:00']);
    expect(slots.map((slot) => slot.time)).not.toContain('09:30');
    expect(slots.map((slot) => slot.time)).not.toContain('10:30');
  });

  it('exige que la duracion completa del servicio quepa libre antes de ofrecer un hueco', () => {
    const selectedDate = new Date(2026, 3, 20, 9, 0, 0);
    const conflictingAppointments: Appointment[] = [
      {
        ...baseAppointment,
        id: 'appointment-conflict-late',
        start_time: '11:00',
        end_time: '11:30',
      },
    ];

    const slots = generateTimeSlots(
      [baseAvailability],
      conflictingAppointments,
      selectedDate,
      60,
      {
        now: new Date(2026, 3, 19, 10, 0, 0),
        slotMinutes: 30,
        serviceSlotStepMinutes: 30,
      }
    );

    expect(slots.map((slot) => slot.time)).toEqual(['09:00', '09:30', '10:00']);
    expect(slots.map((slot) => slot.time)).not.toContain('10:30');
  });

  describe('citas canceladas no bloquean disponibilidad', () => {
    const selectedDate = new Date(2026, 3, 20, 9, 0, 0);
    const opts = { now: new Date(2026, 3, 19, 10, 0, 0), slotMinutes: 30 };

    it.each([
      ['cancelled'],
      ['canceled'],
      ['noshow'],
      ['completed'],
      ['rescheduled'],
    ])('ignora citas con status "%s" al calcular slots', (inactiveStatus) => {
      const inactiveAppointment: Appointment = {
        ...baseAppointment,
        status: inactiveStatus as Appointment['status'],
      };

      const slots = generateTimeSlots(
        [baseAvailability],
        [inactiveAppointment],
        selectedDate,
        30,
        opts
      );

      // El slot de 09:30 debe estar libre porque la cita está inactiva
      expect(slots.map((s) => s.time)).toContain('09:30');
    });

    it('sigue bloqueando slots con citas confirmed o pending', () => {
      const confirmedAppointment: Appointment = { ...baseAppointment, status: 'confirmed' };
      const pendingAppointment: Appointment = { ...baseAppointment, id: 'apt-2', start_time: '10:00', end_time: '10:30', status: 'pending' };

      const slots = generateTimeSlots(
        [baseAvailability],
        [confirmedAppointment, pendingAppointment],
        selectedDate,
        30,
        opts
      );

      expect(slots.map((s) => s.time)).not.toContain('09:30');
      expect(slots.map((s) => s.time)).not.toContain('10:00');
    });

    it('getDayAvailabilitySummary no cuenta citas canceladas como bloqueantes', () => {
      const cancelledAppointment: Appointment = { ...baseAppointment, status: 'canceled' };

      const summaryWithCancelled = getDayAvailabilitySummary(
        [baseAvailability],
        [cancelledAppointment],
        selectedDate,
        30,
        opts
      );
      const summaryWithNoAppointments = getDayAvailabilitySummary(
        [baseAvailability],
        [],
        selectedDate,
        30,
        opts
      );

      expect(summaryWithCancelled.availableSlots).toBe(summaryWithNoAppointments.availableSlots);
    });
  });
});