import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/integrations/supabase/types';

export type AvailabilityException = Tables<'availability_exceptions'>;

/**
 * Fetch exceptions for a business by slug
 * Used in public booking page
 */
export function useAvailabilityExceptionsBySlug(slug: string | undefined) {
  return useQuery({
    queryKey: ['availability-exceptions', 'slug', slug],
    queryFn: async () => {
      console.log('[useAvailabilityExceptionsBySlug] slug', slug);
      
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('slug', slug!)
        .maybeSingle();

      if (profileError) {
        console.error('[useAvailabilityExceptionsBySlug] Profile error', profileError);
        throw profileError;
      }
      if (!profile) {
        throw new Error('Perfil no encontrado');
      }

      const { data, error } = await supabase
        .from('availability_exceptions')
        .select('*')
        .eq('business_id', profile.id)
        .gte('exception_date', new Date().toISOString().split('T')[0])
        .order('exception_date', { ascending: true });

      if (error) {
        console.error('[useAvailabilityExceptionsBySlug] Exceptions error', error);
        throw error;
      }
      return data as AvailabilityException[];
    },
    enabled: !!slug,
    retry: 1,
  });
}

/**
 * Fetch exceptions for authenticated business owner
 */
export function useAvailabilityExceptionsByUserId(userId: string | undefined) {
  return useQuery({
    queryKey: ['availability-exceptions', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability_exceptions')
        .select('*')
        .eq('business_id', userId!)
        .order('exception_date', { ascending: false });

      if (error) throw error;
      return data as AvailabilityException[];
    },
    enabled: !!userId,
  });
}

/**
 * Create exception (block date or override hours)
 */
export function useCreateAvailabilityException(businessId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (exception: {
      exception_date: string;
      is_closed: boolean;
      start_time?: string | null;
      end_time?: string | null;
      reason?: string;
    }) => {
      const { data, error } = await supabase
        .from('availability_exceptions')
        .insert({
          business_id: businessId!,
          exception_date: exception.exception_date,
          is_closed: exception.is_closed,
          start_time: exception.start_time || null,
          end_time: exception.end_time || null,
          reason: exception.reason || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['availability-exceptions', businessId] });
    },
  });
}

/**
 * Update exception
 */
export function useUpdateAvailabilityException(businessId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (exception: AvailabilityException) => {
      const { data, error } = await supabase
        .from('availability_exceptions')
        .update({
          is_closed: exception.is_closed,
          start_time: exception.start_time,
          end_time: exception.end_time,
          reason: exception.reason,
        })
        .eq('id', exception.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['availability-exceptions', businessId] });
    },
  });
}

/**
 * Delete exception
 */
export function useDeleteAvailabilityException(businessId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (exceptionId: string) => {
      const { error } = await supabase
        .from('availability_exceptions')
        .delete()
        .eq('id', exceptionId);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['availability-exceptions', businessId] });
    },
  });
}
