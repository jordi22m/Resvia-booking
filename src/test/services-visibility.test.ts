import { describe, expect, it } from 'vitest';
import { toInternalServices, toPublicBookingServices } from '@/hooks/use-services';

function buildRawService(overrides: Record<string, unknown> = {}) {
  return {
    id: 'service-1',
    user_id: 'user-1',
    name: 'Servicio base',
    duration: 60,
    price: 50,
    active: true,
    bookable_online: true,
    show_in_booking: true,
    description: '',
    category: 'General',
    color: '#94a3b8',
    created_at: '2026-05-15T00:00:00.000Z',
    updated_at: '2026-05-15T00:00:00.000Z',
    interval_minutes: null,
    slot_step_minutes: null,
    requires_staff: true,
    buffer_before: 0,
    buffer_after: 0,
    ...overrides,
  } as any;
}

describe('services public visibility', () => {
  it('servicio visible aparece en booking publico', () => {
    const services = [
      buildRawService({ id: 'visible-1', name: 'Primera visita nutricion', show_in_booking: true }),
    ];

    const publicServices = toPublicBookingServices(services);

    expect(publicServices).toHaveLength(1);
    expect(publicServices[0]?.id).toBe('visible-1');
  });

  it('servicio oculto no aparece en booking publico', () => {
    const services = [
      buildRawService({ id: 'visible-1', show_in_booking: true }),
      buildRawService({ id: 'hidden-1', name: 'Seguimiento nutricion', show_in_booking: false }),
    ];

    const publicServices = toPublicBookingServices(services);

    expect(publicServices.map((service) => service.id)).toEqual(['visible-1']);
    expect(publicServices.map((service) => service.id)).not.toContain('hidden-1');
  });

  it('servicio oculto sigue funcionando para agenda interna/manual', () => {
    const services = [
      buildRawService({ id: 'hidden-1', name: 'Seguimiento nutricion', show_in_booking: false }),
    ];

    const internalServices = toInternalServices(services);

    expect(internalServices).toHaveLength(1);
    expect(internalServices[0]?.id).toBe('hidden-1');
    expect(internalServices[0]?.show_in_booking).toBe(false);
  });

  it('citas antiguas siguen resolviendo su servicio por id aunque este oculto', () => {
    const appointmentServiceId = 'legacy-service-1';
    const services = [
      buildRawService({ id: appointmentServiceId, name: 'Seguimiento legacy', show_in_booking: false }),
    ];

    const internalServices = toInternalServices(services);
    const resolvedService = internalServices.find((service) => service.id === appointmentServiceId);

    expect(resolvedService).toBeDefined();
    expect(resolvedService?.name).toBe('Seguimiento legacy');
  });

  it('recordatorios y webhooks no se rompen al poder resolver servicio oculto internamente', () => {
    const services = [
      buildRawService({ id: 'svc-webhook', name: 'Seguimiento nutricion', show_in_booking: false }),
    ];

    const internalServices = toInternalServices(services);
    const serviceForEvent = internalServices.find((service) => service.id === 'svc-webhook');

    expect(serviceForEvent).toBeDefined();
    expect(serviceForEvent?.duration).toBe(60);
    expect(serviceForEvent?.price).toBe(50);
  });
});
