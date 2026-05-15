import { addDays } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { generateTimeSlots, getBestAvailableSlots, getDayAvailabilitySummary, getRankedAvailableSlots, isTimeSlotAvailable } from '@/lib/booking-utils';
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
    // With 30min appointment at 09:30-10:00, slots are: 09:00, 10:30, 11:30
    // (09:30 is occupado, 10:00 filtered, 11:00 filtered due to pattern)
    expect(summary.availableSlots).toBe(3);
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

    // With 30min appointments at 09:00-09:30 and 11:00-11:30, ranking includes:
    // Valid slots after first apt (09:00-09:30, offset 540): 09:30, 10:30, 11:30
    // Available slots: 09:30 (next to apt but free), 10:30, 11:30
    // Best ranking: 11:30, then 09:30, then 10:30
    expect(bestSlots).toEqual(['11:30', '09:30', '10:30']);
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

    expect(slots.map((slot) => slot.time)).toEqual(['09:30', '10:30', '11:30', '12:30']);
    expect(slots.map((slot) => slot.time)).not.toContain('10:00');
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

    // With a 30-min appointment in the block, the whole block aligns to one phase (:30).
    // For a 60-min service and conflict at 11:00-11:30, only 09:30 remains valid.
    expect(slots.map((slot) => slot.time)).toEqual(['09:30']);
    expect(slots.map((slot) => slot.time)).not.toContain('10:30');
  });

  describe('citas canceladas no bloquean disponibilidad', () => {
    const selectedDate = new Date(2026, 3, 20, 9, 0, 0);
    const opts = { now: new Date(2026, 3, 19, 10, 0, 0), slotMinutes: 30 };

    it.each([
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
      const canceledAppointment: Appointment = { ...baseAppointment, status: 'canceled' };

      const summaryWithCanceled = getDayAvailabilitySummary(
        [baseAvailability],
        [canceledAppointment],
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

      expect(summaryWithCanceled.availableSlots).toBe(summaryWithNoAppointments.availableSlots);
    });
  });

  describe('alineacion adaptativa por bloques', () => {
    const mondayDate = new Date(2026, 3, 20, 9, 0, 0);
    const defaultOpts = {
      now: new Date(2026, 3, 19, 10, 0, 0),
      slotMinutes: 30,
    };

    it('manana con citas de 30 min mantiene horarios de media hora para servicio corto', () => {
      const splitMorning: Availability = {
        ...baseAvailability,
        id: 'availability-morning-30',
        start_time: '09:00',
        end_time: '12:00',
      };

      const appointments: Appointment[] = [
        {
          ...baseAppointment,
          id: 'appointment-morning-1',
          start_time: '10:00',
          end_time: '10:30',
        },
      ];

      const slots = generateTimeSlots(
        [splitMorning],
        appointments,
        mondayDate,
        30,
        defaultOpts
      );

      // With a 30-min appointment at 10:00-10:30, the WHOLE block aligns to :30.
      // So 09:00 is no longer valid for this block pattern.
      expect(slots.map((slot) => slot.time)).toEqual(['09:30', '10:30', '11:30']);
    });

    it('tarde con servicio de 60 min prioriza horas enteras cuando no hay patron de media hora', () => {
      const afternoonOnly: Availability = {
        ...baseAvailability,
        id: 'availability-afternoon-hourly',
        start_time: '15:00',
        end_time: '19:00',
      };

      const slots = generateTimeSlots(
        [afternoonOnly],
        [],
        mondayDate,
        60,
        defaultOpts
      );

      expect(slots.map((slot) => slot.time)).toEqual(['15:00', '16:00', '17:00', '18:00']);
      expect(slots.map((slot) => slot.time)).not.toContain('15:30');
    });

    it('mezcla manana y tarde con alineacion distinta por bloque', () => {
      const morningHalfAligned: Availability = {
        ...baseAvailability,
        id: 'availability-morning-half',
        start_time: '09:30',
        end_time: '12:30',
      };
      const afternoonHourly: Availability = {
        ...baseAvailability,
        id: 'availability-afternoon-hourly-2',
        start_time: '15:00',
        end_time: '18:00',
      };

      const slots = generateTimeSlots(
        [morningHalfAligned, afternoonHourly],
        [],
        mondayDate,
        60,
        defaultOpts
      );

      expect(slots.map((slot) => slot.time)).toEqual(['09:30', '10:30', '11:30', '15:00', '16:00', '17:00']);
    });

    it('respeta pausa de mediodia y no mezcla bloques como ventana continua', () => {
      const morning: Availability = {
        ...baseAvailability,
        id: 'availability-morning-break',
        start_time: '09:00',
        end_time: '12:00',
      };
      const afternoon: Availability = {
        ...baseAvailability,
        id: 'availability-afternoon-break',
        start_time: '15:00',
        end_time: '18:00',
      };

      const slots = generateTimeSlots(
        [morning, afternoon],
        [],
        mondayDate,
        60,
        defaultOpts
      );

      const slotTimes = slots.map((slot) => slot.time);
      expect(slotTimes).toEqual(['09:00', '10:00', '11:00', '15:00', '16:00', '17:00']);
      expect(slotTimes).not.toContain('12:00');
      expect(slotTimes).not.toContain('12:30');
      expect(new Set(slotTimes).size).toBe(slotTimes.length);
    });

    it('adapta resultados al cambiar de staff', () => {
      const staffA = 'staff-a';
      const staffB = 'staff-b';

      const availabilityByStaff: Availability[] = [
        {
          ...baseAvailability,
          id: 'availability-staff-a',
          staff_id: staffA,
          start_time: '09:30',
          end_time: '13:30',
        },
        {
          ...baseAvailability,
          id: 'availability-staff-b',
          staff_id: staffB,
          start_time: '09:00',
          end_time: '13:00',
        },
      ];

      const staffASlots = generateTimeSlots(
        availabilityByStaff,
        [],
        mondayDate,
        60,
        {
          ...defaultOpts,
          staffId: staffA,
        }
      );

      const staffBSlots = generateTimeSlots(
        availabilityByStaff,
        [],
        mondayDate,
        60,
        {
          ...defaultOpts,
          staffId: staffB,
        }
      );

      expect(staffASlots.map((slot) => slot.time)).toEqual(['09:30', '10:30', '11:30', '12:30']);
      expect(staffBSlots.map((slot) => slot.time)).toEqual(['09:00', '10:00', '11:00', '12:00']);
    });

    it('adapta resultados al cambiar de servicio en el mismo bloque', () => {
      const shiftedBlock: Availability = {
        ...baseAvailability,
        id: 'availability-service-switch',
        start_time: '09:30',
        end_time: '13:30',
      };

      const slots30 = generateTimeSlots(
        [shiftedBlock],
        [],
        mondayDate,
        30,
        defaultOpts
      );

      const slots60 = generateTimeSlots(
        [shiftedBlock],
        [],
        mondayDate,
        60,
        defaultOpts
      );

      expect(slots30.map((slot) => slot.time)).toEqual(['09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00']);
      expect(slots60.map((slot) => slot.time)).toEqual(['09:30', '10:30', '11:30', '12:30']);
    });

    it('mantiene recomendaciones en slots alineados sin introducir horas fuera de lista', () => {
      const mixedBlocks: Availability[] = [
        {
          ...baseAvailability,
          id: 'availability-reco-morning',
          start_time: '09:30',
          end_time: '12:30',
        },
        {
          ...baseAvailability,
          id: 'availability-reco-afternoon',
          start_time: '15:00',
          end_time: '18:00',
        },
      ];

      const allSlots = generateTimeSlots(
        mixedBlocks,
        [],
        mondayDate,
        60,
        defaultOpts
      ).map((slot) => slot.time);

      const bestSlots = getBestAvailableSlots(
        mixedBlocks,
        [],
        mondayDate,
        60,
        defaultOpts
      );

      const ranked = getRankedAvailableSlots(
        mixedBlocks,
        [],
        mondayDate,
        60,
        defaultOpts
      );

      expect(bestSlots.length).toBeGreaterThan(0);
      expect(ranked.length).toBeGreaterThan(0);
      expect(bestSlots.every((slot) => allSlots.includes(slot))).toBe(true);
      expect(ranked.every((slot) => allSlots.includes(slot.time))).toBe(true);
      expect(new Set(allSlots).size).toBe(allSlots.length);
    });

    it('prioriza automaticamente la opcion que deja menos hueco muerto (10:00 y 12:00)', () => {
      const efficientWindow: Availability = {
        ...baseAvailability,
        id: 'availability-efficiency-priority',
        start_time: '10:30',
        end_time: '12:00',
      };

      const appointments: Appointment[] = [
        {
          ...baseAppointment,
          id: 'appointment-ten',
          start_time: '10:00',
          end_time: '10:30',
        },
        {
          ...baseAppointment,
          id: 'appointment-twelve',
          start_time: '12:00',
          end_time: '12:30',
        },
      ];

      const ranked = getRankedAvailableSlots(
        [efficientWindow],
        appointments,
        mondayDate,
        60,
        defaultOpts
      );

      const rankedTimes = ranked.map((slot) => slot.time);
      // With 30min appointment at 10:00-10:30, the block forces 30min alignment
      // Valid slots are those where (slot - 600 - 30) % 60 = 0
      // Only 10:30 fits (11:00 would violate the pattern, 11:30 exceeds latestStart)
      expect(rankedTimes[0]).toBe('10:30');
    });
  });

  describe('granularidad de bloques: filtrado real de slots (NO solo ranking)', () => {
    const selectedDate = new Date(2026, 3, 20, 9, 0, 0); // Same as baseAppointment date
    const baseOpts = {
      now: new Date(2026, 3, 19, 10, 0, 0),
      slotMinutes: 30,
    };

    it('CRÍTICO: tarde con cita de 30 min FILTRA slots de 60 min que rompen la alineación (14:00-14:30 existe, 15:00 no debe ofrecerse)', () => {
      // Simulate: 14:00-14:30 exists (30min appointment)
      // Service is 60min
      // MUST NOT offer 15:00 (leaves dead gap 14:30-15:00)
      // MUST offer 14:30, 15:30, 16:30 (aligned to 30min grid)
      const afternoonWindow: Availability = {
        ...baseAvailability,
        id: 'availability-afternoon-test',
        start_time: '14:00',
        end_time: '17:00',
      };

      const existingAppointment: Appointment = {
        ...baseAppointment,
        id: 'appointment-afternoon-30min',
        start_time: '14:00',
        end_time: '14:30',
        status: 'confirmed',
      };

      const slotsFor60MinService = generateTimeSlots(
        [afternoonWindow],
        [existingAppointment],
        selectedDate,
        60, // 60-minute service
        baseOpts
      );

      const slotTimes = slotsFor60MinService.map((s) => s.time);

      // MUST NOT include 15:00 (violates 30-min grid)
      expect(slotTimes).not.toContain('15:00');
      expect(slotTimes).not.toContain('16:00');

      // MUST include 14:30, 15:30 (aligned to 30-min grid)
      expect(slotTimes).toContain('14:30');
      expect(slotTimes).toContain('15:30');
    });

    it('bloque mañana con 30min → todas los slots alineados a 30min, servicio 60min ofrece 09:30, 10:30', () => {
      const morningWindow: Availability = {
        ...baseAvailability,
        id: 'availability-morning-granular',
        start_time: '09:00',
        end_time: '12:00',
      };

      const existingAppointment: Appointment = {
        ...baseAppointment,
        id: 'appointment-morning-30min',
        start_time: '09:00',
        end_time: '09:30',
        status: 'confirmed',
      };

      const slots = generateTimeSlots(
        [morningWindow],
        [existingAppointment],
        selectedDate,
        60,
        baseOpts
      );

      const slotTimes = slots.map((s) => s.time);

      // Should be aligned to 30-min grid: 09:30, 10:30 (11:30 + 60 = 12:30, exceeds window)
      expect(slotTimes).toEqual(['09:30', '10:30']);
      expect(slotTimes).not.toContain('10:00');
      expect(slotTimes).not.toContain('11:00');
      expect(slotTimes).not.toContain('15:00');
    });

    it('bloque limpio sin citas de 30min → puede mantener grid de 60min para servicio de 60min', () => {
      const cleanAfternoon: Availability = {
        ...baseAvailability,
        id: 'availability-afternoon-clean',
        start_time: '14:00',
        end_time: '18:00',
      };

      const slots = generateTimeSlots(
        [cleanAfternoon],
        [], // No appointments, clean block
        selectedDate,
        60,
        baseOpts
      );

      const slotTimes = slots.map((s) => s.time);

      // Clean afternoon can use hourly grid
      expect(slotTimes).toEqual(['14:00', '15:00', '16:00', '17:00']);
      expect(slotTimes).not.toContain('14:30');
    });

    it('dos bloques separados: mañana 30min + tarde 60min → cada bloque respeta su granularidad', () => {
      const morning: Availability = {
        ...baseAvailability,
        id: 'availability-morning-sep',
        start_time: '09:00',
        end_time: '12:00',
      };

      const afternoon: Availability = {
        ...baseAvailability,
        id: 'availability-afternoon-sep',
        start_time: '14:00',
        end_time: '17:00',
      };

      const morningAppointment: Appointment = {
        ...baseAppointment,
        id: 'appointment-morning-sep',
        start_time: '09:00',
        end_time: '09:30',
        status: 'confirmed',
      };

      const slots = generateTimeSlots(
        [morning, afternoon],
        [morningAppointment],
        selectedDate,
        60,
        baseOpts
      );

      const slotTimes = slots.map((s) => s.time);

      // Morning must be 30min aligned: 09:30, 10:30 (11:30 + 60 exceeds window)
      // Afternoon is clean, can use 60min grid: 14:00, 15:00, 16:00 (17:00 exceeds)
      expect(slotTimes).toEqual(['09:30', '10:30', '14:00', '15:00', '16:00']);
      expect(slotTimes).not.toContain('10:00');
      expect(slotTimes).not.toContain('11:00');
    });

    it('múltiples citas de 30min en bloque → fuerza grid de 30min incluso para servicio largo', () => {
      const busyAfternoon: Availability = {
        ...baseAvailability,
        id: 'availability-afternoon-busy',
        start_time: '14:00',
        end_time: '18:30',  // Extended to accommodate 90min services + multiple 30min appointments
      };

      const appointments: Appointment[] = [
        {
          ...baseAppointment,
          id: 'appointment-busy-1',
          start_time: '14:00',
          end_time: '14:30',
          status: 'confirmed',
        },
        {
          ...baseAppointment,
          id: 'appointment-busy-2',
          start_time: '16:00',  // Second appointment at 16:00
          end_time: '16:30',
          status: 'confirmed',
        },
      ];

      const slots = generateTimeSlots(
        [busyAfternoon],
        appointments,
        selectedDate,
        90, // 90-minute service (long)
        baseOpts
      );

      const slotTimes = slots.map((s) => s.time);

      // Block has 30min appointments (at 14:00 and 16:00) → must use 30min aligned grid
      // Valid offset is 14:00, so slots at (14:00 + 30 + N*60): 14:30, 15:30, 16:30, 17:30, 18:30
      // 14:30-16:00 available ✓ (doesn't conflict with cita 14:00-14:30 or 16:00-16:30)
      // 15:30-17:00 conflicts with cita 16:00-16:30 ✗
      // 16:30-18:00 available ✓ (ends before window end)
      // 17:30-19:00 exceeds window end 18:30 ✗
      // So available: 14:30, 16:30
      expect(slotTimes).toContain('14:30');
      expect(slotTimes).toContain('16:30');
      expect(slotTimes).not.toContain('15:30'); // Conflicts with appointment
      // Should NOT include hourly slots that would create gaps
      expect(slotTimes).not.toContain('15:00');
      expect(slotTimes).not.toContain('16:00');
    });

    it('verificar NO hay huecos muertos de 30min: si bloque fuerza 30min grid, todo se compacta', () => {
      const afternoonCompact: Availability = {
        ...baseAvailability,
        id: 'availability-afternoon-compact',
        start_time: '14:00',
        end_time: '17:00',
      };

      const appointment30: Appointment = {
        ...baseAppointment,
        id: 'appointment-compact-30',
        start_time: '14:00',
        end_time: '14:30',
        status: 'confirmed',
      };

      const slots = generateTimeSlots(
        [afternoonCompact],
        [appointment30],
        selectedDate,
        60, // 60-minute service
        baseOpts
      );

      const slotTimes = slots.map((s) => s.time);

      // After 14:00-14:30, next slot should be 14:30 (not 15:00), then 15:30
      // 16:30-17:30 would exceed the window end (17:00), so not offered
      // This ensures no 30-min dead gaps (14:30-15:00, 16:00-16:30, etc.)
      expect(slotTimes).toEqual(['14:30', '15:30']);

      // Verify manual: 14:30-15:30 fits (60min) ✓
      // After 15:30-16:30 would need 17:30 which is > 17:00 ✗
      // No dead gaps remain
      const expectedGapCheck = slotTimes.every((time) => {
        const timeMin = parseInt(time.split(':')[0]) * 60 + parseInt(time.split(':')[1]);
        return (timeMin % 30) === 0; // All align to 30min
      });
      expect(expectedGapCheck).toBe(true);
    });

    it('cambio dinámico: cuando aparece nueva cita de 30min, siguiente consulta genera slots con granularidad 30', () => {
      const afternoon: Availability = {
        ...baseAvailability,
        id: 'availability-afternoon-dynamic',
        start_time: '14:00',
        end_time: '17:00',
      };

      // First query: no appointments, clean afternoon
      const slotsClean = generateTimeSlots(
        [afternoon],
        [],
        selectedDate,
        60,
        baseOpts
      );

      // Second query: add 30min appointment
      const appointment30: Appointment = {
        ...baseAppointment,
        id: 'appointment-dynamic',
        start_time: '14:00',
        end_time: '14:30',
        status: 'confirmed',
      };

      const slotsWithAppointment = generateTimeSlots(
        [afternoon],
        [appointment30],
        selectedDate,
        60,
        baseOpts
      );

      const cleanTimes = slotsClean.map((s) => s.time);
      const dirtySlotsNow = slotsWithAppointment.map((s) => s.time);

      // Clean: hourly (14:00, 15:00, 16:00)
      expect(cleanTimes).toEqual(['14:00', '15:00', '16:00']);

      // With 30min appointment: must shift to 30-min grid (14:30, 15:30)
      // (16:30-17:30 would exceed window end 17:00)
      expect(dirtySlotsNow).toEqual(['14:30', '15:30']);
      expect(dirtySlotsNow).not.toContain('15:00');
    });
  });
});