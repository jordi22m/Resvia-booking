import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarDays, XCircle, AlertTriangle, TrendingUp, Users, BarChart3, Loader2 } from 'lucide-react';
import { useAppointments } from '@/hooks/use-appointments';
import { useServices } from '@/hooks/use-services';
import { useStaff } from '@/hooks/use-staff';

export default function ReportsPage() {
  const { data: appointments, isLoading } = useAppointments();
  const { data: services } = useServices();
  const { data: staff } = useStaff();

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  const allApts = appointments || [];
  const total = allApts.length;
  const confirmed = allApts.filter(a => a.status === 'confirmed').length;
  const pending = allApts.filter(a => a.status === 'pending').length;
  const canceled = allApts.filter(a => a.status === 'canceled').length;

  const serviceCounts = (services || []).map(s => ({
    name: s.name,
    count: allApts.filter(a => a.service_id === s.id).length,
    color: s.color || '#94a3b8',
  })).sort((a, b) => b.count - a.count);

  const staffCounts = (staff || []).map(s => ({
    name: s.name,
    count: allApts.filter(a => a.staff_id === s.id).length,
    color: s.color || '#60a5fa',
  })).sort((a, b) => b.count - a.count);

  const maxServiceCount = Math.max(...serviceCounts.map(s => s.count), 1);
  const maxStaffCount = Math.max(...staffCounts.map(s => s.count), 1);

  const stats = [
    { label: 'Total de citas', value: total, icon: CalendarDays },
    { label: 'Confirmadas', value: confirmed, icon: TrendingUp },
    { label: 'Pendientes', value: pending, icon: AlertTriangle },
    { label: 'Cancelaciones', value: canceled, icon: XCircle },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold text-foreground">Reportes</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-semibold mt-1">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Servicios populares</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {serviceCounts.length === 0 ? <p className="text-sm text-muted-foreground">Sin datos</p> : serviceCounts.map(s => (
              <div key={s.name} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-foreground">{s.name}</span>
                  <span className="text-muted-foreground">{s.count}</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(s.count / maxServiceCount) * 100}%`, backgroundColor: s.color }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Rendimiento del equipo</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {staffCounts.length === 0 ? <p className="text-sm text-muted-foreground">Sin datos</p> : staffCounts.map(s => (
              <div key={s.name} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-foreground">{s.name}</span>
                  <span className="text-muted-foreground">{s.count} citas</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(s.count / maxStaffCount) * 100}%`, backgroundColor: s.color }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
