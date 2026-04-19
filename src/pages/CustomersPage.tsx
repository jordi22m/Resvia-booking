import { Search, Plus, Phone, Mail, MoreHorizontal, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCustomers, useCreateCustomer, useUpdateCustomer, useDeleteCustomer, type Customer } from '@/hooks/use-customers';
import { useAppointments } from '@/hooks/use-appointments';
import { useToast } from '@/hooks/use-toast';

const tagColors: Record<string, string> = {
  habitual: 'bg-primary/10 text-primary',
  VIP: 'bg-warning/10 text-warning',
  nuevo: 'bg-success/10 text-success',
  'alto-riesgo': 'bg-destructive/10 text-destructive',
};

const defaultCustomer = { name: '', phone: '', email: '', notes: '', tags: [] as string[] };

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const { data: customers, isLoading } = useCustomers();
  const { data: appointments } = useAppointments();
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const deleteCustomer = useDeleteCustomer();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState(defaultCustomer);
  const [tagsInput, setTagsInput] = useState('');

  const filtered = (customers || []).filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone || '').includes(search)
  );

  const openCreate = () => { setEditing(null); setForm(defaultCustomer); setTagsInput(''); setDialogOpen(true); };
  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({ name: c.name, phone: c.phone || '', email: c.email || '', notes: c.notes || '', tags: c.tags || [] });
    setTagsInput((c.tags || []).join(', '));
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    try {
      if (editing) {
        await updateCustomer.mutateAsync({ id: editing.id, ...form, tags });
        toast({ title: 'Cliente actualizado' });
      } else {
        await createCustomer.mutateAsync({ ...form, tags });
        toast({ title: 'Cliente creado' });
      }
      setDialogOpen(false);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCustomer.mutateAsync(id);
      toast({ title: 'Cliente eliminado' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Clientes</h1>
          <p className="text-sm text-muted-foreground">{(customers || []).length} clientes en total</p>
        </div>
        <Button size="sm" onClick={openCreate} translate="no">
          <Plus className="h-4 w-4 mr-1.5" />
          <span>Agregar cliente</span>
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por nombre o teléfono..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="grid gap-3">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No hay clientes.</div>
        ) : filtered.map(customer => {
          const aptCount = (appointments || []).filter(a => a.customer_id === customer.id).length;
          return (
            <Card key={customer.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold shrink-0">
                  {customer.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{customer.name}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    {customer.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {customer.phone}</span>}
                    {customer.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {customer.email}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(customer.tags || []).map(tag => (
                    <span key={tag} className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${tagColors[tag] || 'bg-secondary text-secondary-foreground'}`}>{tag}</span>
                  ))}
                  <span className="text-xs text-muted-foreground">{aptCount} citas</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(customer)}><Pencil className="h-4 w-4 mr-2" /> Editar</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(customer.id)}><Trash2 className="h-4 w-4 mr-2" /> Eliminar</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar cliente' : 'Nuevo cliente'}</DialogTitle>
            <DialogDescription className="sr-only">
              {editing ? 'Edita los datos del cliente seleccionado.' : 'Crea un nuevo cliente para tu negocio.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Nombre completo" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+34 612 345 678" />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@ejemplo.com" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Etiquetas (separadas por coma)</Label>
              <Input value={tagsInput} onChange={e => setTagsInput(e.target.value)} placeholder="habitual, VIP" />
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} translate="no">
              <span>Cancelar</span>
            </Button>
            <Button onClick={handleSave} disabled={createCustomer.isPending || updateCustomer.isPending} translate="no">
              <span className="inline-flex h-4 w-4 items-center justify-center">
                {(createCustomer.isPending || updateCustomer.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
              </span>
              <span>{editing ? 'Guardar' : 'Crear'}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
