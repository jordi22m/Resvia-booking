# 🧪 Validación: Test de Integración Resvia ↔ n8n

**Objetivo:** Verificar que los webhooks se envían correctamente de Resvia a n8n.

---

## 📋 Prerequisitos

- ✅ Acceso a Supabase proyecto: `tsvifjuhaclrcorehzvk`
- ✅ Instancia de n8n configurada y accesible
- ✅ Acceso a WebhooksPage en Resvia app
- ✅ Terminal/CLI disponible

---

## 🧩 Test 1: Verificar Configuración Guardada

### En WebhooksPage.tsx:

1. Abre la app Resvia en `/webhooks`
2. Verifica que hay URL en el campo "URL del Webhook"
3. Verifica que hay eventos seleccionados (checkbox)
4. Verifica que hay un "Secreto para webhooks"

**Si falta algo:**
- Ingresa URL de n8n webhook
- Selecciona al menos "booking.created"
- Click "Guardar"

### En Base de Datos:

```sql
-- Abre SQL Editor en Supabase
SELECT 
  id,
  user_id,
  webhook_url,
  selected_events,
  active,
  created_at
FROM public.webhook_configs
ORDER BY created_at DESC
LIMIT 1;
```

**Resultado esperado:**
```
id                                  | webhook_url                          | selected_events                      | active
uuid-1234...                        | https://n8n.example.com/webhook/xyz  | {booking.created, booking.canceled}  | true
```

✅ Si hay resultado: Configuración guardada correctamente

---

## 🧩 Test 2: Enviar Webhook de Prueba

### Desde WebhooksPage.tsx:

1. Click botón "[✓] Enviar evento de prueba"
2. Espera 2-3 segundos
3. Mensaje debe aparecer: "Evento de prueba enviado"

### En Supabase SQL:

```sql
-- Verifica que se encolaron eventos
SELECT 
  id,
  event_type,
  status,
  created_at,
  next_retry_at
FROM public.webhook_events
WHERE user_id = auth.uid()
ORDER BY created_at DESC
LIMIT 5;
```

**Resultado esperado:**
```
id                   | event_type      | status       | created_at                  | next_retry_at
uuid-event-123...    | booking.created | pending      | 2026-05-14T10:30:00Z       | 2026-05-14T10:30:00Z
```

✅ Si status = 'pending': Evento encolado correctamente

### En n8n:

Dentro de 30 segundos a 5 minutos (según cron job), deberías recibir webhook.

**Verificar en n8n:**
1. Abre tu Webhook Node en n8n
2. Ve a pestaña "Test"
3. Debería haber 1 request recibido

```json
{
  "event": "booking.created",
  "timestamp": "2026-05-14T10:30:00.000Z",
  "business": { ... },
  "appointment": { ... },
  "customer": { ... },
  ...
}
```

✅ Si recibiste payload: Webhook llegó a n8n

---

## 🧩 Test 3: Crear Cita Real y Monitorear

### Paso 1: Crear Cita en Resvia

1. Abre link público de booking: `https://resviabooking.vercel.app/book/tu-slug`
2. Reserva una cita
3. Completa formulario y confirma

### Paso 2: Verificar Encolado

```sql
-- En Supabase SQL (inmediatamente después de crear cita)
SELECT 
  id,
  event_type,
  status,
  user_id,
  created_at
FROM public.webhook_events
WHERE event_type = 'booking.created'
ORDER BY created_at DESC
LIMIT 1;
```

**Resultado esperado:**
```
event_type     | status       | created_at
booking.created| pending      | 2026-05-14T10:35:00Z (fecha/hora actual)
```

✅ Evento encolado en webhook_events

### Paso 3: Esperar a Cron Job (15 minutos MAX)

El cron job ejecuta cada 15 minutos automáticamente.

**O trigger manual vía Edge Function:**

En terminal, ejecuta:

```bash
# Test manual del send-webhook function
curl -X POST "https://tsvifjuhaclrcorehzvk.supabase.co/functions/v1/send-webhook" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit": 10, "dispatchImmediately": true}'
```

### Paso 4: Verificar Envío a n8n

