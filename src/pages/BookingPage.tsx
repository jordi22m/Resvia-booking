import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar, ChevronLeft, Check, Clock, MapPin, Loader2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { StaffSelector } from '@/components/StaffSelector';
import { useProfileBySlug } from '@/hooks/use-profile';
import type { Profile } from '@/hooks/use-profile';
import { useServicesByUserId, type Service } from '@/hooks/use-services';
import { useStaffByUserId, type StaffMember } from '@/hooks/use-staff';
import { useAvailabilityBySlug, useStaffAvailabilityBySlug, type Availability } from '@/hooks/use-availability';
import { useAvailabilityExceptionsBySlug, type AvailabilityException } from '@/hooks/use-availability-exceptions';
import { useAppointmentsBySlugAndDate, useAppointmentsBySlugAndDateRange, type Appointment } from '@/hooks/use-appointments';
import { useCalendarBlocksBySlugAndDateRange, type CalendarBlock } from '@/hooks/use-calendar-blocks';
import { generateTimeSlots, getDayAvailabilitySummary, isTimeSlotAvailable, getBestAvailableSlots } from '@/lib/booking-utils';
import { trackRecommendedSlotBooking } from '@/lib/recommended-slot-analytics';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

type Step = 'booking' | 'confirmed';
type BookingRpcResult = {
  id?: string;
  public_id?: string | null;
  cancel_token?: string | null;
  reschedule_token?: string | null;
};
type BookingConfirmationData = {
  flow?: 'booking' | 'reschedule';
  publicId?: string | null;
  cancelUrl?: string | null;
  rescheduleUrl?: string | null;
};

const WEEKDAY_ES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const WEEKDAY_SHORT_ES = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

function formatBookingDateEs(date: Date): string {
  const weekday = WEEKDAY_ES[date.getDay()];
  const dayAndMonth = format(date, "d 'de' MMMM", { locale: es });
  return `${weekday}, ${dayAndMonth}`;
}

function toUserBookingError(errorMessage: string | null): string {
  if (!errorMessage) return 'No pudimos completar tu solicitud. Intenta nuevamente.';

  const lowerMessage = errorMessage.toLowerCase();
  
  // Backend validation errors (new)
  if (lowerMessage.includes('anticipacion') || lowerMessage.includes('tiempo de anticipacion')) {
    return 'Debes reservar con más tiempo de anticipación. Por favor elige una fecha más adelante.';
  }

  if (lowerMessage.includes('excede') || lowerMessage.includes('limite permitido') || lowerMessage.includes('maximo')) {
    return 'La fecha que seleccionaste está muy lejos. Por favor elige una fecha más próxima.';
  }

  if (lowerMessage.includes('fin de semana')) {
    return 'Las reservas no están permitidas en fin de semana. Por favor elige otro día.';
  }

  // Existing error handling
  if (lowerMessage.includes('token') || lowerMessage.includes('no encontrado') || lowerMessage.includes('not found')) {
    return 'Este enlace de reprogramacion no es valido o ya no esta disponible.';
  }

  if (lowerMessage.includes('ya no puede reprogramarse')) {
    return 'Esta cita ya no puede reprogramarse.';
  }

  if (lowerMessage.includes('horario') || lowerMessage.includes('disponible') || lowerMessage.includes('exclusion')) {
    return 'Ese horario ya no esta disponible. Elige otro e intentalo de nuevo.';
  }

  return 'No pudimos guardar tu cita. Intenta nuevamente en unos minutos.';
}

function TimeSlotsSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('grid gap-3', compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4')}>
      {Array.from({ length: compact ? 4 : 8 }, (_, index) => (
        <Skeleton
          key={index}
          className={cn(
            'rounded-2xl',
            compact ? 'h-16' : 'h-20'
          )}
        />
      ))}
    </div>
  );
}

