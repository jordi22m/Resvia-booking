import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ArrowLeft, Mail } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ResviaLogo } from '@/components/ResviaLogo';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { toast } = useToast();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setSent(true);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex justify-center">
          <ResviaLogo hideText={true} />
        </div>

        <Card>
          {sent ? (
            <>
              <CardHeader className="text-center">
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Mail className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-xl">Revisa tu email</CardTitle>
                <CardDescription>
                  Te hemos enviado un enlace para restablecer tu contraseña a <strong>{email}</strong>
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Link to="/login" className="w-full">
                  <Button variant="outline" className="w-full" translate="no">
                    <ArrowLeft className="h-4 w-4" />
                    <span>Volver al login</span>
                  </Button>
                </Link>
              </CardFooter>
            </>
          ) : (
            <>
              <CardHeader className="text-center">
                <CardTitle className="text-xl">Recuperar contraseña</CardTitle>
                <CardDescription>Te enviaremos un enlace para restablecer tu contraseña</CardDescription>
              </CardHeader>
              <form onSubmit={handleReset}>
                <CardContent>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="tu@negocio.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-4">
                  <Button type="submit" className="w-full" disabled={loading} translate="no">
                    <span className="inline-flex h-4 w-4 items-center justify-center">
                      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                    </span>
                    <span>Enviar enlace</span>
                  </Button>
                  <Link to="/login" className="text-sm text-primary hover:underline">
                    <ArrowLeft className="inline h-3 w-3" /> Volver al login
                  </Link>
                </CardFooter>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
