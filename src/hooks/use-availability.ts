import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/integrations/supabase/types';

export type Availability = Tables<'availability'> & {
  morning_active?: boolean | null;
  morning_start_time?: string | null;
  morning_end_time?: string | null;
  afternoon_active?: boolean | null;
  afternoon_start_time?: string | null;
  afternoon_end_time?: string | null;
};

export function useAvailabilityByUserId(userId: string | undefined) {
  return useQuery({
    queryKey: ['availability', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability')
        .select('*')
        .eq('user_id', userId!)
        .eq('is_active', true)
        .order('day_of_week')
        .order('start_time');

      if (error) throw error;
      return data as Availability[];
    },
    enabled: !!userId,
  });
}

export function useAvailabilityBySlug(slug: string | undefined) {
  return useQuery({
    queryKey: ['availability', 'slug', slug],
    queryFn: async () => {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('slug', slug!)
        .single();

      if (profileError) throw profileError;

      const { data, error } = await supabase
        .from('availability')
        .select('*')
        .eq('user_id', profile.user_id)
        .eq('is_active', true)
        .order('day_of_week')
        .order('start_time');

      if (error) throw error;
      return data as Availability[];
    },
    enabled: !!slug,
  });
}