function CalendarDayButton({
  date,
  isCurrentMonth,
  isSelected,
  isToday,
  hasAvailability,
  availableSlotsCount,
  hoverLabel,
  onSelect,
}: {
  date: Date;
  isCurrentMonth: boolean;
  isSelected: boolean | null;
  isToday: boolean;
  hasAvailability: boolean;
  availableSlotsCount: number;
  hoverLabel: string;
  onSelect: (date: Date) => void;
}) {
  const isFullDay = isCurrentMonth && !hasAvailability;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <button
            type="button"
            onClick={() => {
              if (!hasAvailability) return;
              onSelect(date);
            }}
            disabled={!hasAvailability}
            className={cn(
              'group relative flex h-14 w-full min-w-[44px] flex-col items-center justify-center overflow-hidden rounded-2xl border text-sm font-semibold transition-all duration-200 ease-out',
              'before:absolute before:inset-x-2 before:bottom-1 before:h-1 before:rounded-full before:transition-opacity',
              !isCurrentMonth && 'opacity-30',
              isSelected && 'scale-[1.03] border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20 before:bg-primary-foreground',
              isToday && !isSelected && 'border-primary/40 ring-2 ring-primary/10',
              hasAvailability && !isSelected && 'border-emerald-200 bg-gradient-to-b from-emerald-50 to-background text-emerald-950 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md hover:shadow-emerald-100 before:bg-emerald-400',
              isFullDay && 'border-border/40 bg-muted/70 text-muted-foreground cursor-not-allowed before:bg-muted-foreground/30',
              !isCurrentMonth && !isSelected && 'border-transparent bg-transparent text-muted-foreground/40 before:hidden'
            )}
          >
            <span className="relative z-10 leading-none">{format(date, 'd')}</span>
            <span className="relative z-10 mt-1 text-[10px] font-medium opacity-75">
              {hasAvailability ? `${availableSlotsCount} horarios` : 'sin huecos'}
            </span>
            {hasAvailability ? (
              <span
                className={cn(
                  'absolute right-2 top-2 h-2.5 w-2.5 rounded-full',
                  isSelected ? 'bg-primary-foreground' : 'bg-emerald-500'
                )}
              />
            ) : null}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{hoverLabel}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function TimeSlotButton({
  slot,
  isSelected,
  onSelect,
}: {
  slot: { time: string; isRecommended?: boolean; isPrimaryRecommended?: boolean };
  isSelected: boolean;
  onSelect: (time: string) => void;
}) {
  const buttonContent = (
    <button
      type="button"
      onClick={() => onSelect(slot.time)}
      className={cn(
        'group rounded-2xl border px-4 py-4 text-left transition-all duration-200 ease-out',
        'min-h-[76px] focus:outline-none focus:ring-2 focus:ring-primary/20',
        isSelected
          ? 'border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20'
          : slot.isPrimaryRecommended
            ? 'border-amber-400/90 bg-amber-50/90 shadow-[0_0_0_2px_rgba(245,158,11,0.22)] hover:-translate-y-0.5 hover:border-amber-500 hover:bg-amber-50 hover:shadow-lg dark:bg-amber-950/30 dark:border-amber-700/80'
            : slot.isRecommended
            ? 'border-emerald-300/80 bg-emerald-50/80 shadow-[0_0_0_1px_rgba(16,185,129,0.15)] hover:-translate-y-0.5 hover:border-emerald-400 hover:bg-emerald-50 hover:shadow-md dark:bg-emerald-950/20 dark:border-emerald-700/70'
            : 'border-border bg-card hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent/60 hover:shadow-md'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold tracking-tight">{slot.time}</span>
          {slot.isPrimaryRecommended && !isSelected ? (
            <span className="inline-flex items-center rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:border-amber-700 dark:bg-amber-900/45 dark:text-amber-200">
              🔥 Mejor opción
            </span>
          ) : null}
          {!slot.isPrimaryRecommended && slot.isRecommended && !isSelected ? (
            <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
              ⭐ Recomendado
            </span>
          ) : null}
        </div>
        {isSelected ? <Check className="h-4 w-4 shrink-0" /> : <Clock className="h-4 w-4 shrink-0 opacity-50 group-hover:opacity-80" />}
      </div>
      <p className={cn('mt-1 text-xs', isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
        {slot.isPrimaryRecommended || slot.isRecommended
          ? 'Recomendado para aprovechar mejor el tiempo del negocio'
          : 'Disponible para reservar'}
      </p>
    </button>
  );

  if (!slot.isRecommended) {
    return buttonContent;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
      <TooltipContent>
        <p>Este horario evita huecos muertos en la agenda</p>
      </TooltipContent>
    </Tooltip>
  );
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
  calendarBlocks,
  rescheduleToken,
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
  calendarBlocks: CalendarBlock[];
  rescheduleToken?: string | null;
  setSubmitting: (submitting: boolean) => void;
  setConfirmationData: (data: BookingConfirmationData | null) => void;
  setStep: (step: Step) => void;
  toast: (options: { title: string; description?: string; variant?: 'destructive' }) => void;
}): Promise<boolean> {
  if (!slug || !profile || !service || !selectedDate || !selectedTime) return false;
  setSubmitting(true);

  const bookingRules = {
    allowWeekends: profile.allow_weekends ?? true,
    slotMinutes: profile.slot_minutes ?? 30,
    bufferMinutes: profile.buffer_minutes ?? 0,
    minNoticeMinutes: profile.min_notice_minutes ?? 0,
    maxDaysAhead: profile.max_days_ahead ?? 60,
    staffId: selectedStaff,
    calendarBlocks,
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
      description: 'Este horario ya no esta disponible. Selecciona otro.',
      variant: 'destructive'
    });
    setSubmitting(false);
    return false;
  }

  const duration = service.duration || 30;
  const [h, m] = selectedTime.split(':').map(Number);
  const endMinutes = h * 60 + m + duration;
  const end_time = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;

  const bookingPayload = {
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
  };

  const { data, error } = rescheduleToken
    ? await supabase.rpc('reschedule_booking_by_token', {
        p_token: rescheduleToken,
        p_service_id: service.id,
        p_staff_id: selectedStaff || null,
        p_date: format(selectedDate, 'yyyy-MM-dd'),
        p_start_time: selectedTime,
        p_end_time: end_time,
        p_notes: formData.notes || null,
      })
    : await supabase.rpc('create_public_booking', bookingPayload);

  setSubmitting(false);
  if (error) {
    const friendlyError = toUserBookingError(error.message);
    toast({
      title: rescheduleToken ? 'No se pudo reprogramar' : 'Error al crear reserva',
      description: friendlyError,
      variant: 'destructive'
    });
    return false;
  } else {
    const baseUrl = window.location.origin;
    const rpcData = (typeof data === 'object' && data !== null ? data : { public_id: data }) as BookingRpcResult;
    const cancelToken = rpcData.cancel_token ?? null;
    const nextRescheduleToken = rpcData.reschedule_token ?? rescheduleToken ?? null;
    const cancelUrl = cancelToken ? `${baseUrl}/booking/cancel/${cancelToken}` : null;
    const rescheduleUrl = nextRescheduleToken ? `${baseUrl}/booking/reschedule/${nextRescheduleToken}` : null;
    setConfirmationData({
      flow: rescheduleToken ? 'reschedule' : 'booking',
      publicId: rpcData.public_id ?? null,
      cancelUrl,
      rescheduleUrl,
    });
    setStep('confirmed');
    return true;
  }
}

export default function BookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const rescheduleToken = searchParams.get('rescheduleToken')?.trim() || '';
  const isRescheduleFlow = Boolean(rescheduleToken);
  
  // State hooks first
  const [step, setStep] = useState<Step>('booking');
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [isAutoSelectedTime, setIsAutoSelectedTime] = useState(false);
  const [formData, setFormData] = useState({ name: '', phone: '', email: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [confirmationData, setConfirmationData] = useState<BookingConfirmationData | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [monthDirection, setMonthDirection] = useState<'next' | 'prev'>('next');
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const calendarSectionRef = useRef<HTMLDivElement | null>(null);
  const timeSectionRef = useRef<HTMLDivElement | null>(null);
  
  // Query hooks
  const { data: profile, isLoading: loadingProfile, error: profileError } = useProfileBySlug(slug);
  const { data: services, isLoading: loadingServices, error: servicesError } = useServicesByUserId(profile?.user_id);
  const { data: staff } = useStaffByUserId(profile?.user_id);
  
  // Get availability based on whether staff is selected
  const { data: globalAvailability, isLoading: loadingGlobalAvailability, error: globalAvailabilityError } = useAvailabilityBySlug(slug);
  const { data: staffAvailability, isLoading: loadingStaffAvailability, error: staffAvailabilityError } = useStaffAvailabilityBySlug(slug, selectedStaff || undefined);
  
  // Use staff availability if selected, otherwise use global
  const availability = selectedStaff ? staffAvailability : globalAvailability;
  const loadingAvailability = selectedStaff ? loadingStaffAvailability : loadingGlobalAvailability;
  const availabilityError = selectedStaff ? staffAvailabilityError : globalAvailabilityError;
  
  const { data: exceptions, isLoading: loadingExceptions } = useAvailabilityExceptionsBySlug(slug);
  const { toast } = useToast();

  // ── Debug logs ──────────────────────────────────────────────────────────────
  useEffect(() => { console.log('[BookingPage] slug', slug); }, [slug]);
  useEffect(() => { console.log('[BookingPage] profile', profile, 'error', profileError); }, [profile, profileError]);
  useEffect(() => { console.log('[BookingPage] services', services, 'error', servicesError); }, [services, servicesError]);
  useEffect(() => { console.log('[BookingPage] availability', availability, 'error', availabilityError); }, [availability, availabilityError]);
  // ────────────────────────────────────────────────────────────────────────────

  // Monitor timeout: si tarda > 8s cargando, mostrar error
  useEffect(() => {
    const isLoading = loadingProfile || loadingServices || loadingAvailability;
    if (!isLoading) {
      setLoadingTimeout(false);
      return;
    }
    const timer = setTimeout(() => {
      console.warn('[BookingPage] Loading timeout: profile:', !profile, 'services:', !services, 'availability:', !availability);
      setLoadingTimeout(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [loadingProfile, loadingServices, loadingAvailability, profile, services, availability]);

  const service = services?.find((s: Service) => s.id === selectedService);
  const staffMember = staff?.find((s: StaffMember) => s.id === selectedStaff);
  const hasBookableServices = (services?.length ?? 0) > 0;
  const hasAvailabilityConfigured = (availability?.length ?? 0) > 0;

  const { data: monthCalendarBlocks } = useCalendarBlocksBySlugAndDateRange(
    slug,
    startOfMonth(currentMonth),
    endOfMonth(currentMonth)
  );

  const bookingRules = useMemo(() => ({
    allowWeekends: profile?.allow_weekends ?? true,
    slotMinutes: profile?.slot_minutes ?? 30,
    bufferMinutes: profile?.buffer_minutes ?? 0,
    minNoticeMinutes: profile?.min_notice_minutes ?? 0,
    maxDaysAhead: profile?.max_days_ahead ?? 60,
    minGapMinutes: profile?.min_gap_minutes ?? 0,
    serviceIntervalMinutes: service?.interval_minutes ?? null,
    staffId: selectedStaff,
    exceptions: exceptions ?? [],
    calendarBlocks: monthCalendarBlocks ?? [],
  }), [profile, service, selectedStaff, exceptions, monthCalendarBlocks]);
  const requirePhone = profile?.require_phone ?? true;
  const requireEmail = profile?.require_email ?? false;

  // Get appointments for selected date
  const { data: dayAppointments, isLoading: loadingDayAppointments, error: dayAppointmentsError } = useAppointmentsBySlugAndDate(
    slug,
    selectedDate ? format(selectedDate, 'yyyy-MM-dd') : undefined
  );

  // Get appointments for current month (for calendar validation)
  const { data: monthAppointments, isLoading: loadingMonthAppointments, error: monthAppointmentsError } = useAppointmentsBySlugAndDateRange(
    slug,
    startOfMonth(currentMonth),
    endOfMonth(currentMonth)
  );

  // Generate available time slots preserving all valid options and highlighting recommendations
  const availableTimeSlots = useMemo(() => {
    if (!availability || !dayAppointments || !selectedDate || !service) return [];

    const allSlots = generateTimeSlots(
      availability,
      dayAppointments,
      selectedDate,
      service.duration || 30,
      bookingRules
    );

    const optimizedSlots = getBestAvailableSlots(
      availability,
      dayAppointments,
      selectedDate,
      service.duration || 30,
      bookingRules
    );

    // Keep recommendations concise for better decision clarity.
    const recommendedSlots = optimizedSlots.slice(0, 3);
    const primaryCount = Math.min(recommendedSlots.length, recommendedSlots.length > 1 ? 2 : 1);
    const primaryRecommendedSlots = new Set(recommendedSlots.slice(0, primaryCount));

    const recommendationOrder = new Map(recommendedSlots.map((time, index) => [time, index]));

    return allSlots
      .map((slot) => ({
        ...slot,
        isRecommended: recommendationOrder.has(slot.time),
        isPrimaryRecommended: primaryRecommendedSlots.has(slot.time),
      }))
      .sort((a, b) => {
        const aRank = recommendationOrder.get(a.time);
        const bRank = recommendationOrder.get(b.time);

        if (aRank !== undefined && bRank !== undefined) {
          return aRank - bRank;
        }

        if (aRank !== undefined) return -1;
        if (bRank !== undefined) return 1;

        return a.time.localeCompare(b.time);
      });
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

  const getDayHoverLabel = (date: Date) => {
    const availableSlotsCount = getDaySlotCount(date);

    if (availableSlotsCount > 0) {
      return `${availableSlotsCount} huecos disponibles`;
    }

    if (!isSameMonth(date, currentMonth)) {
      return 'Fuera del mes actual';
    }

    return 'Sin huecos disponibles';
  };

  const selectedDateLabel = useMemo(() => {
    if (!selectedDate) return null;
    return `${formatBookingDateEs(selectedDate)} ${format(selectedDate, 'yyyy')}`;
  }, [selectedDate]);

  const previewTimeSlots = useMemo(() => availableTimeSlots.slice(0, 6), [availableTimeSlots]);
  const hasUrgency = !loadingDayAppointments && availableTimeSlots.length > 0 && availableTimeSlots.length <= 3;
  const selectedSlotMeta = useMemo(
    () => availableTimeSlots.find((slot) => slot.time === selectedTime) ?? null,
    [availableTimeSlots, selectedTime]
  );

  useEffect(() => {
    if (loadingDayAppointments) return;

    if (availableTimeSlots.length === 0) {
      if (selectedTime) {
        setSelectedTime(null);
      }
      setIsAutoSelectedTime(false);
      return;
    }

    const isCurrentSelectionValid = selectedTime
      ? availableTimeSlots.some((slot) => slot.time === selectedTime)
      : false;

    if (isCurrentSelectionValid) {
      return;
    }

    const topRecommendedSlot = availableTimeSlots.find(
      (slot) => slot.isPrimaryRecommended || slot.isRecommended
    );

    if (!topRecommendedSlot) return;

    setSelectedTime(topRecommendedSlot.time);
    setIsAutoSelectedTime(true);
  }, [availableTimeSlots, loadingDayAppointments, selectedTime]);

  const changeMonth = (direction: 'next' | 'prev') => {
    setMonthDirection(direction);
    setCurrentMonth((prev) => (direction === 'next' ? addMonths(prev, 1) : subMonths(prev, 1)));
  };

  useEffect(() => {
    if (!selectedDate || !timeSectionRef.current) return;

    const animationFrame = window.requestAnimationFrame(() => {
      timeSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [selectedDate]);

  useEffect(() => {
    if (!selectedService || !calendarSectionRef.current) return;

    const animationFrame = window.requestAnimationFrame(() => {
      calendarSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [selectedService]);

  if (!slug) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Enlace invalido</h2>
            <p className="text-sm text-muted-foreground">
              Falta el identificador del negocio en la URL.
            </p>
            <Button variant="outline" onClick={() => window.location.reload()}>Recargar</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── TIMEOUT VISIBLE: Si tarda >8s, mostrar error ────────────────────────────
  if (loadingTimeout) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center space-y-4">
            <div className="text-3xl">⏱️</div>
            <h2 className="text-xl font-semibold text-amber-600">Carga muy lenta</h2>
            <p className="text-sm text-muted-foreground">
              Lleva más de 8 segundos cargando. Puede ser un problema de conexión.
            </p>
            <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded text-xs text-muted-foreground text-left space-y-1">
              <p><strong>Estado:</strong></p>
              <p>• Perfil: {loadingProfile ? '⏳ Cargando' : profile ? '✅ Ok' : '❌ Error'}</p>
              <p>• Servicios: {loadingServices ? '⏳ Cargando' : services ? '✅ Ok' : '❌ Error'}</p>
              <p>• Disponibilidad: {loadingAvailability ? '⏳ Cargando' : availability ? '✅ Ok' : '❌ Error'}</p>
            </div>
            <div className="space-y-2">
              <Button className="w-full" onClick={() => window.location.reload()}>
                🔄 Recargar página
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setLoadingTimeout(false)}>
                Esperar más
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Etapa 1: Cargando perfil
  if (loadingProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const queryError = profileError || servicesError || availabilityError || dayAppointmentsError || monthAppointmentsError;
  if (queryError) {
    const errSource = profileError ? 'perfil' : servicesError ? 'servicios' : availabilityError ? 'disponibilidad' : 'citas';
    console.error('[BookingPage] query error in', errSource, queryError);
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center space-y-3">
            <h2 className="text-xl font-semibold text-foreground">Error al cargar reservas</h2>
            <p className="text-sm text-muted-foreground">{queryError.message || 'No se pudo cargar la página de reservas. Por favor revisa la URL o inténtalo de nuevo más tarde.'}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>Recargar</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Etapa 2: Perfil no encontrado
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center space-y-2">
            <h2 className="text-xl font-semibold text-foreground">Negocio no encontrado</h2>
            <p className="text-muted-foreground text-sm">
              El enlace de reserva no es valido o ya no esta disponible.
            </p>
          </CardContent>
        </Card>
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
            <h2 className="text-xl font-semibold text-foreground">
              {confirmationData?.flow === 'reschedule' ? '¡Cita reprogramada!' : '¡Reserva confirmada!'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {confirmationData?.flow === 'reschedule'
                ? 'Tu nuevo horario fue guardado correctamente.'
                : 'Recibiras una confirmacion en breve.'}
            </p>
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
          {isRescheduleFlow ? (
            <p className="mt-2 inline-flex items-center rounded-full bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-900 ring-1 ring-cyan-200">
              Modo reprogramacion activa
            </p>
          ) : null}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <section className="space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-foreground mb-2">Elige un servicio</h2>
            <p className="text-muted-foreground">Selecciona el servicio y termina la reserva en esta misma pantalla</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {services?.map(svc => (
              <Card
                key={svc.id}
                className={cn(
                  "cursor-pointer transition-all hover:shadow-md",
                  selectedService === svc.id ? 'ring-2 ring-primary shadow-md' : ''
                )}
                onClick={() => {
                  setSelectedService(svc.id);
                  setSelectedStaff(null);
                  setSelectedDate(null);
                  setSelectedTime(null);
                  setIsAutoSelectedTime(false);
                  setCurrentMonth(new Date());
                }}
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

          {!hasBookableServices ? (
            <Card className="max-w-md mx-auto border-dashed">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No hay servicios disponibles para reservar ahora mismo.
              </CardContent>
            </Card>
          ) : null}

          {selectedService ? (
            <Card className="border-border/70 bg-card/90 shadow-sm">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className="h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${service?.color || '#94a3b8'}20` }}
                  >
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: service?.color || '#94a3b8' }}
                    />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Servicio seleccionado</p>
                    <h3 className="mt-1 text-lg font-semibold text-foreground">{service?.name}</h3>
                    <p className="text-sm text-muted-foreground">{service?.duration} min · {Number(service?.price) > 0 ? `€${service?.price}` : 'Gratis'}</p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => {
                  setSelectedService(null);
                  setSelectedStaff(null);
                  setSelectedDate(null);
                  setSelectedTime(null);
                  setIsAutoSelectedTime(false);
                }}>
                  Cambiar servicio
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </section>

        {hasBookableServices && !hasAvailabilityConfigured ? (
          <Card className="max-w-md mx-auto border-dashed">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Todavia no hay disponibilidad configurada para mostrar fechas y horas.
            </CardContent>
          </Card>
        ) : null}

        {selectedService ? (
          <section ref={calendarSectionRef} className="space-y-8 animate-in fade-in-0 duration-300">
            {staff && staff.length > 0 ? (
              <div className="space-y-3">
                <div className="text-center">
                  <h2 className="text-2xl font-semibold text-foreground mb-2">Elige profesional</h2>
                  <p className="text-muted-foreground">Cambiar el profesional recalcula la disponibilidad al instante</p>
                </div>
                <StaffSelector
                  staff={staff}
                  selectedStaffId={selectedStaff}
                  onSelectStaff={(staffId) => {
                    setSelectedStaff(staffId);
                    setSelectedDate(null);
                    setSelectedTime(null);
                    setIsAutoSelectedTime(false);
                  }}
                  isLoading={false}
                  allowAnyStaff={true}
                />
              </div>
            ) : null}

            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-2xl font-semibold text-foreground mb-2">Selecciona una fecha</h2>
                <p className="text-muted-foreground">Elige el día y verás los horarios disponibles debajo</p>
              </div>

              <Card className="mx-auto w-full max-w-2xl overflow-hidden border-border/70 shadow-sm">
                <CardHeader className="border-b border-border/60 bg-gradient-to-b from-card to-secondary/20 pb-4">
                  <div className="flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => changeMonth('prev')}
                      className="rounded-full"
                      aria-label="Mes anterior"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <CardTitle className="text-lg capitalize">
                      {format(currentMonth, "MMMM yyyy", { locale: es })}
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => changeMonth('next')}
                      className="rounded-full"
                      aria-label="Mes siguiente"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-4 sm:p-5">
                  <div className="mb-3 grid grid-cols-7 gap-2">
                    {WEEKDAY_SHORT_ES.map(day => (
                      <div key={day} className="flex h-8 items-center justify-center text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground" translate="no">
                        {day}
                      </div>
                    ))}
                  </div>

                  <div
                    key={format(currentMonth, 'yyyy-MM')}
                    className={cn(
                      'grid grid-cols-7 gap-2',
                      'animate-in fade-in-0 duration-300',
                      monthDirection === 'next' ? 'slide-in-from-right-3' : 'slide-in-from-left-3'
                    )}
                  >
                    {loadingMonthAppointments ? (
                      <div className="col-span-7 grid grid-cols-7 gap-2 py-1">
                        {Array.from({ length: 14 }, (_, index) => (
                          <Skeleton key={index} className="h-14 rounded-2xl" />
                        ))}
                      </div>
                    ) : null}
                    {calendarDays.map(date => {
                      const isCurrentMonth = isSameMonth(date, currentMonth);
                      const isSelected = selectedDate && isSameDay(date, selectedDate);
                      const isToday = isSameDay(date, new Date());
                      const hasAvailability = isDayAvailableForBooking(date);
                      const availableSlotsCount = getDaySlotCount(date);

                      return (
                        <CalendarDayButton
                          key={date.toISOString()}
                          date={date}
                          isCurrentMonth={isCurrentMonth}
                          isSelected={isSelected}
                          isToday={isToday}
                          hasAvailability={hasAvailability}
                          availableSlotsCount={availableSlotsCount}
                          hoverLabel={getDayHoverLabel(date)}
                          onSelect={(nextDate) => {
                            setSelectedDate(nextDate);
                            setSelectedTime(null);
                            setIsAutoSelectedTime(false);
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                      Días con disponibilidad
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
                      Días completos
                    </span>
                    <span>El número indica los huecos disponibles</span>
                  </div>
                  {!loadingMonthAppointments && hasAvailabilityConfigured && service && monthDayAvailabilityMap.size > 0 && !calendarDays.some((date) => isDayAvailableForBooking(date)) ? (
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      No hay fechas disponibles para este servicio en el mes seleccionado.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <div ref={timeSectionRef} className="space-y-6 animate-in fade-in-0 slide-in-from-bottom-3 duration-300">
              <div className="text-center">
                <h2 className="text-2xl font-semibold text-foreground mb-2">Selecciona una hora</h2>
                <p className="text-muted-foreground">
                  {selectedDate ? formatBookingDateEs(selectedDate) : 'Primero elige un día en el calendario'}
                </p>
              </div>

              <Card className="mx-auto w-full max-w-3xl border-border/70 shadow-sm overflow-hidden">
                <CardContent className="p-5 sm:p-6">
                  <div className="mb-5 flex flex-col gap-3 rounded-2xl bg-secondary/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Horarios disponibles</p>
                      <p className="mt-1 text-sm text-foreground">Selecciona la hora que mejor te encaje.</p>
                    </div>
                    {selectedDate && !loadingDayAppointments && availableTimeSlots.length > 0 ? (
                      <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-900 ring-1 ring-emerald-200">
                        Quedan {availableTimeSlots.length} horarios
                      </div>
                    ) : null}
                  </div>

                  {!selectedDate ? (
                    <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/20 px-4 py-10 text-center">
                      <Calendar className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                      <p className="font-medium text-foreground">Selecciona una fecha para ver horarios</p>
                      <p className="mt-1 text-sm text-muted-foreground">Los huecos aparecerán aquí sin cambiar de pantalla.</p>
                    </div>
                  ) : null}

                  {selectedDate && hasUrgency ? (
                    <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 animate-in fade-in-0 slide-in-from-top-2 duration-300">
                      ¡Quedan pocas horas disponibles!
                    </div>
                  ) : null}

                  {selectedDate && loadingDayAppointments ? (
                    <div className="space-y-4 animate-in fade-in-0 duration-200">
                      <div className="flex items-center justify-center py-2 text-sm text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Cargando horarios...
                      </div>
                      <TimeSlotsSkeleton />
                    </div>
                  ) : null}

                  {selectedDate && !loadingDayAppointments && availableTimeSlots.length > 0 ? (
                    <div className="max-h-[420px] overflow-y-auto pr-1 scroll-smooth">
                      <p className="mb-3 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        Estas horas ayudan a optimizar la agenda del negocio
                      </p>
                      {selectedTime && isAutoSelectedTime ? (
                        <div className="mb-3 inline-flex items-center rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-900 dark:border-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-200">
                          Seleccionado automáticamente
                        </div>
                      ) : null}
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
                        {availableTimeSlots.map(slot => (
                          <TimeSlotButton
                            key={slot.time}
                            slot={slot}
                            isSelected={selectedTime === slot.time}
                            onSelect={(time) => {
                              setSelectedTime(time);
                              setIsAutoSelectedTime(false);
                              toast({
                                title: 'Horario seleccionado',
                                description: `${time} (${service?.duration || 30} min)`
                              });
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedDate && !loadingDayAppointments && availableTimeSlots.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/20 px-4 py-10 text-center animate-in fade-in-0 duration-200">
                      <Clock className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                      <p className="font-medium text-foreground">No hay disponibilidad este día</p>
                      <p className="mt-1 text-sm text-muted-foreground">Cambia de fecha para ver otros horarios libres.</p>
                    </div>
                  ) : null}

                  {selectedDate && !loadingDayAppointments && availableTimeSlots.length > 0 ? (
                    <p className="mt-4 text-center text-xs text-muted-foreground">
                      {availableTimeSlots.length} horarios disponibles
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            {selectedTime ? (
              <section className="space-y-6 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
                <div className="text-center">
                  <h2 className="text-2xl font-semibold text-foreground mb-2">Tus datos</h2>
                  <p className="text-muted-foreground">Completa la información para confirmar tu reserva</p>
                </div>

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

                <div className="flex justify-center">
                  <Button
                    size="lg"
                    disabled={
                      !formData.name ||
                      (requirePhone && !formData.phone) ||
                      (requireEmail && !formData.email) ||
                      submitting
                    }
                    onClick={async () => {
                      const selectedRecommended = Boolean(
                        selectedSlotMeta?.isPrimaryRecommended || selectedSlotMeta?.isRecommended
                      );

                      const bookingCreated = await handleBookingSubmit({
                        slug: slug || '',
                        profile,
                        service,
                        selectedDate,
                        selectedTime,
                        selectedStaff,
                        formData,
                        availability: availability || [],
                        appointments: dayAppointments || [],
                        calendarBlocks: monthCalendarBlocks || [],
                        rescheduleToken: rescheduleToken || null,
                        setSubmitting,
                        setConfirmationData,
                        setStep,
                        toast
                      });

                      if (bookingCreated) {
                        trackRecommendedSlotBooking(selectedRecommended);
                      }
                    }}
                    className="px-8"
                  >
                    <span className="inline-flex h-4 w-4 items-center justify-center mr-2">
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    </span>
                    <span>{isRescheduleFlow ? 'Confirmar reprogramacion' : 'Confirmar reserva'}</span>
                  </Button>
                </div>
              </section>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}