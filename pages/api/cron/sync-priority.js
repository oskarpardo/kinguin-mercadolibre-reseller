// API para productos de alta prioridad (más vendidos, nuevos lanzamientos)
// Se ejecuta más frecuentemente para mantener productos clave actualizados

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET method allowed' });
  }

  try {
    console.log('🚀 Iniciando sync de alta prioridad...');
    const startTime = Date.now();

    // Productos de alta prioridad: más vendidos y nuevos lanzamientos
    const priorityFilters = [
      'sortBy=popularity&order=desc&limit=1000',  // Más populares
      'sortBy=releaseDate&order=desc&limit=500',  // Más recientes
      'activePreorder=true&limit=500'             // Pre-orders activos
    ];

    let totalUpdated = 0;
    let totalCreated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const filter of priorityFilters) {
      try {
        const response = await fetch(`https://api.kinguin.net/v1/products?${filter}`, {
          headers: {
            'X-Api-Key': process.env.KINGUIN_API_KEY
          }
        });

        if (!response.ok) continue;

        const data = await response.json();
        const products = data.results || [];
        
        console.log(`📈 Procesando ${products.length} productos prioritarios`);

        // Procesar en chunks pequeños para alta velocidad
        const chunkSize = 25;
        for (let i = 0; i < products.length; i += chunkSize) {
          const chunk = products.slice(i, i + chunkSize);
          
          const promises = chunk.map(async (product) => {
            try {
              const addResponse = await fetch(`${process.env.VERCEL_URL || 'https://kinguin-ml-reseller.vercel.app'}/api/add-product`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productId: product.kinguinId })
              });

              const result = await addResponse.json();
              
              if (addResponse.ok) {
                if (result.action === 'created') totalCreated++;
                else if (result.action === 'updated') totalUpdated++;
                else totalSkipped++;
              } else {
                totalErrors++;
              }
            } catch (error) {
              totalErrors++;
            }
          });

          await Promise.allSettled(promises);
        }
      } catch (filterError) {
        console.error(`Error con filtro ${filter}:`, filterError.message);
      }
    }

    const executionTime = Math.round((Date.now() - startTime) / 1000);

    // Guardar estadísticas
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      
      await supabase.from('sync_history').insert({
        sync_type: 'priority',
        last_update: new Date().toISOString(),
        products_updated: totalUpdated,
        products_created: totalCreated,
        products_skipped: totalSkipped,
        products_error: totalErrors,
        execution_time_seconds: executionTime,
        metadata: {
          priority_level: 'high',
          filters_used: priorityFilters.length
        }
      });
    } catch (dbError) {
      console.error('Error guardando en DB:', dbError.message);
    }

    console.log(`🎯 Alta prioridad completada: ${totalUpdated} actualizados, ${totalCreated} creados (${executionTime}s)`);

    res.status(200).json({
      success: true,
      type: 'priority_sync',
      updated: totalUpdated,
      created: totalCreated,
      skipped: totalSkipped,
      errors: totalErrors,
      execution_time_seconds: executionTime
    });

  } catch (error) {
    console.error('❌ Error en sync prioritario:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}