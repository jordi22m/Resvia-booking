import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Clock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type AppointmentStatusStyle = {
  surface: string;
  sideBorder: string;
  text: string;
  hoverBorder: string;
  badge: string;
  badgeText: string;
};

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
  statusStyle: AppointmentStatusStyle;
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
  statusStyle,
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

  const showOnlyName = density === 'compact';
  const showNameAndTime = density === 'medium';
  const showFull = density === 'full';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          ref={cardRef}
          draggable
          onDragStart={onDragStart}
          onClick={onClick}
          className={cn(
            'absolute rounded-xl border-l-4 p-2 cursor-pointer overflow-hidden',
            'flex flex-col justify-between gap-[2px]',
            'shadow-sm hover:shadow-md transition-all duration-150',
            'hover:-translate-y-[1px] active:translate-y-0 active:shadow-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25',
            statusStyle.surface,
            statusStyle.sideBorder,
            statusStyle.text,
            statusStyle.hoverBorder,
          )}
          style={{
            top: `${top}px`,
            left,
            width,
            height: `${Math.max(height, 28)}px`,
          }}
        >
          <div className="min-h-0 overflow-hidden">
            <p className="text-sm font-semibold leading-tight line-clamp-2">
              {customerName}
            </p>

            {showFull ? (
              <p className="mt-[2px] text-xs text-muted-foreground leading-tight truncate">
                {serviceName}
              </p>
            ) : null}

            {showNameAndTime || showFull ? (
              <p className="mt-[2px] text-[11px] opacity-70 leading-tight truncate">
                {apt.start_time} - {apt.end_time}
              </p>
            ) : null}
          </div>

          {showFull ? (
            <div className="flex items-center justify-between gap-1 overflow-hidden">
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium truncate', statusStyle.badge)}>
                {statusStyle.badgeText}
              </span>
            </div>
          ) : null}
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
