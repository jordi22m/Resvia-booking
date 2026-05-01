import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Clock, Lock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type AppointmentStatus =
  | 'confirmed'
  | 'pending'
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
        background: 'bg-slate-400/90 dark:bg-slate-700/90 bg-[repeating-linear-gradient(-45deg,rgba(71,85,105,0.55)_0px,rgba(71,85,105,0.55)_7px,rgba(148,163,184,0.24)_7px,rgba(148,163,184,0.24)_14px)]',
        border: 'border-slate-500 dark:border-slate-400',
        sidebar: 'bg-slate-700 dark:bg-slate-100',
        text: 'text-slate-950 dark:text-slate-50',
        badge: 'bg-slate-950/10 text-slate-800 dark:bg-white/10 dark:text-slate-50',
        badgeText: 'Bloqueado',
      };
    case 'closed':
      return {
        background: 'bg-slate-900/96 dark:bg-black/95 bg-[repeating-linear-gradient(-45deg,rgba(15,23,42,0.92)_0px,rgba(15,23,42,0.92)_8px,rgba(51,65,85,0.9)_8px,rgba(51,65,85,0.9)_16px)]',
        border: 'border-slate-700 dark:border-slate-500',
        sidebar: 'bg-white dark:bg-slate-200',
        text: 'text-slate-100 dark:text-slate-100',
        badge: 'bg-white/10 text-slate-100 dark:bg-white/10 dark:text-slate-100',
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
  accentColor?: string;
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
  accentColor,
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
    if (availableHeight < 42) return 'compact';
    if (availableHeight < 76) return 'medium';
    return 'full';
  }, [availableHeight]);

  const showCompact = density === 'compact';
  const showFull = density === 'full';
  const styles = useMemo(() => getAppointmentStyles(status), [status]);
  const sidebarStyle = accentColor ? { backgroundColor: accentColor } : undefined;
  const isBlockedState = status === 'blocked' || status === 'closed';
  const blockTitle = status === 'closed' ? 'Cerrado' : 'Bloqueado';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          ref={cardRef}
          draggable
          onDragStart={onDragStart}
          onClick={onClick}
          className={cn(
            'absolute rounded-2xl border cursor-pointer overflow-hidden select-none',
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
            height: `${Math.max(height, 34)}px`,
          }}
        >
          <div
            className={cn('absolute left-0 top-0 h-full w-[4px] rounded-l-2xl', !accentColor && styles.sidebar)}
            style={sidebarStyle}
          />

          <div className="relative z-[1] h-full min-h-0 overflow-hidden flex flex-col justify-between gap-0.5 px-2 py-1.5 pl-3">
            {isBlockedState ? (
              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <p className={cn(
                  'min-w-0 font-semibold text-[12px] leading-tight whitespace-nowrap overflow-hidden text-ellipsis',
                  showCompact ? 'pr-0' : 'pr-0.5'
                )}>
                  {blockTitle}
                </p>
              </div>
            ) : (
              <p className={cn(
                'min-w-0 font-semibold text-[12px] leading-tight whitespace-nowrap overflow-hidden text-ellipsis',
                showCompact ? 'pr-0' : 'pr-0.5'
              )}>
                {customerName}
              </p>
            )}

            {showFull ? (
              <p className="min-w-0 text-[11px] leading-tight whitespace-nowrap overflow-hidden text-ellipsis opacity-80">
                {isBlockedState ? serviceName || blockTitle : serviceName}
              </p>
            ) : null}

            <div className="flex min-w-0 items-center gap-1 overflow-hidden opacity-60">
              <Clock className="h-3 w-3 shrink-0" />
              <p className={cn(
                'min-w-0 text-[10px] leading-tight overflow-hidden whitespace-nowrap text-ellipsis'
              )}>
                {apt.start_time} - {apt.end_time}
              </p>
            </div>

            {showFull && !isBlockedState ? (
              <div className="flex items-center justify-between gap-1 overflow-hidden">
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium truncate', styles.badge)}>
                  {styles.badgeText}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-xl backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95">
        <div className="grid gap-2 text-sm text-slate-900 dark:text-slate-100">
          <div className="flex items-start justify-between gap-2 border-b border-slate-200/70 pb-2 dark:border-slate-800/80">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Cliente</p>
              <p className="truncate font-semibold">{customerName}</p>
            </div>
            <span className={cn('shrink-0 text-[10px] px-2 py-1 rounded-full font-medium', styles.badge)}>
              {styles.badgeText}
            </span>
          </div>

          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Servicio</p>
            <p className="line-clamp-2">{serviceName}</p>
          </div>

          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Hora</p>
              <p>{apt.start_time} - {apt.end_time}</p>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Estado</p>
            <p>{styles.badgeText}</p>
          </div>

          {staffName ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Profesional</p>
              <p>{staffName}</p>
            </div>
          ) : null}

          {apt.notes ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Notas</p>
              <p className="line-clamp-3">{apt.notes}</p>
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
