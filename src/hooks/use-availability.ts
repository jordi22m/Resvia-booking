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

/**
 * Get all availability for a user (global + all staff)
 */
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

/**
 * Get availability for a specific staff member
 * Falls back to global availability (staff_id = null) if staff has no specific config
 */
export function useAvailabilityByStaff(userId: string | undefined, staffId: string | undefined) {
  return useQuery({
    queryKey: ['availability', userId, 'staff', staffId],
    queryFn: async () => {
      if (!userId || !staffId) return [];

      const { data, error } = await supabase
        .from('availability')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .or(`staff_id.is.null,staff_id.eq.${staffId}`)
        .order('day_of_week')
        .order('start_time');

      if (error) throw error;
      return (data as Availability[]) || [];
    },
    enabled: !!userId && !!staffId,
  });
}

/**
 * Get global availability (staff_id = null)
 */
export function useGlobalAvailability(userId: string | undefined) {
  return useQuery({
    queryKey: ['availability', userId, 'global'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability')
        .select('*')
        .eq('user_id', userId!)
        .is('staff_id', null)
        .eq('is_active', true)
        .order('day_of_week')
        .order('start_time');

      if (error) throw error;
      return data as Availability[];
    },
    enabled: !!userId,
  });
}

/**
 * Get public availability by slug (global only, for booking page)
 */
export function useAvailabilityBySlug(slug: string | undefined) {
  return useQuery({
    queryKey: ['availability', 'slug', slug],
    queryFn: async () => {
      console.log('[useAvailabilityBySlug] slug', slug);
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('slug', slug!)
        .maybeSingle();

      if (profileError) {
        console.error('[useAvailabilityBySlug] Profile error', profileError);
        throw profileError;
      }
      if (!profile) {
        throw new Error('Perfil no encontrado');
      }

      const { data, error } = await supabase
        .from('availability')
        .select('*')
        .eq('user_id', profile.user_id)
        .is('staff_id', null)
        .eq('is_active', true)
        .order('day_of_week')
        .order('start_time');

      if (error) {
        console.error('[useAvailabilityBySlug] Availability error', error);
        throw error;
      }
      return data as Availability[];
    },
    enabled: !!slug,
    retry: 1,
  });
}

/**
 * Get staff-specific availability by slug (for public booking with staff selection)
 */
export function useStaffAvailabilityBySlug(slug: string | undefined, staffId: string | undefined) {
  return useQuery({
    queryKey: ['availability', 'slug', slug, 'staff', staffId],
    queryFn: async () => {
      if (!slug || !staffId) return [];

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('slug', slug!)
        .maybeSingle();

      if (profileError) {
        console.error('[useStaffAvailabilityBySlug] Profile error', profileError);
        throw profileError;
      }
      if (!profile) {
        throw new Error('Perfil no encontrado');
      }

      const { data, error } = await supabase
        .from('availability')
        .select('*')
        .eq('user_id', profile.user_id)
        .eq('is_active', true)
        .or(`staff_id.is.null,staff_id.eq.${staffId}`)
        .order('day_of_week')
        .order('start_time');

      if (error) {
        console.error('[useStaffAvailabilityBySlug] Availability error', error);
        throw error;
      }
      return (data as Availability[]) || [];
    },
    enabled: !!slug && !!staffId,
    retry: 1,
  });
}