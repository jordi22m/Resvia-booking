import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar, ChevronLeft, Check, Clock, MapPin, Loader2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useProfileBySlug } from '@/hooks/use-profile';
import type { Profile } from '@/hooks/use-profile';
import { useServicesByUserId, type Service } from '@/hooks/use-services';
import { useStaffByUserId, type StaffMember } from '@/hooks/use-staff';
import { useAvailabilityBySlug, type Availability } from '@/hooks/use-availability';
import { useAppointmentsBySlugAndDate, useAppointmentsBySlugAndDateRange, type Appointment } from '@/hooks/use-appointments';
import { generateTimeSlots, getDayAvailabilitySummary, isTimeSlotAvailable } from '@/lib/booking-utils';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

type Step = 'service' | 'calendar' | 'time' | 'details' | 'confirmed';
type BookingRpcResult = {
  id?: string;
  public_id?: string | null;
  cancel_token?: string | null;
  reschedule_token?: string | null;
};
type BookingConfirmationData = {
  publicId?: string | null;
  cancelUrl?: string | null;
  rescheduleUrl?: string | null;
};

const WEEKDAY_ES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

function formatBookingDateEs(date: Date): string {
  const weekday = WEEKDAY_ES[date.getDay()];
  const dayAndMonth = format(date, "d 'de' MMMM", { locale: es });
  return `${weekday}, ${dayAndMonth}`;
}

async function handleBookingSubmit({
  slug,
  profile,
  service,
  selectedDate,
  selectedTime,
  selectedStaff,
  formData,
  availability,
  appointments,
  setSubmitting,
  setConfirmationData,
  setStep,
  toast
}: {
  slug: string;
  profile: Profile;
  service: { id: string; duration: number; name: string; price: number };
  selectedDate: Date;
  selectedTime: string;
  selectedStaff: string | null;
  formData: { name: string; phone: string; email: string; notes: string };
  availability: Availability[];
  appointments: Appointment[];
  setSubmitting: (submitting: boolean) => void;
  setConfirmationData: (data: BookingConfirmationData | null) => void;
  setStep: (step: Step) => void;
  toast: (options: { title: string; description?: string; variant?: 'destructive' }) => void;
}) {
  if (!slug || !profile || !service || !selectedDate || !selectedTime) return;
  setSubmitting(true);

  const bookingRules = {
    allowWeekends: profile.allow_weekends ?? true,
    slotMinutes: profile.slot_minutes ?? 30,
    bufferMinutes: profile.buffer_minutes ?? 0,
    minNoticeMinutes: profile.min_notice_minutes ?? 0,
    maxDaysAhead: profile.max_days_ahead ?? 60,
    staffId: selectedStaff,
  };

  // Validate availability before creating appointment
  const isAvailable = isTimeSlotAvailable(
    availability,
    appointments,
    selectedDate,
    selectedTime,
    service.duration || 30,
    bookingRules
  );

  if (!isAvailable) {
    toast({
      title: 'Horario no disponible',
      description: 'Este horario ya no está disponible. Por favor selecciona otro.',
      variant: 'destructive'
    });
    setSubmitting(false);
    return;
  }

  const duration = service.duration || 30;
  const [h, m] = selectedTime.split(':').map(Number);
  const endMinutes = h * 60 + m + duration;
  const end_time = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;

  const { data, error } = await supabase.rpc('create_public_booking', {
    p_slug: slug,
    p_service_id: service.id,
    p_staff_id: selectedStaff || null,
    p_date: format(selectedDate, 'yyyy-MM-dd'),
    p_start_time: selectedTime,
    p_end_time: end_time,
    p_customer_name: formData.name,
    p_customer_phone: formData.phone,
    p_customer_email: formData.email || null,
    p_notes: formData.notes || null,
  });

  setSubmitting(false);
  if (error) {
    toast({ title: 'Error al crear reserva', description: error.message, variant: 'destructive' });
  } else {
    const baseUrl = window.location.origin;
    const rpcData = (typeof data === 'object' && data !== null ? data : { public_id: data }) as BookingRpcResult;
    const cancelUrl = rpcData.cancel_token ? `${baseUrl}/booking/cancel/${rpcData.cancel_token}` : null;
    const rescheduleUrl = rpcData.reschedule_token ? `${baseUrl}/booking/reschedule/${rpcData.reschedule_token}` : null;
    setConfirmationData({
      publicId: rpcData.public_id ?? null,
      cancelUrl,
      rescheduleUrl,
    });
    setStep('confirmed');
  }
}

