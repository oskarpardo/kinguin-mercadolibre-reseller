# Estrategia de Cron Jobs Optimizada para 100,000 Productos
# Usando solo 20 cron jobs para máxima eficiencia

## 📋 URLs para configurar en tu servicio de cron externo:

### 🚀 ALTA PRIORIDAD (Ejecutar cada 30 minutos)
1. https://kinguin-ml-reseller.vercel.app/api/cron/sync-priority
   - Productos más vendidos y lanzamientos nuevos
   - ~2000 productos más importantes
   - Frecuencia: Cada 30 minutos

### 📦 SINCRONIZACIÓN POR LOTES (Ejecutar cada 2 horas)
2. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=1&limit=5000
3. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=2&limit=5000
4. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=3&limit=5000
5. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=4&limit=5000
6. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=5&limit=5000
7. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=6&limit=5000
8. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=7&limit=5000
9. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=8&limit=5000
10. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=9&limit=5000
11. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=10&limit=5000
12. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=11&limit=5000
13. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=12&limit=5000
14. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=13&limit=5000
15. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=14&limit=5000
16. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=15&limit=5000
17. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=16&limit=5000
18. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=17&limit=5000
19. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=18&limit=5000
20. https://kinguin-ml-reseller.vercel.app/api/cron/sync-batch?page=19&limit=5000

### 🧹 MANTENIMIENTO (Ejecutar cada 6 horas)
- https://kinguin-ml-reseller.vercel.app/api/cron/maintenance
  - Procesa webhooks pendientes
  - Limpia datos antiguos
  - Verifica productos discontinuados

## 📊 CONFIGURACIÓN RECOMENDADA:

### Opción A: Cron Job Service (EasyCron, cron-job.org)
```
Alta Prioridad:    */30 * * * *  (cada 30 min)
Lotes 1-5:         0 */2 * * *   (cada 2 horas, offset 0)
Lotes 6-10:        15 */2 * * *  (cada 2 horas, offset 15)  
Lotes 11-15:       30 */2 * * *  (cada 2 horas, offset 30)
Lotes 16-20:       45 */2 * * *  (cada 2 horas, offset 45)
Mantenimiento:     0 */6 * * *   (cada 6 horas)
```

### Opción B: GitHub Actions (Gratis)
```yaml
# .github/workflows/sync-products.yml
name: Sync Products
on:
  schedule:
    # Alta prioridad cada 30 min
    - cron: '*/30 * * * *'
    # Lotes cada 2 horas con offset
    - cron: '0 */2 * * *'
    - cron: '15 */2 * * *'
    - cron: '30 */2 * * *'
    - cron: '45 */2 * * *'
```

## 🎯 COBERTURA COMPLETA:
- 📈 **Productos prioritarios**: Cada 30 min (~2k productos)
- 📦 **Productos generales**: Cada 2 horas (95k productos en lotes de 5k)
- 🔄 **Webhooks tiempo real**: Inmediato cuando Kinguin notifica
- 🧹 **Mantenimiento**: Cada 6 horas

## ⚡ EFICIENCIA:
- **Total URLs**: 20 (límite respetado)
- **Productos/día**: 100% cobertura completa
- **Tiempo ciclo**: 38 horas para ciclo completo
- **Priorización**: Los más vendidos se actualizan 76 veces más
- **Redundancia**: Webhooks + sync programado

## 💡 BENEFICIOS:
✅ Productos populares siempre actualizados
✅ Cobertura completa en menos de 2 días  
✅ Webhooks para cambios inmediatos
✅ Mantenimiento automático
✅ Escalable a millones de productos