import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Tables, TablesInsert } from '@/integrations/supabase/types';

export type WebhookConfig = Tables<'webhook_configs'>;

export function useWebhookConfig() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['webhook-config', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('webhook_configs')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();

      if (error) throw error;
      return data as WebhookConfig | null;
    },
    enabled: !!user,
  });
}

export function useSaveWebhookConfig() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Pick<WebhookConfig, 'webhook_url' | 'selected_events' | 'active'>) => {
      const { data: existingConfig, error: fetchError } = await supabase
        .from('webhook_configs')
        .select('id, secret')
        .eq('user_id', user!.id)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (existingConfig) {
        const { data, error } = await supabase
          .from('webhook_configs')
          .update({
            webhook_url: payload.webhook_url,
            selected_events: payload.selected_events,
            active: payload.active,
          })
          .eq('id', existingConfig.id)
          .select('*')
          .single();

        if (error) throw error;
        return data as WebhookConfig;
      }

      const { data: generatedSecret, error: secretError } = await supabase.rpc('generate_webhook_secret');
      if (secretError) throw secretError;

      const insertPayload: TablesInsert<'webhook_configs'> = {
        user_id: user!.id,
        webhook_url: payload.webhook_url,
        selected_events: payload.selected_events,
        active: payload.active,
        secret: generatedSecret,
      };

      const { data, error } = await supabase
        .from('webhook_configs')
        .insert(insertPayload)
        .select('*')
        .single();

      if (error) throw error;
      return data as WebhookConfig;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhook-config'] });
    },
  });
}
