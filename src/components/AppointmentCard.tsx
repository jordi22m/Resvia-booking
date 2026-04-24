import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Clock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type AppointmentStatus =
  | 'confirmed'
  | 'pending'
  | 'cancelled'
  | 'canceled'
  | 'completed'
  | 'blocked'
  | 'closed'
  | string;

type AppointmentStyles = {
  background: string;
  border: string;
  sidebar: string;
  text: string;
  badge: string;
  badgeText: string;
};

export function getAppointmentStyles(status?: AppointmentStatus): AppointmentStyles {
  switch (status) {
    case 'confirmed':
      return {
        background: 'bg-emerald-200/80 dark:bg-emerald-900/55',
        border: 'border-emerald-300 dark:border-emerald-700',
        sidebar: 'bg-emerald-500',
        text: 'text-emerald-950 dark:text-emerald-100',
        badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
        badgeText: 'Confirmada',
      };
    case 'cancelled':
    case 'canceled':
      return {
        background: 'bg-slate-200/85 dark:bg-slate-800/65',
        border: 'border-slate-300 dark:border-slate-600',
        sidebar: 'bg-slate-400 dark:bg-slate-500',
        text: 'text-slate-800 dark:text-slate-100',
        badge: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
        badgeText: 'Cancelada',
      };
    case 'completed':
      return {
        background: 'bg-sky-200/80 dark:bg-sky-900/55',
        border: 'border-sky-300 dark:border-sky-700',
        sidebar: 'bg-sky-500',
        text: 'text-sky-950 dark:text-sky-100',
        badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
        badgeText: 'Completada',
      };
    case 'blocked':
      return {
        background: 'bg-slate-300/75 dark:bg-slate-700/70 bg-[repeating-linear-gradient(-45deg,rgba(100,116,139,0.42)_0px,rgba(100,116,139,0.42)_6px,rgba(148,163,184,0.18)_6px,rgba(148,163,184,0.18)_12px)]',
        border: 'border-slate-400 dark:border-slate-500',
        sidebar: 'bg-slate-500 dark:bg-slate-300',
        text: 'text-slate-900 dark:text-slate-100',
        badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100',
        badgeText: 'Bloqueado',
      };
    case 'closed':
      return {
        background: 'bg-slate-800/90 dark:bg-slate-950/92',
        border: 'border-slate-700 dark:border-slate-500',
        sidebar: 'bg-slate-900 dark:bg-slate-200',
        text: 'text-slate-100 dark:text-slate-100',
        badge: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
        badgeText: 'Cerrado',
      };
    case 'pending':
    default:
      return {
        background: 'bg-amber-200/80 dark:bg-amber-900/55',
        border: 'border-amber-300 dark:border-amber-700',
        sidebar: 'bg-amber-500',
        text: 'text-amber-950 dark:text-amber-100',
        badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
        badgeText: 'Pendiente',
      };
  }
}

type AppointmentCardData = {
  id: string;
  start_time: string;
  end_time: string;
  notes?: string | null;
};

interface AppointmentCardProps {
  apt: AppointmentCardData;
  top: number;
  left: string;
  width: string;
  height: number;
  status?: AppointmentStatus;
  customerName: string;
  serviceName: string;
  staffName?: string;
  onClick: () => void;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
}

export function AppointmentCard({
  apt,
  top,
  left,
  width,
  height,
  status,
  customerName,
  serviceName,
  staffName,
  onClick,
  onDragStart,
}: AppointmentCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [availableHeight, setAvailableHeight] = useState(Math.max(height, 32));

  useEffect(() => {
    setAvailableHeight(Math.max(height, 32));
  }, [height]);

  useEffect(() => {
    if (!cardRef.current || typeof ResizeObserver === 'undefined') return;

    const target = cardRef.current;
    const observer = new ResizeObserver((entries) => {
      const nextHeight = entries[0]?.contentRect?.height;
      if (!nextHeight) return;
      setAvailableHeight(Math.max(nextHeight, 32));
    });

    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const density = useMemo(() => {
    if (availableHeight < 40) return 'compact';
    if (availableHeight < 70) return 'medium';
    return 'full';
  }, [availableHeight]);

  const showNameAndTime = density === 'medium';
  const showFull = density === 'full';
  const styles = useMemo(() => getAppointmentStyles(status), [status]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          ref={cardRef}
          draggable
          onDragStart={onDragStart}
          onClick={onClick}
          className={cn(
            'absolute rounded-xl border cursor-pointer overflow-hidden select-none',
            'shadow-sm hover:shadow-md transition-all duration-150',
            'hover:-translate-y-[1px] hover:saturate-110 active:translate-y-0 active:shadow-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25',
            styles.background,
            styles.border,
            styles.text,
          )}
          style={{
            top: `${top}px`,
            left,
            width,
            height: `${Math.max(height, 28)}px`,
          }}
        >
          <div className={cn('absolute left-0 top-0 h-full w-[3px] rounded-l-xl', styles.sidebar)} />

          <div className="relative z-[1] h-full min-h-0 overflow-hidden flex flex-col justify-between gap-[2px] p-2 pl-3">
            <p className="text-sm font-semibold leading-tight line-clamp-2">
              {customerName}
            </p>

            {showFull ? (
              <p className="text-xs text-muted-foreground leading-tight truncate">
                {serviceName}
              </p>
            ) : null}

            {showNameAndTime || showFull ? (
              <p className="text-[11px] opacity-70 leading-tight truncate">
                {apt.start_time} - {apt.end_time}
              </p>
            ) : null}

            {showFull ? (
              <div className="flex items-center justify-between gap-1 overflow-hidden">
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium truncate', styles.badge)}>
                  {styles.badgeText}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <div className="grid gap-1.5 text-sm">
          <div>
            <span className="font-medium">Cliente:</span> {customerName}
          </div>
          <div>
            <span className="font-medium">Servicio:</span> {serviceName}
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            <span>{apt.start_time} - {apt.end_time}</span>
          </div>
          {staffName ? (
            <div>
              <span className="font-medium">Profesional:</span> {staffName}
            </div>
          ) : null}
          {apt.notes ? (
            <div>
              <span className="font-medium">Notas:</span> {apt.notes}
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