```sql
-- Después de esperar cron job o ejecutar manual
SELECT 
  id,
  event_type,
  status,
  attempt_count,
  response_status,
  sent_at,
  last_error
FROM public.webhook_events
WHERE event_type = 'booking.created'
ORDER BY created_at DESC
LIMIT 1;
```

**Resultado esperado:**
```
event_type     | status | attempt_count | response_status | sent_at
booking.created| sent   | 1             | 200             | 2026-05-14T10:36:00Z
```

✅ Si status = 'sent' y response_status = 200: Enviado exitosamente

**O si falló:**
```
event_type     | status | attempt_count | response_status | last_error
booking.created| failed | 3             | 503             | HTTP 503: Service Unavailable
```

⚠️ Si response_status ≠ 200: Verifica que n8n está disponible

### Paso 5: Verificar en n8n

1. Abre tu webhook en n8n
2. Debería estar recibiendo el evento en tiempo real
3. Verifica los detalles del request (headers, body)

---

## 🧩 Test 4: Verificar Headers de Seguridad

### En n8n Webhook Node:

Configure validación de header para seguridad:

```
Webhook Settings:
  ✅ Authentication: Header Auth
  Header Name: x-webhook-secret
  Header Value: <copiar de WebhooksPage "Secreto para webhooks">
```

### En base de datos:

```sql
SELECT secret FROM webhook_configs WHERE active = true LIMIT 1;
```

**Resultado:**
```
secret
wh_sec_abc123xyz789...
```

✅ Los headers enviados por Edge Function deben coincidir:
- `x-webhook-secret`: wh_sec_abc123xyz789...
- `x-webhook-event`: booking.created
- `x-resvia-event-id`: uuid-del-evento

---

## 🧩 Test 5: Simular Error en n8n y Validar Reintentos

### Paso 1: Desactivar Webhook en n8n

En tu n8n Webhook Node:
- Click en Settings
- Toggle OFF para desactivar temporalmente

### Paso 2: Crear Cita en Resvia

Crea nueva cita → webhook se encolará → send-webhook intentará enviar

### Paso 3: Monitorear Reintentos

```sql
SELECT 
  id,
  event_type,
  status,
  attempt_count,
  next_retry_at,
  last_error,
  created_at
FROM public.webhook_events
WHERE event_type = 'booking.created'
ORDER BY created_at DESC
LIMIT 1;
```

**Después de 1er intento fallido:**
```
status  | attempt_count | next_retry_at            | last_error
failed  | 1             | 2026-05-14T10:30:30Z     | HTTP 503: Service Unavailable
```

**Después de 2do intento (espera 30s + cron job):**
```
status  | attempt_count | next_retry_at
failed  | 2             | 2026-05-14T10:31:00Z
```

**Después de 3er intento:**
```
status  | attempt_count | next_retry_at
failed  | 3             | 2026-05-14T10:32:00Z
```

✅ **Exponential backoff funcionando:**
- Intento 1: espera 30s
- Intento 2: espera 60s
- Intento 3: espera 120s
- Intento 4: espera 240s
- Intento 5: final (no más reintentos)

### Paso 4: Reactivar Webhook en n8n

En n8n Webhook Node:
- Click Settings
- Toggle ON para reactivar

**Resultado esperado:**

```sql
SELECT status, response_status FROM webhook_events 
WHERE event_type = 'booking.created' 
ORDER BY created_at DESC LIMIT 1;
```

```
status | response_status
sent   | 200
```

✅ Se reintentó y finalmente envió exitosamente

---

## 🧩 Test 6: Diferentes Eventos

### Test booking.canceled

```sql
-- Obtén ID de una cita desde booking_page
SELECT id FROM public.appointments 
WHERE status = 'pending' 
LIMIT 1;

-- Cancélala desde la app o ejecuta:
UPDATE public.appointments 
SET status = 'canceled' 
WHERE id = 'uuid-appointment';
```

**Verificar en webhook_events:**
```sql
SELECT event_type, status FROM public.webhook_events
WHERE event_type = 'booking.canceled'
ORDER BY created_at DESC LIMIT 1;
```

✅ Debe haber nuevo evento 'booking.canceled'

