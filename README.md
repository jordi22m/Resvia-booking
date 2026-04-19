# Resvia Booking

Plataforma profesional para la gestión de reservas, citas y agendamiento. Una solución SaaS completa para pequeñas y medianas empresas.

## 🎯 Características

- 📅 **Gestión de Calendario** - Visualiza y gestiona tus citas de forma sencilla
- 🔗 **Link de Reserva** - Comparte un link público para que tus clientes reserven directamente
- 📊 **Reportes** - Analiza tus citas, clientes y servicios
- ⚙️ **Automatizaciones** - Configura webhooks para integraciones personalizadas
- 👥 **Gestión de Clientes** - Mantén un registro completo de tus clientes
- 🛠️ **Servicios** - Define y gestiona tus servicios y precios
- 🔐 **Seguridad** - Autenticación segura con Supabase

## 🚀 Inicio Rápido

### Requisitos
- Node.js 16+
- npm o bun

### Instalación

```bash
# Instalar dependencias
bun install

# Ejecutar en desarrollo
bun dev

# Build para producción
bun build

# Tests
bun test
```

## 🏗️ Estructura del Proyecto

```
src/
├── components/        # Componentes React reutilizables
├── pages/            # Páginas principales de la app
├── hooks/            # Custom hooks
├── contexts/         # Contextos de React (Auth, etc)
├── lib/              # Utilidades y funciones de negocio
└── integrations/     # Integraciones externas (Supabase, etc)

supabase/
├── migrations/       # Migraciones SQL
├── functions/        # Edge Functions
└── config.toml       # Configuración de Supabase
```

## 🎨 Diseño

Resvia utiliza un sistema de colores profesional y limpio:

- **Primary**: Azul `#2563EB`
- **Background**: Claro `#F8FAFC`
- **Surface**: Blanco `#FFFFFF`
- **Text Primary**: `#0F172A`

Basado en **Tailwind CSS** para estilos consistentes y responsivos.

## 🔗 Links Públicos

- Perfil público: `/book/:slug` - Los clientes pueden reservar directamente
- Cancelar cita: `/booking/cancel/:token`
- Reprogramar cita: `/booking/reschedule/:token`

## 📝 Variables de Entorno

Crea un archivo `.env.local` con:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

## 📚 Documentación

Para más información sobre Resvia Booking, consulta la documentación completa.

---

**Resvia Booking** - Hecho para profesionales. 🎯

