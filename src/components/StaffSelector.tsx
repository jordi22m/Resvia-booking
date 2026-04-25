import { useMemo } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StaffMember } from '@/hooks/use-staff';

interface StaffSelectorProps {
  staff: StaffMember[] | undefined;
  selectedStaffId: string | null;
  onSelectStaff: (staffId: string | null) => void;
  isLoading?: boolean;
  allowAnyStaff?: boolean;
}

export function StaffSelector({
  staff,
  selectedStaffId,
  onSelectStaff,
  isLoading = false,
  allowAnyStaff = true,
}: StaffSelectorProps) {
  const staffList = useMemo(() => {
    if (!staff || staff.length === 0) return [];
    return staff.filter(s => s.active);
  }, [staff]);

  // If only one staff, auto-select
  if (staffList.length === 1 && !selectedStaffId) {
    onSelectStaff(staffList[0].id);
  }

  // Don't show selector if no staff or only one
  if (staffList.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-4">Elige un profesional</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Selecciona con quién deseas reservar tu cita
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* "Any staff" option */}
        {allowAnyStaff && (
          <button
            onClick={() => onSelectStaff(null)}
            disabled={isLoading}
            className={cn(
              'group relative flex items-center justify-center gap-3 rounded-2xl border-2 px-4 py-6 text-center transition-all duration-200 ease-out',
              'hover:border-primary/50 hover:bg-primary/5',
              selectedStaffId === null
                ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
                : 'border-border bg-card'
            )}
          >
            <div className="space-y-1">
              <p className="font-semibold">Cualquiera disponible</p>
              <p className="text-xs text-muted-foreground">
                Asignación automática
              </p>
            </div>
            {selectedStaffId === null && (
              <Check className="h-5 w-5 text-primary shrink-0" />
            )}
          </button>
        )}

        {/* Individual staff members */}
        {staffList.map((member) => (
          <button
            key={member.id}
            onClick={() => onSelectStaff(member.id)}
            disabled={isLoading}
            className={cn(
              'group relative flex flex-col items-center gap-3 rounded-2xl border-2 p-4 text-center transition-all duration-200 ease-out',
              'hover:border-primary/50 hover:bg-primary/5',
              selectedStaffId === member.id
                ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
                : 'border-border bg-card'
            )}
          >
            {/* Avatar */}
            {member.avatar_url ? (
              <img
                src={member.avatar_url}
                alt={member.name}
                className="h-16 w-16 rounded-full object-cover ring-2 ring-background"
              />
            ) : (
              <div
                className={cn(
                  'h-16 w-16 rounded-full flex items-center justify-center text-xl font-bold text-white',
                  member.color || 'bg-blue-500'
                )}
                style={{ backgroundColor: member.color || '#3b82f6' }}
              >
                {member.name.charAt(0).toUpperCase()}
              </div>
            )}

            {/* Name and role */}
            <div className="flex-1">
              <p className="font-semibold text-sm line-clamp-2">{member.name}</p>
              {member.role && (
                <p className="text-xs text-muted-foreground mt-1">{member.role}</p>
              )}
            </div>

            {/* Selected indicator */}
            {selectedStaffId === member.id && (
              <div className="absolute top-2 right-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-4 w-4" />
                </div>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
