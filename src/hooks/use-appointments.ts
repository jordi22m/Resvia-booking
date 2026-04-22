import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { useEffect, useRef } from 'react';
import { buildWebhookPayload, triggerWebhook } from '@/lib/webhook';
import { format } from 'date-fns';

export type Appointment = Tables<'appointments'>;

function getAppointmentEndDate(appointment: Appointment): Date | null {
  try {
    const [h, m] = appointment.end_time.split(':').map(Number);
    const date = new Date(appointment.date);
    date.setHours(h, m, 0, 0);
    return date;
  } catch {
    return null;
  }
}

export function useAppointmentsByDate(userId: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: ['appointments', 'by-date', userId, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('user_id', userId!)
        .eq('date', date!)
        .in('status', ['pending', 'confirmed']);

      if (error) throw error;
      return data as Appointment[];
    },
    enabled: !!userId && !!date,
  });
}

export function useAppointmentsBySlugAndDate(slug: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: ['appointments', 'by-slug-date', slug, date],
    queryFn: async () => {
      // First get the user_id from the profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('slug', slug!)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile) return [];

      // Then get appointments for that user and date
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('user_id', profile.user_id)
        .eq('date', date!)
        .in('status', ['pending', 'confirmed']);

      if (error) throw error;
      return data as Appointment[];
    },
    enabled: !!slug && !!date,
    retry: 1,
  });
}

export function useAppointments() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const processedAutoConfirmIds = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['appointments', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('user_id', user!.id)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) throw error;
      return data as Appointment[];
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (!query.data || !query.data.length) return;

    const now = new Date();
    const pendingPastAppointments = query.data.filter(appointment => {
      if (appointment.status !== 'pending') return false;
      const endDate = getAppointmentEndDate(appointment);
      return endDate ? endDate.getTime() <= now.getTime() : false;
    });

    const idsToConfirm = pendingPastAppointments
      .map(appointment => appointment.id)
      .filter(id => !processedAutoConfirmIds.current.has(id));

    if (!idsToConfirm.length) return;

    idsToConfirm.forEach(id => processedAutoConfirmIds.current.add(id));

    const confirmAppointments = async () => {
      const { error } = await supabase
        .from('appointments')
        .update({ status: 'confirmed' })
        .in('id', idsToConfirm);

      if (!error) {
        qc.invalidateQueries({ queryKey: ['appointments'] });
      }
    };

    void confirmAppointments();
  }, [query.data, qc]);

  return query;
}

export function useAppointmentsBySlugAndDateRange(slug: string | undefined, startDate: Date | undefined, endDate: Date | undefined) {
  return useQuery({
    queryKey: ['appointments', 'by-slug-date-range', slug, startDate?.toISOString(), endDate?.toISOString()],
    queryFn: async () => {
      // First get the user_id from the profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('slug', slug!)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile) return [];

      // Then get appointments for that user and date range
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('user_id', profile.user_id)
        .gte('date', format(startDate!, 'yyyy-MM-dd'))
        .lte('date', format(endDate!, 'yyyy-MM-dd'))
        .in('status', ['pending', 'confirmed']);

      if (error) throw error;
      return data as Appointment[];
    },
    enabled: !!slug && !!startDate && !!endDate,
    retry: 1,
  });
}

export function useCreateAppointment() {
  const { user, session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (apt: Omit<TablesInsert<'appointments'>, 'user_id'>) => {
      const { data, error } = await supabase
        .from('appointments')
        .insert({ ...apt, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;

      // Disparo push (no bloqueante)
      supabase.functions.invoke('send-push', {
        body: {
          user_id: user!.id,
          title: 'Nueva cita',
          message: `Cita el ${apt.date} a las ${apt.start_time}`,
          url: '/calendar',
        },
      }).catch(() => {});

      // Disparo webhook (no bloqueante)
      if (session) {
        const createdAppointment = data as Appointment & { public_id?: string | null };
        triggerWebhook(
          'booking.created',
          buildWebhookPayload({
            event: 'booking.created',
            business: { id: user!.id, name: 'Business', slug: null },
            appointment: {
              id: data.id,
              public_id: createdAppointment.public_id ?? null,
              status: apt.status || 'pending',
              date: apt.date,
              start_time: apt.start_time,
              end_time: apt.end_time,
            },
            customer: { id: apt.customer_id ?? null },
            service: { id: apt.service_id ?? null },
          }),
          user!.id,
          session
        );
      }

      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
}

export function useUpdateAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: TablesUpdate<'appointments'> & { id: string }) => {
      const { data, error } = await supabase
        .from('appointments')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
}

export function useDeleteAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('appointments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
}

export function useAppointmentsRealtime() {
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('appointments-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'appointments',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ['appointments'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);
}
