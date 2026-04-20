import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Plus, Pencil, Trash2, Bell, BellOff } from 'lucide-react';
import { useProfile, useUpdateProfile } from '@/hooks/use-profile';
import { useStaff, useCreateStaff, useUpdateStaff, useDeleteStaff, type StaffMember } from '@/hooks/use-staff';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { isPushSupported, isSubscribed, subscribeToPush, unsubscribeFromPush } from '@/lib/push';
import { AvailabilitySettings } from '@/components/AvailabilitySettings';
import type { TablesUpdate } from '@/integrations/supabase/types';

type ProfileSettingsForm = {
  business_name: string;
  phone: string;
  email: string;
  whatsapp: string;
  address: string;
  slug: string;
  booking_enabled: boolean;
  allow_weekends: boolean;
  slot_minutes: number;
  buffer_minutes: number;
  min_notice_minutes: number;
  max_days_ahead: number;
  timezone: string;
  require_phone: boolean;
  require_email: boolean;
  public_booking_title: string;
  public_booking_description: string;
};

export default function SettingsPage() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const { data: staff } = useStaff();
  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();
  const deleteStaff = useDeleteStaff();
  const { signOut, user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState<ProfileSettingsForm>({
    business_name: '',
    phone: '',
    email: '',
    whatsapp: '',
    address: '',
    slug: '',
    booking_enabled: true,
    allow_weekends: false,
    slot_minutes: 30,
    buffer_minutes: 0,
    min_notice_minutes: 0,
    max_days_ahead: 60,
    timezone: 'Europe/Madrid',
    require_phone: true,
    require_email: false,
    public_booking_title: '',
    public_booking_description: '',
  });
  const [staffDialogOpen, setStaffDialogOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [staffForm, setStaffForm] = useState({ name: '', role: '', email: '', phone: '', color: '#60a5fa' });
  const [pushOn, setPushOn] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => { isSubscribed().then(setPushOn); }, []);

  const togglePush = async () => {
    if (!user) return;
    setPushLoading(true);
    try {
      if (pushOn) {
        await unsubscribeFromPush();
        setPushOn(false);
        toast({ title: 'Notificaciones desactivadas' });
      } else {
        await subscribeToPush(user.id);
        setPushOn(true);
        toast({ title: 'Notificaciones activadas' });
      }
    } catch (e: unknown) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Error inesperado', variant: 'destructive' });
    } finally {
      setPushLoading(false);
    }
  };

  useEffect(() => {
    if (profile) {
      setForm({
        business_name: profile.business_name || '',
        phone: profile.phone || '',
        email: profile.email || '',
        whatsapp: profile.whatsapp || '',
        address: profile.address || '',
        slug: profile.slug || '',
        booking_enabled: profile.booking_enabled ?? true,
        allow_weekends: profile.allow_weekends ?? false,
        slot_minutes: profile.slot_minutes ?? 30,
        buffer_minutes: profile.buffer_minutes ?? 0,
        min_notice_minutes: profile.min_notice_minutes ?? 0,
        max_days_ahead: profile.max_days_ahead ?? 60,
        timezone: profile.timezone || 'Europe/Madrid',
        require_phone: profile.require_phone ?? true,
        require_email: profile.require_email ?? false,
        public_booking_title: profile.public_booking_title || '',
        public_booking_description: profile.public_booking_description || '',
      });
    }
  }, [profile]);

  const handleSaveProfile = async () => {
    try {
      const business_name = form.business_name.trim();
      const slug = form.slug.trim().toLowerCase();

      if (!business_name) {
        toast({ title: 'Campo requerido', description: 'El nombre del negocio es obligatorio', variant: 'destructive' });
        return;
      }
      if (!slug) {
        toast({ title: 'Campo requerido', description: 'El slug es obligatorio', variant: 'destructive' });
        return;
      }

      const updates: TablesUpdate<'profiles'> = {
        business_name,
        slug,
        phone: form.phone,
        email: form.email,
        whatsapp: form.whatsapp,
        address: form.address,
        booking_enabled: form.booking_enabled,
        allow_weekends: form.allow_weekends,
        slot_minutes: form.slot_minutes,
        buffer_minutes: form.buffer_minutes,
        min_notice_minutes: form.min_notice_minutes,
        max_days_ahead: form.max_days_ahead,
        timezone: form.timezone,
        require_phone: form.require_phone,
        require_email: form.require_email,
        public_booking_title: form.public_booking_title,
        public_booking_description: form.public_booking_description,
      };
      await updateProfile.mutateAsync(updates);
      toast({ title: 'Perfil actualizado' });
    } catch (e: unknown) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Error inesperado', variant: 'destructive' });
    }
  };

  const openCreateStaff = () => { setEditingStaff(null); setStaffForm({ name: '', role: '', email: '', phone: '', color: '#60a5fa' }); setStaffDialogOpen(true); };
  const openEditStaff = (s: StaffMember) => {
    setEditingStaff(s);
    setStaffForm({ name: s.name, role: s.role || '', email: s.email || '', phone: s.phone || '', color: s.color || '#60a5fa' });
    setStaffDialogOpen(true);
  };

  const handleSaveStaff = async () => {
    if (!staffForm.name.trim()) return;
    try {
      if (editingStaff) {
        await updateStaff.mutateAsync({ id: editingStaff.id, ...staffForm });
      } else {
        await createStaff.mutateAsync(staffForm);
      }
      toast({ title: editingStaff ? 'Miembro actualizado' : 'Miembro creado' });
      setStaffDialogOpen(false);
    } catch (e: unknown) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Error inesperado', variant: 'destructive' });
    }
  };

  const handleDeleteStaff = async (id: string) => {
    try {
      await deleteStaff.mutateAsync(id);
      toast({ title: 'Miembro eliminado' });
    } catch (e: unknown) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'Error inesperado', variant: 'destructive' });
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold text-foreground">Configuración</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">Perfil del negocio</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground">Nombre del negocio *</label>
              <Input value={form.business_name} onChange={e => setForm(p => ({ ...p, business_name: e.target.value }))} className="mt-1.5" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Teléfono</label>
              <Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} className="mt-1.5" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Correo electrónico</label>
              <Input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className="mt-1.5" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">WhatsApp</label>
              <Input value={form.whatsapp} onChange={e => setForm(p => ({ ...p, whatsapp: e.target.value }))} className="mt-1.5" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Slug (URL pública) *</label>
              <Input value={form.slug} onChange={e => setForm(p => ({ ...p, slug: e.target.value }))} className="mt-1.5" placeholder="mi-negocio" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Dirección</label>
              <Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} className="mt-1.5" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label>Booking habilitado</Label>
              <Switch checked={form.booking_enabled} onCheckedChange={(v) => setForm((p) => ({ ...p, booking_enabled: v }))} />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label>Permitir fines de semana</Label>
              <Switch checked={form.allow_weekends} onCheckedChange={(v) => setForm((p) => ({ ...p, allow_weekends: v }))} />
            </div>
            <div>
              <Label>Intervalo de slots (min)</Label>
              <Input
                type="number"
                min={5}
                step={5}
                value={form.slot_minutes}
                onChange={e => setForm(p => ({ ...p, slot_minutes: Number(e.target.value) || 30 }))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Buffer entre citas (min)</Label>
              <Input
                type="number"
                min={0}
                step={5}
                value={form.buffer_minutes}
                onChange={e => setForm(p => ({ ...p, buffer_minutes: Number(e.target.value) || 0 }))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Antelación mínima (min)</Label>
              <Input
                type="number"
                min={0}
                step={5}
                value={form.min_notice_minutes}
                onChange={e => setForm(p => ({ ...p, min_notice_minutes: Number(e.target.value) || 0 }))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Días máximos por delante</Label>
              <Input
                type="number"
                min={1}
                value={form.max_days_ahead}
                onChange={e => setForm(p => ({ ...p, max_days_ahead: Number(e.target.value) || 60 }))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Timezone</Label>
              <Input
                value={form.timezone}
                onChange={e => setForm(p => ({ ...p, timezone: e.target.value }))}
                className="mt-1.5"
                placeholder="Europe/Madrid"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <Label>Requerir teléfono en reserva</Label>
                <Switch checked={form.require_phone} onCheckedChange={(v) => setForm((p) => ({ ...p, require_phone: v }))} />
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <Label>Requerir email en reserva</Label>
                <Switch checked={form.require_email} onCheckedChange={(v) => setForm((p) => ({ ...p, require_email: v }))} />
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label>Título público de reservas</Label>
              <Input
                value={form.public_booking_title}
                onChange={e => setForm(p => ({ ...p, public_booking_title: e.target.value }))}
                className="mt-1.5"
                placeholder="Reserva tu cita"
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Descripción pública de reservas</Label>
              <Textarea
                value={form.public_booking_description}
                onChange={e => setForm(p => ({ ...p, public_booking_description: e.target.value }))}
                className="mt-1.5"
                rows={3}
                placeholder="Selecciona servicio, fecha y hora para confirmar."
              />
            </div>
          </div>
          <Button size="sm" onClick={handleSaveProfile} disabled={updateProfile.isPending} translate="no">
            <span className="inline-flex h-4 w-4 items-center justify-center">
              {updateProfile.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            </span>
            <span>Guardar cambios</span>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Miembros del equipo</CardTitle>
            <Button size="sm" variant="outline" onClick={openCreateStaff} translate="no">
              <Plus className="h-4 w-4 mr-1.5" />
              <span>Agregar miembro</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {(staff || []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No hay miembros del equipo.</p>
            ) : (staff || []).map(member => (
              <div key={member.id} className="flex items-center gap-4 py-3">
                <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold" style={{ backgroundColor: `${member.color || '#60a5fa'}20`, color: member.color || '#60a5fa' }}>
                  {member.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{member.name}</p>
                  <p className="text-xs text-muted-foreground">{member.role}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditStaff(member)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteStaff(member.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AvailabilitySettings />

      <Card>
        <CardHeader><CardTitle className="text-base">Notificaciones</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Recibe avisos en este dispositivo cuando se cree una cita nueva.
          </p>
          <Button size="sm" variant={pushOn ? 'outline' : 'default'} onClick={togglePush} disabled={pushLoading || !isPushSupported()} translate="no">
            <span className="inline-flex h-4 w-4 items-center justify-center">
              {pushLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : pushOn ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            </span>
            <span>{pushOn ? 'Desactivar notificaciones' : 'Activar notificaciones'}</span>
          </Button>
          {!isPushSupported() && <p className="text-xs text-muted-foreground">Tu navegador no soporta notificaciones push.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Cuenta</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Cerrar sesión te llevará de vuelta a la página de inicio de sesión. Tus datos permanecerán seguros en la aplicación.
            </p>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                if (window.confirm('¿Estás seguro de que quieres cerrar sesión?')) {
                  try {
                    await signOut();
                    navigate('/login', { replace: true });
                  } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : 'No se pudo cerrar sesión';
                    toast({
                      title: 'Error al cerrar sesión',
                      description: message,
                      variant: 'destructive',
                    });
                  }
                }
              }}
              translate="no"
            >
              <span>Cerrar sesión</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={staffDialogOpen} onOpenChange={setStaffDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingStaff ? 'Editar miembro' : 'Nuevo miembro'}</DialogTitle>
            <DialogDescription className="sr-only">
              {editingStaff ? 'Edita los datos del miembro del equipo seleccionado.' : 'Crea un nuevo miembro del equipo.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input value={staffForm.name} onChange={e => setStaffForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Input value={staffForm.role} onChange={e => setStaffForm(p => ({ ...p, role: e.target.value }))} placeholder="Ej: Estilista Senior" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={staffForm.email} onChange={e => setStaffForm(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input value={staffForm.phone} onChange={e => setStaffForm(p => ({ ...p, phone: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <Input type="color" value={staffForm.color} onChange={e => setStaffForm(p => ({ ...p, color: e.target.value }))} className="h-10 w-20" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStaffDialogOpen(false)} translate="no">
              <span>Cancelar</span>
            </Button>
            <Button onClick={handleSaveStaff} disabled={createStaff.isPending || updateStaff.isPending} translate="no">
              <span className="inline-flex h-4 w-4 items-center justify-center">
                {(createStaff.isPending || updateStaff.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
              </span>
              <span>{editingStaff ? 'Guardar' : 'Crear'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
