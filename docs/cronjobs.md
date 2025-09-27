# Configuración de Cronjobs para Kinguin-MercadoLibre Reseller

Este documento explica cómo configurar y mantener las tareas programadas para la sincronización automática de productos.

## Descripción general

El sistema utiliza cronjobs para actualizar automáticamente:

1. **Productos con stock** - Actualiza precios y stock de productos disponibles
2. **Todos los productos** - Actualiza todos los productos (con o sin stock)
3. **Tipo de cambio** - Actualiza la tasa EUR/CLP para calcular los precios

## Requisitos

- Node.js 14+ instalado
- PM2 (opcional, pero recomendado para producción)
- Base de datos Supabase configurada

## Configuración de la base de datos

Para configurar las tablas necesarias para los cronjobs, ejecuta:

```bash
# Conéctate a tu base de datos Supabase
psql -h [HOST] -d [DATABASE] -U [USER]

# Una vez conectado, ejecuta el script SQL
\i scripts/create_cron_tables.sql
```

## Ejecución del servidor de cronjobs

### Opción 1: Ejecución directa

Para ejecutar el servidor de cronjobs directamente:

```bash
# Asegúrate de que las variables de entorno estén configuradas
node scripts/cron-server.js
```

### Opción 2: Usando PM2 (recomendado para producción)

PM2 te permite ejecutar el servidor como un servicio que se reinicia automáticamente:

```bash
# Instalar PM2 si no está instalado
npm install -g pm2

# Iniciar el servidor de cronjobs
pm2 start scripts/cron-server.js --name "kinguin-ml-cronjobs"

# Configurar para que se inicie automáticamente al reiniciar el sistema
pm2 startup
pm2 save

# Ver logs
pm2 logs kinguin-ml-cronjobs

# Verificar estado
pm2 status
```

## Configuración de horarios

Los horarios de ejecución de las tareas se pueden configurar a través de la interfaz web en:

```
/cron-jobs
```

Los horarios utilizan formato cron con 5 campos:

```
┌────────────── minuto (0 - 59)
│ ┌──────────── hora (0 - 23)
│ │ ┌────────── día del mes (1 - 31)
│ │ │ ┌──────── mes (1 - 12)
│ │ │ │ ┌────── día de la semana (0 - 6) (Domingo a Sábado)
│ │ │ │ │
│ │ │ │ │
* * * * *
```

Ejemplos comunes:

- `0 */6 * * *` - Cada 6 horas
- `0 3 * * *` - Todos los días a las 3:00 AM
- `*/15 * * * *` - Cada 15 minutos

## Ejecución manual

También puedes ejecutar manualmente las tareas programadas desde la interfaz web o a través de la API:

```bash
# Actualizar productos con stock
curl -X POST http://localhost:3000/api/run-cron \
  -H "Content-Type: application/json" \
  -d '{"jobType": "update_stock"}'

# Actualizar todos los productos
curl -X POST http://localhost:3000/api/run-cron \
  -H "Content-Type: application/json" \
  -d '{"jobType": "update_all"}'

# Actualizar tipo de cambio
curl -X POST http://localhost:3000/api/run-cron \
  -H "Content-Type: application/json" \
  -d '{"jobType": "exchange_rate"}'
```

## Monitoreo

Puedes monitorear las ejecuciones de las tareas programadas a través de:

1. **Interfaz web** - En la página `/cron-jobs`
2. **Logs del sistema** - Si usas PM2: `pm2 logs kinguin-ml-cronjobs`
3. **Base de datos** - Tablas `cron_execution_history` y `activity_logs`

## Solución de problemas

Si las tareas programadas no se ejecutan:

1. Verifica que el servidor de cronjobs esté en ejecución
2. Asegúrate de que la configuración esté activada en la interfaz web
3. Revisa los logs para detectar posibles errores
4. Comprueba la conectividad a la base de datos y a las APIs externas

## Respaldos

Es recomendable configurar respaldos regulares de la base de datos, especialmente de las tablas:

- `products` - Datos de productos
- `price_history` - Historial de cambios de precios
- `cron_config` - Configuración de tareas programadas
- `cron_execution_history` - Historial de ejecuciones

## Contacto

Si encuentras problemas con el sistema de tareas programadas, contacta al administrador.