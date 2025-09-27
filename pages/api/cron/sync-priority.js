// API para productos de prioridad con configuración dinámica de velocidad

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET method allowed' });
  }

  try {
    const { 
      limit = 1000, 
      priority = 'high',
      speed = 'fast' 
    } = req.query;
    
    console.log(`🚀 Sync prioridad ${priority} (${limit} productos)`);
    const startTime = Date.now();

    // Configuración según prioridad
    const priorityConfig = {
      ultra: {
        filters: [
          `sortBy=popularity&order=desc&limit=${Math.floor(limit * 0.6)}`,
          `sortBy=releaseDate&order=desc&limit=${Math.floor(limit * 0.3)}`,
          `activePreorder=true&limit=${Math.floor(limit * 0.1)}`
        ],
        chunkSize: 50,
        timeout: 15000
      },
      high: {
        filters: [
          `sortBy=popularity&order=desc&limit=${Math.floor(limit * 0.7)}`,
          `sortBy=releaseDate&order=desc&limit=${Math.floor(limit * 0.3)}`
        ],
        chunkSize: 30,
        timeout: 20000
      },
      medium: {
        filters: [
          `sortBy=popularity&order=desc&limit=${limit}`
        ],
        chunkSize: 20,
        timeout: 30000
      }
    };

    const config = priorityConfig[priority] || priorityConfig.high;
    let allProducts = [];

    // Fetch paralelo según configuración
    const responses = await Promise.allSettled(
      config.filters.map(filter => 
        fetch(`https://api.kinguin.net/v1/products?${filter}`, {
          headers: { 'X-Api-Key': process.env.KINGUIN_API_KEY }
        })
      )
    );

    for (const response of responses) {
      if (response.status === 'fulfilled' && response.value.ok) {
        const data = await response.value.json();
        allProducts = allProducts.concat(data.results || []);
      }
    }

    // Eliminar duplicados y limitar
    const uniqueProducts = allProducts
      .filter((product, index, self) => 
        index === self.findIndex(p => p.kinguinId === product.kinguinId)
      )
      .slice(0, parseInt(limit));

    console.log(`🎯 Procesando ${uniqueProducts.length} productos únicos (${priority})`);

    let totalUpdated = 0, totalCreated = 0, totalSkipped = 0, totalErrors = 0;
    const baseUrl = process.env.VERCEL_URL || 'https://kinguin-ml-reseller.vercel.app';

    // Procesamiento optimizado por chunks
    for (let i = 0; i < uniqueProducts.length; i += config.chunkSize) {
      const chunk = uniqueProducts.slice(i, i + config.chunkSize);
      
      const promises = chunk.map(async (product) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), config.timeout);
          
          const addResponse = await fetch(`${baseUrl}/api/add-product`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              productId: product.kinguinId,
              priority,
              turbo: priority === 'ultra'
            }),
            signal: controller.signal
          });

          clearTimeout(timeoutId);
          const result = await addResponse.json();
          
          if (addResponse.ok) {
            if (result.action === 'created') return 'created';
            else if (result.action === 'updated') return 'updated';
            else return 'skipped';
          } else {
            return 'error';
          }
        } catch (error) {
          return 'error';
        }
      });

      const results = await Promise.allSettled(promises);
      
      results.forEach(result => {
        if (result.status === 'fulfilled') {
          switch (result.value) {
            case 'created': totalCreated++; break;
            case 'updated': totalUpdated++; break;
            case 'skipped': totalSkipped++; break;
            case 'error': totalErrors++; break;
          }
        } else {
          totalErrors++;
        }
      });

      // Pausa adaptativa
      if (priority !== 'ultra' && totalErrors > chunk.length * 0.2) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const executionTime = Math.round((Date.now() - startTime) / 1000);
    const throughput = Math.round(uniqueProducts.length / executionTime);

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
          priority_level: priority,
          filters_used: config.filters.length,
          chunk_size: config.chunkSize,
          timeout_ms: config.timeout,
          throughput_per_second: throughput,
          unique_products: uniqueProducts.length
        }
      });
    } catch (dbError) {
      console.error('📊 Error guardando estadísticas:', dbError.message);
    }

    console.log(`🎯 Prioridad ${priority}: ${totalUpdated}↗️ ${totalCreated}✨ ${totalSkipped}⏭️ ${totalErrors}❌ (${executionTime}s @ ${throughput}/s)`);

    res.status(200).json({
      success: true,
      type: 'priority_sync',
      priority,
      processed: uniqueProducts.length,
      updated: totalUpdated,
      created: totalCreated,
      skipped: totalSkipped,
      errors: totalErrors,
      execution_time_seconds: executionTime,
      throughput_per_second: throughput
    });

  } catch (error) {
    console.error(`❌ Error en sync ${req.query.priority || 'high'}:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      priority: req.query.priority || 'high'
    });
  }
}