import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Json } from '@/integrations/supabase/types';

export type DueReminder = Record<string, Json>;

export function useDueReminders(limit: number = 100) {
  return useQuery({
    queryKey: ['due-reminders', limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_due_reminders', { p_limit: limit });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as DueReminder[];
    },
  });
}

export function useMarkReminderSent() {
  return useMutation({
    mutationFn: async (params: { appointmentId: string; kind: '24h' | '2h' }) => {
      const { error } = await supabase.rpc('mark_reminder_sent', {
        p_appointment_id: params.appointmentId,
        p_kind: params.kind,
      });
      if (error) throw error;
    },
  });
}
