// Lista de URLs para cronjobs externos
// Este archivo sirve como configuración central para todos los endpoints que pueden ser llamados por cronjobs externos

module.exports = {
  // Cronjobs para actualización de productos
  products: [
    {
      id: 'sync-stock',
      name: 'Actualizar productos con stock',
      url: '/api/sync-prices-stock?updateOnlyWithStock=true&source=external-cron',
      description: 'Actualiza precios y stock de productos que tienen stock disponible',
      method: 'GET',
      maxFrequency: '6h', // Frecuencia máxima recomendada
      params: {
        limit: 100, // Número de productos a procesar por ejecución
        updateMl: true // Actualizar también en MercadoLibre
      }
    },
    {
      id: 'sync-all',
      name: 'Actualizar todos los productos',
      url: '/api/sync-prices-stock?updateOnlyWithStock=false&source=external-cron',
      description: 'Actualiza precios y stock de todos los productos',
      method: 'GET',
      maxFrequency: '24h', // Frecuencia máxima recomendada
      params: {
        limit: 200, // Número de productos a procesar por ejecución
        updateMl: true // Actualizar también en MercadoLibre
      }
    }
  ],
  
  // Cronjobs para mantenimiento del sistema
  maintenance: [
    {
      id: 'exchange-rate',
      name: 'Actualizar tipo de cambio',
      url: '/api/exchange-rate?source=external-cron',
      description: 'Actualiza la tasa de cambio EUR/CLP para calcular los precios',
      method: 'GET',
      maxFrequency: '6h' // Frecuencia máxima recomendada
    },
    {
      id: 'clear-cache',
      name: 'Limpiar caché',
      url: '/api/clear-cache?source=external-cron',
      description: 'Limpia la caché del sistema para mejorar el rendimiento',
      method: 'GET',
      maxFrequency: '24h' // Frecuencia máxima recomendada
    }
  ],
  
  // Cronjobs para sincronización con MercadoLibre
  mercadolibre: [
    {
      id: 'refresh-token',
      name: 'Refrescar token ML',
      url: '/api/refresh-token?source=external-cron',
      description: 'Refresca el token de autenticación de MercadoLibre',
      method: 'GET',
      maxFrequency: '4h' // Frecuencia máxima recomendada
    }
  ],
  
  // Cronjobs para estadísticas y reportes
  reports: [
    {
      id: 'daily-report',
      name: 'Generar reporte diario',
      url: '/api/reports/daily?source=external-cron',
      description: 'Genera un reporte diario de actividad y ventas',
      method: 'GET',
      maxFrequency: '24h', // Frecuencia máxima recomendada
      params: {
        sendEmail: true // Enviar por correo electrónico
      }
    }
  ]
};