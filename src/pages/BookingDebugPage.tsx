import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function BookingDebugPage() {
  const [results, setResults] = useState<Record<string, any>>({
    status: 'Inicializando...',
  });

  useEffect(() => {
    async function diagnose() {
      const newResults: Record<string, any> = {};

      try {
        newResults.supabaseClientReady = '✅ Cliente Supabase inicializado';
      } catch (e: any) {
        newResults.supabaseClientReady = `❌ ${e.message}`;
        setResults(newResults);
        return;
      }

      // Test 1: Can anon read profiles?
      try {
        const { data, error, count } = await supabase
          .from('profiles')
          .select('id, slug, user_id', { count: 'exact' });

        if (error) {
          newResults.profilesAccess = `❌ Error: ${error.message}`;
        } else {
          newResults.profilesAccess = `✅ Anon puede leer profiles (${count} filas)`;
        }
      } catch (e: any) {
        newResults.profilesAccess = `❌ Exception: ${e.message}`;
      }

      // Test 2: Can anon read services?
      try {
        const { data, error, count } = await supabase
          .from('services')
          .select('id, user_id, active, bookable_online', { count: 'exact' });

        if (error) {
          newResults.servicesAccess = `❌ Error: ${error.message}`;
        } else {
          newResults.servicesAccess = `✅ Anon puede leer services (${count} filas)`;
        }
      } catch (e: any) {
        newResults.servicesAccess = `❌ Exception: ${e.message}`;
      }

      // Test 3: Can anon read availability?
      try {
        const { data, error, count } = await supabase
          .from('availability')
          .select('id, user_id, is_active', { count: 'exact' });

        if (error) {
          newResults.availabilityAccess = `❌ Error: ${error.message}`;
        } else {
          newResults.availabilityAccess = `✅ Anon puede leer availability (${count} filas)`;
        }
      } catch (e: any) {
        newResults.availabilityAccess = `❌ Exception: ${e.message}`;
      }

      // Test 4: Can anon read appointments?
      try {
        const { data, error, count } = await supabase
          .from('appointments')
          .select('id, status', { count: 'exact' });

        if (error) {
          newResults.appointmentsAccess = `❌ Error: ${error.message}`;
        } else {
          newResults.appointmentsAccess = `✅ Anon puede leer appointments (${count} filas)`;
        }
      } catch (e: any) {
        newResults.appointmentsAccess = `❌ Exception: ${e.message}`;
      }

      // Test 5: List all profiles with slugs
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, slug, business_name, booking_enabled')
          .not('slug', 'is', null);

        if (error) {
          newResults.allProfiles = `❌ Error: ${error.message}`;
        } else if (data && data.length > 0) {
          const profileList = data
            .map((p: any) => `${p.slug} (${p.business_name || 'sin nombre'}) - booking: ${p.booking_enabled !== false ? '✅' : '❌'}`)
            .join(' | ');
          newResults.allProfiles = `✅ ${data.length} profiles encontrados: ${profileList}`;
        } else {
          newResults.allProfiles = `⚠️ No hay profiles con slug definido`;
        }
      } catch (e: any) {
        newResults.allProfiles = `❌ Exception: ${e.message}`;
      }

      // Test 6: Try to fetch a specific profile by slug
      try {
        const testSlug = 'test';
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('slug', testSlug)
          .maybeSingle();

        if (error) {
          newResults.testSlugFetch = `❌ Error: ${error.message}`;
        } else if (data) {
          newResults.testSlugFetch = `✅ Profile encontrado: ${data.business_name}`;
        } else {
          newResults.testSlugFetch = `⚠️ Slug "${testSlug}" no existe (usa uno de los anteriores)`;
        }
      } catch (e: any) {
        newResults.testSlugFetch = `❌ Exception: ${e.message}`;
      }

      newResults.status = '✅ Diagnóstico completado';
      setResults(newResults);
    }

    diagnose();
  }, []);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>🔧 Diagnóstico de Booking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(results).map(([key, value]) => (
              <div key={key} className="p-3 bg-secondary rounded-lg text-sm">
                <strong>{key}:</strong>
                <div className="mt-1 font-mono text-xs break-words">{String(value)}</div>
              </div>
            ))}
            <Button onClick={() => window.location.reload()} className="w-full">
              Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
