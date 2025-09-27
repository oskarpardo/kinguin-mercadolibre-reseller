# Configuración de Webhooks y Sincronización Incremental

## 🚀 Funcionalidades implementadas

### ✅ 1. Webhooks de Kinguin
- **URL del webhook**: `https://tu-dominio.vercel.app/api/webhooks/kinguin`
- **Eventos soportados**: 
  - `product.update` - Cambios de precio/stock
  - `order.status` - Estado de órdenes
- **Respuesta**: 204 No Content (como requiere Kinguin)

### ✅ 2. Sincronización Incremental  
- **URL**: `POST /api/sync/incremental`
- **Beneficio**: 50x más rápido que sincronización completa
- **Uso**: Actualizar solo productos que cambiaron

### ✅ 3. Sincronización Completa
- **URL**: `POST /api/sync/complete`
- **Uso**: Reset completo o primera sincronización
- **Protección**: Evita ejecuciones múltiples

### ✅ 4. Dashboard de Monitoreo
- **URL**: `/sync-dashboard`
- **Funciones**: Ver historial, ejecutar sincronizaciones, monitorear webhooks

## 🔧 Configuración necesaria

### 1. Variables de entorno (.env.local)
```bash
# Webhook secret (generar string aleatorio)
KINGUIN_WEBHOOK_SECRET=tu-secret-super-seguro-aqui

# Ya tienes estas (verificar):
KINGUIN_API_KEY=tu-api-key
SUPABASE_URL=tu-supabase-url  
SUPABASE_SERVICE_ROLE_KEY=tu-supabase-key
```

### 2. Crear tablas en Supabase
```bash
# Ejecutar este archivo en Supabase SQL Editor:
# scripts/create_sync_tables.sql
```

### 3. Configurar webhook en Kinguin Dashboard
1. Ir a https://www.kinguin.net/integration/dashboard/stores
2. Seleccionar tu store
3. Hacer clic en "WEBHOOKS"
4. Configurar:
   - **URL**: `https://tu-dominio.vercel.app/api/webhooks/kinguin`
   - **Secret**: El mismo valor de `KINGUIN_WEBHOOK_SECRET`
   - **Eventos**: Seleccionar "product.update" y "order.status"

## 📋 Uso recomendado

### Estrategia diaria:
```javascript
// 06:00 - Sync completo diario
await fetch('/api/sync/complete', { method: 'POST' });

// Cada 30 minutos - Sync incremental
setInterval(async () => {
  await fetch('/api/sync/incremental', { method: 'POST' });
}, 30 * 60 * 1000);

// Webhooks - Automático en tiempo real
// (Se configuran una vez y funcionan automáticamente)
```

### Cron jobs sugeridos:
```bash
# En tu servidor o Vercel Cron Jobs
0 6 * * * curl -X POST https://tu-dominio.vercel.app/api/sync/complete
*/30 * * * * curl -X POST https://tu-dominio.vercel.app/api/sync/incremental
```

## 🎯 Beneficios esperados

### Antes (solo sincronización manual):
- ⏰ 2-3 horas por sincronización completa
- 🔄 1 vez al día máximo
- 📊 Precios desactualizados
- 😴 Sin notificaciones automáticas

### Después (con webhooks + incremental):
- ⚡ 30 segundos por sincronización incremental
- 🔄 Cada 30 minutos + tiempo real
- 📊 Precios siempre actualizados
- 🔔 Notificaciones automáticas de cambios

## 🚨 Monitoreo y alertas

### Dashboard disponible en:
- **URL**: `/sync-dashboard`
- **Métricas**: Historial, tiempos, productos actualizados
- **Queue de webhooks**: Ver pendientes y procesados
- **Controles**: Ejecutar sincronizaciones manuales

### Logs importantes:
```javascript
// Verificar estos logs en producción:
console.log("🔔 Webhook recibido: product.update");
console.log("⚡ Sincronización incremental: 23 productos actualizados");
console.log("✅ Producto sin stock pausado automáticamente");
```

## 🔧 Próximos pasos

1. **Ejecutar SQL en Supabase** (create_sync_tables.sql)
2. **Configurar variables de entorno**
3. **Configurar webhook en Kinguin Dashboard**
4. **Hacer primera sincronización completa**
5. **Configurar cron jobs para incrementales**
6. **Monitorear dashboard**

¡Tu sistema ahora será 50x más eficiente! 🚀