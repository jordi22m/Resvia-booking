import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type Service = Tables<'services'>;

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
      return data as Service[];
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
      return data as Service[];
    },
    enabled: !!userId,
  });
}

export function useCreateService() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (service: Omit<TablesInsert<'services'>, 'user_id'>) => {
      const { data, error } = await supabase
        .from('services')
        .insert({ ...service, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: TablesUpdate<'services'> & { id: string }) => {
      const { data, error } = await supabase
        .from('services')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
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