export default function BookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: profile, isLoading: loadingProfile } = useProfileBySlug(slug);
  const { data: services, isLoading: loadingServices } = useServicesByUserId(profile?.user_id);
  const { data: staff } = useStaffByUserId(profile?.user_id);
  const { data: availability, isLoading: loadingAvailability } = useAvailabilityBySlug(slug);
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('service');
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', phone: '', email: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [confirmationData, setConfirmationData] = useState<BookingConfirmationData | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const service = services?.find((s: Service) => s.id === selectedService);
  const staffMember = staff?.find((s: StaffMember) => s.id === selectedStaff);
  const bookingRules = useMemo(() => ({
    allowWeekends: profile?.allow_weekends ?? true,
    slotMinutes: profile?.slot_minutes ?? 30,
    bufferMinutes: profile?.buffer_minutes ?? 0,
    minNoticeMinutes: profile?.min_notice_minutes ?? 0,
    maxDaysAhead: profile?.max_days_ahead ?? 60,
    staffId: selectedStaff,
  }), [profile, selectedStaff]);
  const requirePhone = profile?.require_phone ?? true;
  const requireEmail = profile?.require_email ?? false;

  // Get appointments for selected date
  const { data: dayAppointments, isLoading: loadingDayAppointments } = useAppointmentsBySlugAndDate(
    slug,
    selectedDate ? format(selectedDate, 'yyyy-MM-dd') : undefined
  );

  // Get appointments for current month (for calendar validation)
  const { data: monthAppointments, isLoading: loadingMonthAppointments } = useAppointmentsBySlugAndDateRange(
    slug,
    startOfMonth(currentMonth),
    endOfMonth(currentMonth)
  );

  // Generate available time slots for selected date
  const availableTimeSlots = useMemo(() => {
    if (!availability || !dayAppointments || !selectedDate || !service) return [];

    return generateTimeSlots(
      availability,
      dayAppointments,
      selectedDate,
      service.duration || 30,
      bookingRules
    );
  }, [availability, dayAppointments, selectedDate, service, bookingRules]);

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const monthDayAvailabilityMap = useMemo(() => {
    if (!availability || !monthAppointments || !service) return new Map<string, { isAvailable: boolean; availableSlots: number }>();

    const map = new Map<string, { isAvailable: boolean; availableSlots: number }>();
    for (const date of calendarDays) {
      const key = format(date, 'yyyy-MM-dd');
      const summary = getDayAvailabilitySummary(availability, monthAppointments, date, service.duration || 30, bookingRules);
      map.set(key, { isAvailable: summary.isAvailable, availableSlots: summary.availableSlots });
    }
    return map;
  }, [availability, monthAppointments, service, calendarDays, bookingRules]);

  // Check if a day has available slots
  const isDayAvailableForBooking = (date: Date) => {
    const key = format(date, 'yyyy-MM-dd');
    return monthDayAvailabilityMap.get(key)?.isAvailable ?? false;
  };

  const getDaySlotCount = (date: Date) => {
    const key = format(date, 'yyyy-MM-dd');
    return monthDayAvailabilityMap.get(key)?.availableSlots ?? 0;
  };

  // Etapa 1: Cargando perfil
  if (loadingProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Etapa 2: Perfil no encontrado
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Negocio no encontrado</p>
      </div>
    );
  }

  if (profile.booking_enabled === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center space-y-2">
            <h2 className="text-xl font-semibold text-foreground">Reservas desactivadas</h2>
            <p className="text-muted-foreground text-sm">
              Este negocio no está aceptando reservas online en este momento.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Etapa 3: Servicios cargando
  if (loadingServices || loadingAvailability) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Confirmed booking
  if (step === 'confirmed') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="p-8 space-y-4">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">¡Reserva confirmada!</h2>
            <p className="text-sm text-muted-foreground">Recibirás una confirmación en breve.</p>
            <div className="bg-secondary rounded-lg p-4 text-left space-y-2 text-sm">
              <p><strong>Servicio:</strong> {service?.name}</p>
              <p><strong>Profesional:</strong> {staffMember?.name || 'Cualquier profesional disponible'}</p>
              <p><strong>Fecha:</strong> {selectedDate ? `${formatBookingDateEs(selectedDate)} ${format(selectedDate, 'yyyy')}` : ''}</p>
              <p><strong>Hora:</strong> {selectedTime}</p>
              <p><strong>Nombre:</strong> {formData.name}</p>
              {confirmationData?.publicId ? <p><strong>Referencia:</strong> {confirmationData.publicId}</p> : null}
              {confirmationData?.cancelUrl ? (
                <p>
                  <strong>Cancelar:</strong>{' '}
                  <a className="text-primary underline" href={confirmationData.cancelUrl}>
                    enlace seguro
                  </a>
                </p>
              ) : null}
              {confirmationData?.rescheduleUrl ? (
                <p>
                  <strong>Reprogramar:</strong>{' '}
                  <a className="text-primary underline" href={confirmationData.rescheduleUrl}>
                    enlace seguro
                  </a>
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Calendar className="h-4 w-4 text-primary-foreground" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">{profile.business_name}</h1>
          </div>
          {profile.public_booking_title ? (
            <p className="text-sm font-medium text-foreground">{profile.public_booking_title}</p>
          ) : null}
          {profile.public_booking_description ? (
            <p className="text-sm text-muted-foreground mt-1">{profile.public_booking_description}</p>
          ) : null}
          {profile.address ? (
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {profile.address}
            </p>
          ) : null}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[
            { key: 'service', label: 'Servicio' },
            { key: 'calendar', label: 'Fecha' },
            { key: 'time', label: 'Hora' },
            { key: 'details', label: 'Datos' },
          ].map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                step === s.key ? 'bg-primary text-primary-foreground' :
                ['service', 'calendar', 'time', 'details'].indexOf(step) > i ? 'bg-primary text-primary-foreground' :
                'bg-secondary text-muted-foreground'
              )}>
                {['service', 'calendar', 'time', 'details'].indexOf(step) > i ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={cn(
                "text-xs hidden sm:block",
                step === s.key ? 'text-foreground font-medium' : 'text-muted-foreground'
              )}>
                {s.label}
              </span>
              {i < 3 ? <div className="w-8 h-px bg-border" /> : null}
            </div>
          ))}
        </div>

        {/* Service Selection */}
        {step === 'service' ? (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-semibold text-foreground mb-2">Elige un servicio</h2>
              <p className="text-muted-foreground">Selecciona el servicio que deseas reservar</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {services?.map(svc => (
                <Card
                  key={svc.id}
                  className={cn(
                    "cursor-pointer transition-all hover:shadow-md",
                    selectedService === svc.id ? 'ring-2 ring-primary shadow-md' : ''
                  )}
                  onClick={() => setSelectedService(svc.id)}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div
                        className="h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${svc.color || '#94a3b8'}20` }}
                      >
                        <div
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: svc.color || '#94a3b8' }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground truncate">{svc.name}</h3>
                        <p className="text-sm text-muted-foreground mb-2">{svc.description}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">
                            {Number(svc.price) > 0 ? `€${svc.price}` : 'Gratis'}
                          </span>
                          <span className="text-xs text-muted-foreground">{svc.duration} min</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex justify-center">
              <Button
                size="lg"
                disabled={!selectedService}
                onClick={() => setStep('calendar')}
                className="px-8"
              >
                Continuar
              </Button>
            </div>
          </div>
        ) : null}

        {/* Calendar Selection */}
        {step === 'calendar' ? (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-semibold text-foreground mb-2">Selecciona una fecha</h2>
              <p className="text-muted-foreground">Elige el día que prefieras para tu cita</p>
            </div>

            {/* Calendar */}
            <Card className="max-w-md mx-auto">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <CardTitle className="text-lg">
                    {format(currentMonth, "MMMM yyyy", { locale: es })}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Days of week */}
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => (
                    <div key={day} className="h-8 flex items-center justify-center text-xs font-medium text-muted-foreground">
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar days */}
                <div className="grid grid-cols-7 gap-1">
                  {loadingMonthAppointments ? (
                    <div className="col-span-7 flex items-center justify-center py-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Cargando disponibilidad...
                    </div>
                  ) : null}
                  {calendarDays.map(date => {
                    const isCurrentMonth = isSameMonth(date, currentMonth);
                    const isSelected = selectedDate && isSameDay(date, selectedDate);
                    const isToday = isSameDay(date, new Date());
                    const hasAvailability = isDayAvailableForBooking(date);
                    const availableSlotsCount = getDaySlotCount(date);

                    return (
                      <button
                        key={date.toISOString()}
                        onClick={() => {
                          if (!hasAvailability) return;
                          setSelectedDate(date);
                          setSelectedTime(null);
                        }}
                        disabled={!hasAvailability}
                        className={cn(
                          "h-11 w-11 rounded-xl text-sm font-medium transition-all relative flex items-center justify-center border",
                          !isCurrentMonth && "opacity-35",
                          isSelected && "bg-primary text-primary-foreground border-primary shadow-sm",
                          isToday && !isSelected && "border-primary/40",
                          hasAvailability && !isSelected && "border-border hover:border-primary/50 hover:bg-accent/70",
                          !hasAvailability && "text-muted-foreground/40 border-transparent cursor-not-allowed"
                        )}
                      >
                        <span>{format(date, 'd')}</span>
                        {hasAvailability ? (
                          <span
                            className={cn(
                              "absolute -bottom-1 right-0 text-[9px] min-w-4 px-1 rounded-full border leading-3 text-center",
                              isSelected
                                ? "bg-primary-foreground text-primary border-primary-foreground/40"
                                : "bg-background text-foreground border-border/70"
                            )}
                          >
                            {availableSlotsCount}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  Los días habilitados muestran la cantidad de horarios libres.
                </p>
              </CardContent>
            </Card>

            <div className="flex justify-center gap-4">
              <Button variant="outline" onClick={() => setStep('service')}>
                <ChevronLeft className="h-4 w-4 mr-2" />
                Atrás
              </Button>
              <Button
                size="lg"
                disabled={!selectedDate || !isDayAvailableForBooking(selectedDate)}
                onClick={() => setStep('time')}
                className="px-8"
              >
                Continuar
              </Button>
            </div>
          </div>
        ) : null}

        {/* Time Selection */}
        {step === 'time' ? (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-semibold text-foreground mb-2">Selecciona una hora</h2>
              <p className="text-muted-foreground">
                {selectedDate ? formatBookingDateEs(selectedDate) : ''}
              </p>
            </div>

            <Card className="max-w-md mx-auto">
              <CardContent className="p-6">
                {loadingDayAppointments ? (
                  <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Cargando horarios...
                  </div>
                ) : null}
                <div className="grid grid-cols-3 gap-3">
                  {availableTimeSlots.map(slot => (
                    <button
                      key={slot.time}
                      onClick={() => {
                        setSelectedTime(slot.time);
                        toast({
                          title: 'Horario seleccionado',
                          description: `${slot.time} (${service?.duration || 30} min)`
                        });
                      }}
                      className={cn(
                        "py-3 px-4 rounded-lg text-sm font-medium transition-all",
                        selectedTime === slot.time
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-border hover:border-primary hover:bg-accent'
                      )}
                    >
                      {slot.time}
                    </button>
                  ))}
                </div>

                {availableTimeSlots.length === 0 ? (
                  <div className="text-center py-8">
                    <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No hay horarios disponibles para esta fecha</p>
                  </div>
                ) : null}

                {availableTimeSlots.length > 0 ? (
                  <p className="text-xs text-muted-foreground mt-4 text-center">
                    {availableTimeSlots.length} horarios disponibles
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <div className="flex justify-center gap-4">
              <Button variant="outline" onClick={() => setStep('calendar')}>
                <ChevronLeft className="h-4 w-4 mr-2" />
                Atrás
              </Button>
              <Button
                size="lg"
                disabled={!selectedTime}
                onClick={() => setStep('details')}
                className="px-8"
              >
                Continuar
              </Button>
            </div>
          </div>
        ) : null}

        {/* Details Form */}
        {step === 'details' ? (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-semibold text-foreground mb-2">Tus datos</h2>
              <p className="text-muted-foreground">Completa la información para confirmar tu reserva</p>
            </div>

            {/* Booking Summary */}
            <Card className="max-w-md mx-auto">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div
                    className="h-10 w-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${service?.color || '#94a3b8'}20` }}
                  >
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: service?.color || '#94a3b8' }}
                    />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{service?.name}</p>
                    <p className="text-sm text-muted-foreground">{service?.duration} min</p>
                  </div>
                </div>

                <div className="border-t pt-3 space-y-1 text-sm">
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Profesional:</span>
                    <span>{staffMember?.name || 'Cualquier disponible'}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Fecha:</span>
                    <span>{selectedDate && format(selectedDate, "d/MM/yyyy", { locale: es })}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Hora:</span>
                    <span>{selectedTime}</span>
                  </p>
                  <p className="flex justify-between font-medium">
                    <span>Total:</span>
                    <span>{Number(service?.price) > 0 ? `€${service.price}` : 'Gratis'}</span>
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Form */}
            <Card className="max-w-md mx-auto">
              <CardContent className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nombre completo *</label>
                  <Input
                    placeholder="Tu nombre"
                    value={formData.name}
                    onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Teléfono {requirePhone ? '*' : ''}</label>
                  <Input
                    placeholder="Número de teléfono"
                    value={formData.phone}
                    onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Email {requireEmail ? '*' : ''}</label>
                  <Input
                    type="email"
                    placeholder="tu@email.com"
                    value={formData.email}
                    onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Notas (opcional)</label>
                  <Textarea
                    placeholder="Información adicional..."
                    value={formData.notes}
                    onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))}
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-center gap-4">
              <Button variant="outline" onClick={() => setStep('time')}>
                <ChevronLeft className="h-4 w-4 mr-2" />
                Atrás
              </Button>
              <Button
                size="lg"
                disabled={
                  !formData.name ||
                  (requirePhone && !formData.phone) ||
                  (requireEmail && !formData.email) ||
                  submitting
                }
                onClick={() => handleBookingSubmit({
                  slug: slug || '',
                  profile,
                  service,
                  selectedDate,
                  selectedTime,
                  selectedStaff,
                  formData,
                  availability: availability || [],
                  appointments: dayAppointments || [],
                  setSubmitting,
                  setConfirmationData,
                  setStep,
                  toast
                })}
                className="px-8"
              >
                <span className="inline-flex h-4 w-4 items-center justify-center mr-2">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                </span>
                <span>Confirmar reserva</span>
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}