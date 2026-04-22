import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

type RawService = Tables<'services'> & {
  duration?: number | null;
  duration_minutes?: number | null;
  interval_minutes?: number | null;
};

type RawServiceInsert = TablesInsert<'services'> & {
  duration?: number | null;
  duration_minutes?: number | null;
  interval_minutes?: number | null;
};

type RawServiceUpdate = TablesUpdate<'services'> & {
  duration?: number | null;
  duration_minutes?: number | null;
  interval_minutes?: number | null;
};

export type Service = Omit<RawService, 'duration'> & {
  duration: number;
};

function normalizeService(service: RawService): Service {
  return {
    ...service,
    duration: service.duration ?? service.duration_minutes ?? 30,
  };
}

function toServicePayload(service: RawServiceInsert | RawServiceUpdate) {
  const { duration, duration_minutes, ...rest } = service;
  return {
    ...rest,
    duration: duration ?? duration_minutes ?? 30,
  };
}

export function useServices() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['services', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('user_id', user!.id)
        .order('category')
        .order('name');
      if (error) throw error;
      return (data as RawService[]).map(normalizeService);
    },
    enabled: !!user,
  });
}

export function useServicesByUserId(userId: string | undefined) {
  return useQuery({
    queryKey: ['services', 'public', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('user_id', userId!)
        .eq('active', true)
        .eq('bookable_online', true)
        .order('category')
        .order('name');
      if (error) throw error;
      return (data as RawService[]).map(normalizeService);
    },
    enabled: !!userId,
    retry: 1,
  });
}

export function useCreateService() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (service: Omit<RawServiceInsert, 'user_id'>) => {
      const { data, error } = await supabase
        .from('services')
        .insert({ ...toServicePayload(service), user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      return normalizeService(data as RawService);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: RawServiceUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from('services')
        .update(toServicePayload(updates))
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return normalizeService(data as RawService);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useDeleteService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('services').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}
