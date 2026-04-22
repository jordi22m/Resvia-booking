import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Safe storage factory.
 * WhatsApp, Instagram y otros in-app browsers en iOS/Android bloquean o lanzan
 * excepción al acceder a localStorage. Cuando ocurre, usamos un store en memoria
 * para que el cliente Supabase pueda inicializarse y las queries públicas (anon)
 * funcionen. Las sesiones autenticadas no persistirán entre recargas en esos
 * browsers, pero es aceptable: la página de booking no requiere auth.
 */
function buildSafeStorage(): Storage {
  try {
    localStorage.setItem('__sb_test__', '1');
    localStorage.removeItem('__sb_test__');
    return localStorage;
  } catch {
    const store: Record<string, string> = {};
    return {
      getItem:    (k: string) => store[k] ?? null,
      setItem:    (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear:      () => { Object.keys(store).forEach((k) => delete store[k]); },
      key:        (i: number) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length; },
    } as Storage;
  }
}

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: buildSafeStorage(),
    persistSession: true,
    autoRefreshToken: true,
  },
});
