import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type StaffMember = Tables<'staff_members'>;

export function useStaff() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['staff', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_members')
        .select('*')
        .eq('user_id', user!.id)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data as StaffMember[];
    },
    enabled: !!user,
  });
}

export function useStaffByUserId(userId: string | undefined) {
  return useQuery({
    queryKey: ['staff', 'public', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_members')
        .select('*')
        .eq('user_id', userId!)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data as StaffMember[];
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useStaffServices(staffId: string | undefined) {
  return useQuery({
    queryKey: ['staff_services', staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_services')
        .select('service_id')
        .eq('staff_id', staffId!);
      if (error) throw error;
      return data.map(s => s.service_id);
    },
    enabled: !!staffId,
  });
}

export function useCreateStaff() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (staff: Omit<TablesInsert<'staff_members'>, 'user_id'>) => {
      const { data, error } = await supabase
        .from('staff_members')
        .insert({ ...staff, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export function useUpdateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: TablesUpdate<'staff_members'> & { id: string }) => {
      const { data, error } = await supabase
        .from('staff_members')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export function useDeleteStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('staff_members').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  });
}