### Test customer.created

```sql
-- Crea nuevo cliente en la app (desde booking o admin)
-- Webhook debe encolarse automáticamente

SELECT event_type, status FROM public.webhook_events
WHERE event_type = 'customer.created'
ORDER BY created_at DESC LIMIT 1;
```

✅ Evento 'customer.created' debe estar presente

---

## 🆘 Troubleshooting

### ❌ Problema: No veo webhook_events encolados

**Causa probable:** webhook_configs no está guardada activa

```sql
SELECT * FROM webhook_configs WHERE active = true;
-- Si está vacío → Usuario no configuró webhook
```

**Solución:**
1. Abre WebhooksPage
2. Ingresa URL de n8n
3. Selecciona eventos
4. Click "Guardar"

---

### ❌ Problema: status = 'failed' con last_error = "no_webhook_url"

**Causa:** webhook_url está vacía o nula

```sql
SELECT webhook_url FROM webhook_configs 
WHERE active = true LIMIT 1;
-- Si es NULL o ''
```

**Solución:**
1. WebhooksPage → Limpia y reingresar URL
2. Debe ser HTTPS válida
3. Click "Guardar"

---

### ❌ Problema: n8n no recibe webhooks

**Checklist:**

1. ¿La URL de n8n es pública y accesible?
   ```bash
   curl -X GET "https://tu-instancia-n8n.com"
   # Debe responder 200, no timeout
   ```

2. ¿El Webhook Node está activo en n8n?
   - Abre n8n → Workflow → Webhook Node settings
   - Debe estar conectado al resto del flujo

3. ¿Se validó el secret?
   - n8n Webhook Settings → Verify Secret = x-webhook-secret

4. ¿El webhook_events moestra sent con response_status 200?
   ```sql
   SELECT response_status, response_body FROM webhook_events 
   WHERE status = 'sent' LIMIT 1;
   ```
   - Si response_status ≠ 200: problema en n8n

---

### ❌ Problema: response_status = 404

**Causa:** URL del webhook es incorrecta

```sql
SELECT webhook_url FROM webhook_configs WHERE active = true;
```

**Solución:**
1. Verifica URL en n8n Webhook Node
2. Debe ser: `https://tu-instancia-n8n.com/webhook/tu-webhook-id`
3. Copia nuevamente en WebhooksPage
4. Click "Guardar"

---

### ❌ Problema: Edge Function falla (send-webhook error)

**En Supabase, verifica logs:**
1. Functions → send-webhook → Logs
2. Busca errores recientes

**Problema común:** SERVICE_ROLE_KEY no válida
- Verifica que SECRET de Supabase está configurado

---

## 📊 Dashboard de Monitoreo (SQL Query)

Copia esta query para ver estado completo:

```sql
SELECT 
  'Total pendiente' as metric, COUNT(*) as count
FROM public.webhook_events
WHERE status = 'pending'

UNION ALL

SELECT 'Total enviado', COUNT(*)
FROM public.webhook_events
WHERE status = 'sent'

UNION ALL

SELECT 'Total fallido', COUNT(*)
FROM public.webhook_events
WHERE status = 'failed'

UNION ALL

SELECT 'Últimas 24h', COUNT(*)
FROM public.webhook_events
WHERE created_at > now() - interval '24 hours'

ORDER BY metric;
```

---

## ✅ Checklist Final

Marca cuando cada validación pase:

- [ ] Configuración guardada en webhook_configs
- [ ] Eventos seleccionados en WebhooksPage
- [ ] Secret generado y visible
- [ ] Evento de prueba encolado
- [ ] Edge Function send-webhook se ejecutó
- [ ] n8n recibió webhook (status='sent', response_status=200)
- [ ] Headers x-webhook-secret validados
- [ ] Test con cita real funciona
- [ ] Reintentos funcionan con exponential backoff
- [ ] Diferentes eventos (created, canceled, etc) funcionan

✅ **Si todos los checks pasaron:** Sistema de webhooks está 100% operacional

---

**Última actualización:** 14/5/2026  
**Versión:** 1.0  
**Próximas mejoras:** API para crear webhooks programáticamente, dashboard de histórico
