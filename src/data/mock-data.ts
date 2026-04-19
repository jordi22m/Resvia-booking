export interface Business {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  timezone: string;
  currency: string;
  openingHours: Record<string, { open: string; close: string; closed?: boolean }>;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  avatar?: string;
  color: string;
  email: string;
  phone: string;
  serviceIds: string[];
}

export interface Service {
  id: string;
  name: string;
  duration: number; // minutes
  price: number;
  description: string;
  category: string;
  bookableOnline: boolean;
  requiresStaff: boolean;
  bufferBefore: number;
  bufferAfter: number;
  color: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  tags: string[];
  createdAt: string;
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'canceled' | 'completed' | 'noshow' | 'rescheduled';

export interface Appointment {
  id: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  notes: string;
  createdAt: string;
}

export const demoBusiness: Business = {
  id: 'biz-1',
  name: 'Studio Glow',
  slug: 'studio-glow',
  logo: '',
  address: 'Calle Mayor 123, Madrid, 28001',
  phone: '+34 612 345 678',
  whatsapp: '+34612345678',
  email: 'hola@studioglow.com',
  timezone: 'Europe/Madrid',
  currency: 'EUR',
  openingHours: {
    lunes: { open: '09:00', close: '19:00' },
    martes: { open: '09:00', close: '19:00' },
    miércoles: { open: '09:00', close: '19:00' },
    jueves: { open: '09:00', close: '21:00' },
    viernes: { open: '09:00', close: '19:00' },
    sábado: { open: '10:00', close: '17:00' },
    domingo: { open: '00:00', close: '00:00', closed: true },
  },
};

export const demoStaff: StaffMember[] = [
  { id: 'staff-1', name: 'Sara García', role: 'Estilista Senior', color: '#2dd4bf', email: 'sara@studio.com', phone: '+34611010101', serviceIds: ['svc-1', 'svc-2', 'svc-3'] },
  { id: 'staff-2', name: 'Miguel López', role: 'Barbero', color: '#60a5fa', email: 'miguel@studio.com', phone: '+34611010102', serviceIds: ['svc-1', 'svc-4'] },
  { id: 'staff-3', name: 'Elena Martínez', role: 'Colorista', color: '#f472b6', email: 'elena@studio.com', phone: '+34611010103', serviceIds: ['svc-3', 'svc-5'] },
];

export const demoServices: Service[] = [
  { id: 'svc-1', name: 'Corte de pelo', duration: 45, price: 55, description: 'Corte profesional con lavado y peinado', category: 'Cabello', bookableOnline: true, requiresStaff: true, bufferBefore: 0, bufferAfter: 10, color: '#2dd4bf' },
  { id: 'svc-2', name: 'Arreglo de barba', duration: 20, price: 25, description: 'Perfilado y recorte de barba de precisión', category: 'Cuidado personal', bookableOnline: true, requiresStaff: true, bufferBefore: 0, bufferAfter: 5, color: '#60a5fa' },
  { id: 'svc-3', name: 'Coloración', duration: 120, price: 150, description: 'Tratamiento completo de color con consulta', category: 'Cabello', bookableOnline: true, requiresStaff: true, bufferBefore: 0, bufferAfter: 15, color: '#f472b6' },
  { id: 'svc-4', name: 'Afeitado con toalla caliente', duration: 30, price: 35, description: 'Afeitado clásico con toalla caliente y navaja', category: 'Cuidado personal', bookableOnline: true, requiresStaff: true, bufferBefore: 0, bufferAfter: 5, color: '#a78bfa' },
  { id: 'svc-5', name: 'Mechas', duration: 90, price: 120, description: 'Mechas parciales o completas', category: 'Cabello', bookableOnline: true, requiresStaff: true, bufferBefore: 0, bufferAfter: 10, color: '#fbbf24' },
  { id: 'svc-6', name: 'Consulta', duration: 15, price: 0, description: 'Consulta gratuita para nuevos clientes', category: 'General', bookableOnline: true, requiresStaff: false, bufferBefore: 0, bufferAfter: 0, color: '#94a3b8' },
];

export const demoCustomers: Customer[] = [
  { id: 'cust-1', name: 'Alicia Rivera', phone: '+34651001001', email: 'alicia@email.com', notes: 'Prefiere productos orgánicos', tags: ['habitual', 'VIP'], createdAt: '2024-01-15' },
  { id: 'cust-2', name: 'Jaime Rodríguez', phone: '+34651001002', email: 'jaime@email.com', notes: '', tags: ['habitual'], createdAt: '2024-02-20' },
  { id: 'cust-3', name: 'María Santos', phone: '+34651001003', email: 'maria@email.com', notes: 'Alérgica a ciertos tintes', tags: ['nuevo'], createdAt: '2024-06-01' },
  { id: 'cust-4', name: 'David Kim', phone: '+34651001004', email: 'david@email.com', notes: '', tags: ['habitual'], createdAt: '2024-03-10' },
  { id: 'cust-5', name: 'Sofía Chen', phone: '+34651001005', email: 'sofia@email.com', notes: 'Alta tasa de cancelación', tags: ['alto-riesgo'], createdAt: '2024-04-22' },
];

const today = new Date();
const fmt = (d: Date) => d.toISOString().split('T')[0];

export const demoAppointments: Appointment[] = [
  { id: 'apt-1', customerId: 'cust-1', serviceId: 'svc-1', staffId: 'staff-1', date: fmt(today), startTime: '09:00', endTime: '09:45', status: 'confirmed', notes: '', createdAt: '2024-06-01' },
  { id: 'apt-2', customerId: 'cust-2', serviceId: 'svc-2', staffId: 'staff-2', date: fmt(today), startTime: '10:00', endTime: '10:20', status: 'confirmed', notes: '', createdAt: '2024-06-02' },
  { id: 'apt-3', customerId: 'cust-3', serviceId: 'svc-3', staffId: 'staff-3', date: fmt(today), startTime: '11:00', endTime: '13:00', status: 'pending', notes: 'Primera cita de coloración', createdAt: '2024-06-03' },
  { id: 'apt-4', customerId: 'cust-4', serviceId: 'svc-1', staffId: 'staff-1', date: fmt(today), startTime: '14:00', endTime: '14:45', status: 'confirmed', notes: '', createdAt: '2024-06-04' },
  { id: 'apt-5', customerId: 'cust-5', serviceId: 'svc-4', staffId: 'staff-2', date: fmt(today), startTime: '15:00', endTime: '15:30', status: 'pending', notes: '', createdAt: '2024-06-05' },
  { id: 'apt-6', customerId: 'cust-1', serviceId: 'svc-5', staffId: 'staff-3', date: fmt(new Date(today.getTime() + 86400000)), startTime: '10:00', endTime: '11:30', status: 'confirmed', notes: '', createdAt: '2024-06-06' },
  { id: 'apt-7', customerId: 'cust-2', serviceId: 'svc-1', staffId: 'staff-1', date: fmt(new Date(today.getTime() + 86400000)), startTime: '13:00', endTime: '13:45', status: 'confirmed', notes: '', createdAt: '2024-06-06' },
  { id: 'apt-8', customerId: 'cust-3', serviceId: 'svc-6', staffId: 'staff-1', date: fmt(new Date(today.getTime() + 2 * 86400000)), startTime: '09:00', endTime: '09:15', status: 'pending', notes: '', createdAt: '2024-06-07' },
];
