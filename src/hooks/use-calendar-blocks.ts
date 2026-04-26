import { addDays, format } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type CalendarBlockType = 'booking' | 'blocked' | 'closed';

export interface CalendarBlock {
  id: string;
  business_id: string;
  start_time: string;
  end_time: string;
  type: CalendarBlockType;
  reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

function dayRangeToDateTimes(startDate: Date, endDate: Date) {
  return {
    start: `${format(startDate, 'yyyy-MM-dd')} 00:00:00`,
    endExclusive: `${format(addDays(endDate, 1), 'yyyy-MM-dd')} 00:00:00`,
  };
}

export function useCalendarBlocksByUserId(
  userId: string | undefined,
  startDate: Date,
  endDate: Date,
) {
  return useQuery({
    queryKey: ['calendar-blocks', 'owner', userId, format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd')],
    queryFn: async () => {
      const range = dayRangeToDateTimes(startDate, endDate);

      const { data, error } = await supabase
        .from('calendar_blocks' as any)
        .select('*')
        .eq('business_id', userId!)
        .lt('start_time', range.endExclusive)
        .gt('end_time', range.start)
        .order('start_time', { ascending: true });

      if (error) throw error;
      return (data || []) as CalendarBlock[];
    },
    enabled: !!userId,
  });
}

export function useCalendarBlocksBySlugAndDateRange(
  slug: string | undefined,
  startDate: Date | undefined,
  endDate: Date | undefined,
) {
  return useQuery({
    queryKey: [
      'calendar-blocks',
      'public',
      slug,
      startDate ? format(startDate, 'yyyy-MM-dd') : null,
      endDate ? format(endDate, 'yyyy-MM-dd') : null,
    ],
    queryFn: async () => {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('slug', slug!)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile) throw new Error('Perfil no encontrado');

      const range = dayRangeToDateTimes(startDate!, endDate!);

      const { data, error } = await supabase
        .from('calendar_blocks' as any)
        .select('*')
        .eq('business_id', profile.user_id)
        .in('type', ['blocked', 'closed'])
        .lt('start_time', range.endExclusive)
        .gt('end_time', range.start)
        .order('start_time', { ascending: true });

      if (error) throw error;
      return (data || []) as CalendarBlock[];
    },
    enabled: !!slug && !!startDate && !!endDate,
  });
}

export function useCreateCalendarBlock(userId: string | undefined, startDate: Date, endDate: Date) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      start_time: string;
      end_time: string;
      type: CalendarBlockType;
      reason?: string | null;
    }) => {
      const { data, error } = await supabase
        .from('calendar_blocks' as any)
        .insert({
          business_id: userId,
          start_time: input.start_time,
          end_time: input.end_time,
          type: input.type,
          reason: input.reason || null,
        })
        .select('*')
        .single();

      if (error) throw error;
      return data as CalendarBlock;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-blocks', 'owner'] });
      qc.invalidateQueries({ queryKey: ['calendar-blocks', 'public'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['appointments', 'by-slug-date'] });
      qc.invalidateQueries({ queryKey: ['appointments', 'by-slug-date-range'] });
    },
  });
}

export function useUpdateCalendarBlock(userId: string | undefined, startDate: Date, endDate: Date) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      start_time: string;
      end_time: string;
      type: CalendarBlockType;
      reason?: string | null;
    }) => {
      const { data, error } = await supabase
        .from('calendar_blocks' as any)
        .update({
          business_id: userId,
          start_time: input.start_time,
          end_time: input.end_time,
          type: input.type,
          reason: input.reason || null,
        })
        .eq('id', input.id)
        .select('*')
        .single();

      if (error) throw error;
      return data as CalendarBlock;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-blocks', 'owner'] });
      qc.invalidateQueries({ queryKey: ['calendar-blocks', 'public'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['appointments', 'by-slug-date'] });
      qc.invalidateQueries({ queryKey: ['appointments', 'by-slug-date-range'] });
    },
  });
}

export function useDeleteCalendarBlock(userId: string | undefined, startDate: Date, endDate: Date) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('calendar_blocks' as any)
        .delete()
        .eq('id', id)
        .eq('business_id', userId);

      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar-blocks', 'owner'] });
      qc.invalidateQueries({ queryKey: ['calendar-blocks', 'public'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['appointments', 'by-slug-date'] });
      qc.invalidateQueries({ queryKey: ['appointments', 'by-slug-date-range'] });
    },
  });
}
