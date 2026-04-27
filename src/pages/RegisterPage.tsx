import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, EyeOff, Loader2, ArrowLeft, ArrowRight, Check, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ResviaLogo } from '@/components/ResviaLogo';

const businessTypes = [
  { value: 'peluqueria', label: 'Peluquería' },
  { value: 'barberia', label: 'Barbería' },
  { value: 'estetica', label: 'Centro de estética' },
  { value: 'fisioterapia', label: 'Fisioterapia' },
  { value: 'masajes', label: 'Masajes' },
  { value: 'osteopatia', label: 'Osteopatía' },
  { value: 'podologia', label: 'Podología' },
  { value: 'nutricion', label: 'Nutrición' },
  { value: 'psicologia', label: 'Psicología' },
  { value: 'veterinaria', label: 'Veterinaria' },
  { value: 'otro', label: 'Otro' },
];

const steps = [
  { title: 'Tu negocio', description: 'Información básica' },
  { title: 'Ubicación', description: 'Dónde estás' },
  { title: 'Tu cuenta', description: 'Credenciales de acceso' },
];

export default function RegisterPage() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const [form, setForm] = useState({
    businessName: '',
    businessType: '' as string,
    ownerName: '',
    phone: '',
    whatsapp: '',
    address: '',
    city: '',
    postalCode: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const update = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const canNext = () => {
    if (step === 0) return Boolean(
      form.businessName.trim() && 
      form.businessType && 
      form.ownerName.trim() &&
      form.businessName.trim().length >= 2 &&
      form.ownerName.trim().length >= 2
    );
    if (step === 1) return true;
    if (step === 2) return Boolean(
      form.email.trim() && 
      form.password.length >= 6 && 
      form.password === form.confirmPassword &&
      form.email.includes('@')
    );
    return false;
  };

  const handleRegister = async () => {
    // Additional validations
    if (!form.businessName.trim() || form.businessName.trim().length < 2) {
      toast({ title: 'El nombre del negocio debe tener al menos 2 caracteres', variant: 'destructive' });
      return;
    }
    if (!form.ownerName.trim() || form.ownerName.trim().length < 2) {
      toast({ title: 'El nombre del propietario debe tener al menos 2 caracteres', variant: 'destructive' });
      return;
    }
    if (!form.businessType) {
      toast({ title: 'Debes seleccionar un tipo de negocio', variant: 'destructive' });
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast({ title: 'Las contraseñas no coinciden', variant: 'destructive' });
      return;
    }
    if (form.password.length < 6) {
      toast({ title: 'La contraseña debe tener al menos 6 caracteres', variant: 'destructive' });
      return;
    }
    if (!form.email.includes('@')) {
      toast({ title: 'Ingresa un email válido', variant: 'destructive' });
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: {
          business_name: form.businessName.trim(),
          business_type: form.businessType,
          owner_name: form.ownerName.trim(),
          phone: form.phone.trim() || null,
          whatsapp: form.whatsapp.trim() || null,
          address: form.address.trim() || null,
          city: form.city.trim() || null,
          postal_code: form.postalCode.trim() || null,
        }
      }
    });
    setLoading(false);

    if (error) {
      const lowerMessage = (error.message || '').toLowerCase();
      const friendlyMessage =
        lowerMessage.includes('database error saving new user') ||
        lowerMessage.includes('status 500')
          ? 'Error interno al crear el perfil del negocio. Reintenta en unos segundos. Si persiste, aplica la migración SQL de fix del trigger de registro.'
          : error.message;

      toast({
        title: 'Error al registrarse',
        description: friendlyMessage,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: '¡Registro exitoso!',
      description: 'Revisa tu email para confirmar tu cuenta.',
    });

    navigate('/calendar');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-lg space-y-6">
        {/* Logo */}
        <div className="flex justify-center">
          <ResviaLogo />
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-2">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                i < step ? 'bg-primary text-primary-foreground' :
                i === step ? 'bg-primary text-primary-foreground' :
                'bg-secondary text-muted-foreground'
              }`}>
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`hidden sm:block text-xs ${i === step ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                {s.title}
              </span>
              {i < steps.length - 1 && <div className="w-8 h-px bg-border" />}
            </div>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{steps[step].title}</CardTitle>
            <CardDescription>{steps[step].description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 0 && (
              <>
                <div className="space-y-2">
                  <Label>Nombre del negocio *</Label>
                  <Input
                    placeholder="Ej: Studio Glow"
                    value={form.businessName}
                    onChange={(e) => update('businessName', e.target.value)}
                    maxLength={100}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tipo de negocio *</Label>
                  <div className="relative">
                    <select
                      value={form.businessType}
                      onChange={(e) => update('businessType', e.target.value)}
                      className={`flex h-10 w-full appearance-none items-center justify-between rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${form.businessType ? 'text-foreground' : 'text-muted-foreground'}`}
                    >
                      <option value="" disabled>
                        Selecciona el tipo
                      </option>
                      {businessTypes.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Nombre del propietario *</Label>
                  <Input
                    placeholder="Ej: Sara García"
                    value={form.ownerName}
                    onChange={(e) => update('ownerName', e.target.value)}
                    maxLength={100}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Teléfono</Label>
                    <Input
                      placeholder="+34 612 345 678"
                      value={form.phone}
                      onChange={(e) => update('phone', e.target.value)}
                      maxLength={20}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>WhatsApp</Label>
                    <Input
                      placeholder="+34612345678"
                      value={form.whatsapp}
                      onChange={(e) => update('whatsapp', e.target.value)}
                      maxLength={20}
                    />
                  </div>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div className="space-y-2">
                  <Label>Dirección</Label>
                  <Input
                    placeholder="Calle, número, piso..."
                    value={form.address}
                    onChange={(e) => update('address', e.target.value)}
                    maxLength={200}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Ciudad</Label>
                    <Input
                      placeholder="Madrid"
                      value={form.city}
                      onChange={(e) => update('city', e.target.value)}
                      maxLength={100}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Código postal</Label>
                    <Input
                      placeholder="28001"
                      value={form.postalCode}
                      onChange={(e) => update('postalCode', e.target.value)}
                      maxLength={10}
                    />
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    placeholder="tu@negocio.com"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    autoComplete="email"
                    maxLength={255}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Contraseña *</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Mínimo 6 caracteres"
                      value={form.password}
                      onChange={(e) => update('password', e.target.value)}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Confirmar contraseña *</Label>
                  <Input
                    type="password"
                    placeholder="Repite la contraseña"
                    value={form.confirmPassword}
                    onChange={(e) => update('confirmPassword', e.target.value)}
                    autoComplete="new-password"
                  />
                  {form.confirmPassword && form.password !== form.confirmPassword && (
                    <p className="text-xs text-destructive">Las contraseñas no coinciden</p>
                  )}
                </div>
              </>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <div className="flex w-full gap-3">
              {step > 0 && (
                <Button variant="outline" onClick={() => setStep(step - 1)} className="flex-1" translate="no">
                  <ArrowLeft className="h-4 w-4" />
                  <span>Atrás</span>
                </Button>
              )}
              {step < 2 ? (
                <Button onClick={() => setStep(step + 1)} disabled={!canNext()} className="flex-1" translate="no">
                  <span>Siguiente</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={handleRegister} disabled={!canNext() || loading} className="flex-1" translate="no">
                  <span className="inline-flex h-4 w-4 items-center justify-center">
                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  </span>
                  <span>Crear mi cuenta</span>
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground text-center">
              ¿Ya tienes cuenta?{' '}
              <Link to="/login" className="text-primary font-medium hover:underline">
                Iniciar sesión
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
