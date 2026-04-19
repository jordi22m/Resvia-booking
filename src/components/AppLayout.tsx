import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Calendar, Scissors, Users, Settings, Link2, BarChart3,
  Webhook, Bell, Menu, X, ChevronLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProfile } from '@/hooks/use-profile';
import { useAuth } from '@/contexts/AuthContext';
import { ResviaLogo } from '@/components/ResviaLogo';

const navItems = [
  { path: '/dashboard', label: 'Panel', icon: LayoutDashboard },
  { path: '/calendar', label: 'Calendario', icon: Calendar },
  { path: '/services', label: 'Servicios', icon: Scissors },
  { path: '/customers', label: 'Clientes', icon: Users },
  { path: '/booking-link', label: 'Link de Reserva', icon: Link2 },
  { path: '/reports', label: 'Reportes', icon: BarChart3 },
  { path: '/webhooks', label: 'Automatizaciones', icon: Webhook },
  { path: '/settings', label: 'Configuración', icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: profile } = useProfile();
  const { user } = useAuth();

  const businessName = profile?.business_name || 'Mi Negocio';
  const ownerName = profile?.owner_name || user?.email || '';
  const ownerInitial = ownerName ? ownerName.charAt(0).toUpperCase() : 'U';

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 lg:relative",
        collapsed ? "w-[72px]" : "w-64",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <div className="flex h-16 items-center justify-between px-4 border-b border-sidebar-border">
          {!collapsed && (
            <ResviaLogo hideText={false} className="!gap-2" />
          )}
          {collapsed && (
            <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <div className="h-6 w-6 text-primary-foreground">R</div>
            </div>
          )}
          <button onClick={() => setCollapsed(!collapsed)} className="hidden lg:flex h-6 w-6 items-center justify-center rounded-md hover:bg-secondary text-muted-foreground">
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </button>
          <button onClick={() => setMobileOpen(false)} className="lg:hidden text-muted-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!collapsed && (
          <div className="px-4 py-3 border-b border-sidebar-border">
            <p className="text-xs text-muted-foreground">Espacio de trabajo</p>
            <p className="text-sm font-medium text-foreground truncate">{businessName}</p>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map(item => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-sidebar-foreground hover:bg-secondary hover:text-foreground",
                  collapsed && "justify-center px-0"
                )}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {!collapsed && (
          <div className="p-4 border-t border-sidebar-border">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold">{ownerInitial}</div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{ownerName}</p>
                <p className="text-xs text-muted-foreground">Propietario</p>
              </div>
            </div>
          </div>
        )}
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b border-border px-4 lg:px-6 bg-card">
          <button onClick={() => setMobileOpen(true)} className="lg:hidden text-muted-foreground">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3">
            <button className="relative h-9 w-9 rounded-lg flex items-center justify-center hover:bg-secondary text-muted-foreground transition-colors">
              <Bell className="h-[18px] w-[18px]" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
