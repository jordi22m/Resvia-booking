import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Calendar, Scissors, Users, Settings, Link2, BarChart3,
  Webhook, Bell, Menu, X, ChevronLeft, FileUp, CalendarPlus2, CalendarX2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProfile } from '@/hooks/use-profile';
import { useAuth } from '@/contexts/AuthContext';
import { ResviaLogo } from '@/components/ResviaLogo';
import { useAppointments } from '@/hooks/use-appointments';

const navItems = [
  { path: '/calendar', label: 'Calendario', icon: Calendar },
  { path: '/dashboard', label: 'Panel', icon: LayoutDashboard },
  { path: '/services', label: 'Servicios', icon: Scissors },
  { path: '/customers', label: 'Clientes', icon: Users },
  { path: '/booking-link', label: 'Link de Reserva', icon: Link2 },
  { path: '/reports', label: 'Reportes', icon: BarChart3 },
  { path: '/webhooks', label: 'Automatizaciones', icon: Webhook },
  { path: '/imports', label: 'Importar CSV', icon: FileUp },
  { path: '/settings', label: 'Configuración', icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { data: profile } = useProfile();
  const { user } = useAuth();
  const { data: appointments } = useAppointments();
  const notificationContainerRef = useRef<HTMLDivElement | null>(null);
  const previousAppointmentsRef = useRef<Map<string, { status: string | null; date: string; start_time: string }>>(new Map());

  type NotificationType = 'new_booking' | 'cancelled_booking';
  type AppNotification = {
    id: string;
    type: NotificationType;
    title: string;
    message: string;
    createdAt: string;
    read: boolean;
  };

  // Frontend-only notification store. Later can be replaced by backend events.
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const businessName = profile?.business_name || 'Mi Negocio';
  const ownerName = profile?.owner_name || user?.email || '';
  const ownerInitial = ownerName ? ownerName.charAt(0).toUpperCase() : 'U';
  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  const pushNotification = (notification: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => {
    setNotifications(prev => {
      const nextItem: AppNotification = {
        id: crypto.randomUUID(),
        type: notification.type,
        title: notification.title,
        message: notification.message,
        createdAt: new Date().toISOString(),
        read: false,
      };
      return [nextItem, ...prev].slice(0, 50);
    });
  };

  const markNotificationAsRead = (id: string) => {
    setNotifications(prev => prev.map(notification =>
      notification.id === id
        ? { ...notification, read: true }
        : notification
    ));
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(notification => ({ ...notification, read: true })));
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!notificationContainerRef.current) return;
      if (!notificationContainerRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!appointments) return;

    const currentMap = new Map<string, { status: string | null; date: string; start_time: string }>();
    for (const appointment of appointments) {
      currentMap.set(appointment.id, {
        status: appointment.status,
        date: appointment.date,
        start_time: appointment.start_time,
      });
    }

    const previousMap = previousAppointmentsRef.current;

    // Baseline inicial: no generar notificaciones históricas al cargar.
    if (previousMap.size === 0) {
      previousAppointmentsRef.current = currentMap;
      return;
    }

    // Nueva reserva detectada (existe ahora y no existía antes).
    for (const [appointmentId, current] of currentMap.entries()) {
      if (!previousMap.has(appointmentId)) {
        pushNotification({
          type: 'new_booking',
          title: 'Nueva reserva',
          message: `Cita para ${current.date} a las ${current.start_time}`,
        });
      }
    }

    // Reserva cancelada detectada por cambio de estado.
    for (const [appointmentId, current] of currentMap.entries()) {
      const previous = previousMap.get(appointmentId);
      if (!previous) continue;

      const prevStatus = (previous.status || '').toLowerCase();
      const currentStatus = (current.status || '').toLowerCase();
      const isNowCancelled = currentStatus === 'cancelled' || currentStatus === 'canceled';
      const wasCancelled = prevStatus === 'cancelled' || prevStatus === 'canceled';

      if (!wasCancelled && isNowCancelled) {
        pushNotification({
          type: 'cancelled_booking',
          title: 'Reserva cancelada',
          message: `Se canceló la cita del ${current.date} a las ${current.start_time}`,
        });
      }
    }

    previousAppointmentsRef.current = currentMap;
  }, [appointments]);

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
            <div className="relative" ref={notificationContainerRef}>
              <button
                className="relative h-9 w-9 rounded-lg flex items-center justify-center hover:bg-secondary text-muted-foreground transition-colors"
                onClick={() => setNotificationsOpen(prev => !prev)}
                aria-label="Abrir notificaciones"
              >
                <Bell className="h-[18px] w-[18px]" />
                {unreadCount > 0 ? <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive" /> : null}
              </button>

              {notificationsOpen ? (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-border bg-popover shadow-lg z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
                    <p className="text-sm font-semibold text-foreground">Notificaciones</p>
                    <button
                      className="text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                      onClick={markAllAsRead}
                      disabled={unreadCount === 0}
                    >
                      Marcar todo como leído
                    </button>
                  </div>

                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                        No hay notificaciones
                      </div>
                    ) : (
                      notifications.map(notification => (
                        <button
                          key={notification.id}
                          onClick={() => markNotificationAsRead(notification.id)}
                          className={cn(
                            'w-full text-left px-3 py-3 border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors',
                            notification.read ? 'bg-transparent' : 'bg-primary/5',
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <div className="mt-0.5 text-muted-foreground">
                              {notification.type === 'new_booking' ? <CalendarPlus2 className="h-4 w-4" /> : <CalendarX2 className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-foreground truncate">{notification.title}</p>
                                {!notification.read ? <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" /> : null}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">{notification.message}</p>
                              <p className="text-[11px] text-muted-foreground mt-1">
                                {new Date(notification.createdAt).toLocaleString('es-ES', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
