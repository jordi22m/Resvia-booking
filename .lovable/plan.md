

## Estado actual de la app

**Ya funciona:**
- Auth (login/registro/recuperar contraseña) con Supabase
- CRUD real de servicios, staff, clientes, citas
- Calendario con realtime
- Reserva pública por slug
- Dashboard y reportes con datos reales
- RLS configurado en todas las tablas

**Lo que falta para lanzar a mercado:**

### Bloque 1 — Imprescindibles antes de lanzar (crítico)

1. **Notificaciones push (NO están hechas)** — actualmente no hay nada. Implementar:
   - Web Push API + Service Worker (`public/sw.js`)
   - Tabla `push_subscriptions` (endpoint, keys, user_id)
   - Edge function `send-push` con `web-push` y claves VAPID
   - Botón "Activar notificaciones" en Settings
   - Triggers automáticos: nueva cita, cancelación, recordatorio 24h antes

2. **Notificaciones email/WhatsApp al cliente** (más importante que push para un SaaS de reservas):
   - Edge function `send-booking-confirmation` (email vía Resend)
   - Recordatorio 24h antes vía cron (`pg_cron` + edge function)
   - Opcional WhatsApp vía Twilio

3. **Seguridad y robustez:**
   - Activar HIBP (passwords filtradas) en auth
   - Validar slug único en `profiles` (constraint)
   - Validar solapamiento de citas (trigger SQL `check_appointment_overlap`)
   - Auto-confirm email opcional (decidir si requerir verificación)
   - Ejecutar security scan y arreglar findings

4. **Onboarding post-registro:**
   - Wizard tras registrarse: crear primer servicio, primer staff, definir slug, horarios
   - Sin esto el usuario llega a un dashboard vacío y se va

5. **Horarios de trabajo (falta tabla):**
   - Tabla `working_hours` (staff_id, day_of_week, start, end)
   - Tabla `time_off` (vacaciones/bloqueos)
   - La reserva pública debe respetar estos horarios al mostrar slots disponibles

### Bloque 2 — Monetización (necesario para "mercado")

6. **Pagos / suscripciones (Stripe):**
   - Plan Free / Pro / Business
   - Límites por plan (ej: Free = 1 staff, 50 citas/mes)
   - Tabla `subscriptions`, edge functions `create-checkout`, `customer-portal`, webhook de Stripe
   - Página de Pricing

7. **Depósitos / pagos online en reservas** (diferenciador vs competencia):
   - Cobrar % al reservar vía Stripe Checkout
   - Reduce no-shows drásticamente

### Bloque 3 — Calidad nivel "dios"

8. **Roles y multi-usuario por negocio:**
   - Tabla `user_roles` (admin, staff, recepción) con enum + función `has_role` SECURITY DEFINER
   - Permitir invitar empleados al mismo negocio
   - Hoy mismo cada `user_id` es un negocio aislado → no escala

9. **Storage:**
   - Bucket `avatars` (logo negocio, foto staff, foto servicio)
   - Bucket `customer-files` (notas/fichas con archivos)

10. **i18n real** (`react-i18next`) — hoy todo está hardcoded en español. Para mercado europeo necesitas EN/PT mínimo.

11. **PWA completa:**
    - `manifest.json`, iconos, instalable en móvil
    - Service worker con offline básico
    - Esto + push = experiencia app nativa sin app store

12. **Observabilidad y legal:**
    - Sentry para errores en producción
    - Analytics (PostHog o Plausible)
    - Páginas de Términos, Privacidad, Cookies (obligatorio GDPR)
    - Banner de cookies
    - Export/borrado de datos (derecho GDPR)

13. **Mejoras UX clave:**
    - Búsqueda global (Cmd+K)
    - Filtros y exportación CSV en Clientes/Citas
    - Vista móvil del calendario optimizada
    - Estados de carga (skeletons) en lugar de spinners
    - Empty states con CTA

14. **SEO de páginas públicas de reserva:**
    - Meta tags dinámicos por negocio en `/book/:slug`
    - Open Graph con logo del negocio
    - Sitemap dinámico

### Orden recomendado de ejecución

```text
Fase 1 (lanzar MVP a clientes reales):
  1 → 3 → 4 → 5 → 2(email) → 12(legal)

Fase 2 (monetizar):
  6 → 7 → 11(PWA+push)

Fase 3 (escalar):
  8 → 9 → 10 → 13 → 14 → 12(observabilidad)
```

### Sobre notificaciones push concretamente

**No están hechas.** Para hacerlas bien:
- Frontend: registrar Service Worker, pedir permiso, suscribir con `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC })`
- Guardar suscripción en tabla `push_subscriptions` vinculada a `user_id`
- Edge function que reciba evento (nueva cita) → consulta subs del dueño → envía con `web-push` usando VAPID privada (secret)
- Generar par VAPID con `npx web-push generate-vapid-keys` → pública en código, privada como secret

### Qué propongo hacer ahora

Empezar por **Fase 1 completa en bloques pequeños**. El primer bloque concreto:

**Próxima iteración (1 PR):**
- Notificaciones push (Web Push + VAPID + edge function + UI en Settings)
- Email de confirmación de reserva al cliente (Resend)
- Trigger SQL para evitar solapamiento de citas
- Validación de slug único
- Activar HIBP

¿Confirmas que arrancamos por ahí, o prefieres priorizar pagos/Stripe primero?

