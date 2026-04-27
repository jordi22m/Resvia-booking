import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type Profile = Tables<'profiles'>;

// Function to generate a slug from business name
export function generateSlug(businessName: string): string {
  return businessName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

// Function to validate slug format
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug) && slug.length >= 2 && slug.length <= 50;
}

export function useProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
    enabled: !!user,
  });
}

export function useProfileBySlug(slug: string | undefined) {
  return useQuery({
    queryKey: ['profile', 'slug', slug],
    queryFn: async () => {
      console.log('[useProfileBySlug] slug', slug);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('slug', slug!)
        .maybeSingle();

      if (error) {
        console.error('[useProfileBySlug] Profile error', error);
        throw error;
      }

      if (!data) {
        throw new Error('Perfil no encontrado');
      }

      return data as Profile;
    },
    enabled: !!slug,
    retry: 1,
  });
}

export function useUpdateProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (updates: TablesUpdate<'profiles'>) => {
      if (!user?.id) throw new Error('Usuario no identificado');

      // Solo enviar los campos que se actualizan, junto con el user_id
      const payload: Record<string, any> = {
        user_id: user.id,
        ...updates,
      };

      // Eliminar undefined values
      Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select('*')
        .single();
      
      if (error) {
        console.error('Profile update error:', error);
        // Supabase error objects are not instanceof Error; expose message explicitly
        const msg = (error as { message?: string }).message || JSON.stringify(error);
        throw new Error(msg);
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
