// API optimizada para sincronización ultra rápida con paralelización masiva

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET method allowed' });
  }

  try {
    console.log('⚡ Iniciando TURBO sync...');
    const startTime = Date.now();

    const { 
      page = 1, 
      limit = 2000,
      priority = 'turbo',
      parallel = 'true'
    } = req.query;

    // URLs múltiples para máxima velocidad
    const kinguinEndpoints = [
      `https://api.kinguin.net/v1/products?limit=${limit}&page=${page}&sortBy=popularity&order=desc`,
      `https://api.kinguin.net/v1/products?limit=${Math.floor(limit/2)}&page=${page}&sortBy=releaseDate&order=desc`,
      `https://api.kinguin.net/v1/products?limit=${Math.floor(limit/4)}&page=${page}&activePreorder=true`
    ];

    // Fetch paralelo de múltiples endpoints
    const responses = await Promise.allSettled(
      kinguinEndpoints.map(url => 
        fetch(url, {
          headers: { 'X-Api-Key': process.env.KINGUIN_API_KEY }
        })
      )
    );

    let allProducts = [];
    for (const response of responses) {
      if (response.status === 'fulfilled' && response.value.ok) {
        const data = await response.value.json();
        allProducts = allProducts.concat(data.results || []);
      }
    }

    // Eliminar duplicados por kinguinId
    const uniqueProducts = allProducts.filter((product, index, self) => 
      index === self.findIndex(p => p.kinguinId === product.kinguinId)
    );

    console.log(`🚀 TURBO: Procesando ${uniqueProducts.length} productos únicos`);

    let updated = 0, created = 0, skipped = 0, errors = 0;

    // Procesamiento ULTRA paralelo en chunks de 100
    const ultraChunkSize = 100;
    const baseUrl = process.env.VERCEL_URL || 'https://kinguin-ml-reseller.vercel.app';
    
    for (let i = 0; i < uniqueProducts.length; i += ultraChunkSize) {
      const ultraChunk = uniqueProducts.slice(i, i + ultraChunkSize);
      
      // Máxima paralelización
      const ultraPromises = ultraChunk.map(async (product) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
          
          const addResponse = await fetch(`${baseUrl}/api/add-product`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              productId: product.kinguinId,
              priority: 'turbo',
              skipCache: priority === 'ultra'
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
            console.error(`⚡ Error ${product.kinguinId}:`, result.message?.slice(0, 100));
            return 'error';
          }
        } catch (error) {
          if (error.name === 'AbortError') {
            console.error(`⏱️ Timeout ${product.kinguinId}`);
          }
          return 'error';
        }
      });

      const results = await Promise.allSettled(ultraPromises);
      
      results.forEach(result => {
        if (result.status === 'fulfilled') {
          switch (result.value) {
            case 'created': created++; break;
            case 'updated': updated++; break;
            case 'skipped': skipped++; break;
            case 'error': errors++; break;
          }
        } else {
          errors++;
        }
      });

      // Mini pausa solo si hay muchos errores
      if (errors > ultraChunk.length * 0.1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    const executionTime = Math.round((Date.now() - startTime) / 1000);

    // Guardar estadísticas
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      
      await supabase.from('sync_history').insert({
        sync_type: 'turbo',
        last_update: new Date().toISOString(),
        products_updated: updated,
        products_created: created,
        products_skipped: skipped,
        products_error: errors,
        execution_time_seconds: executionTime,
        metadata: {
          page: parseInt(page),
          limit: parseInt(limit),
          priority,
          unique_products: uniqueProducts.length,
          total_sources: kinguinEndpoints.length,
          throughput_per_second: Math.round(uniqueProducts.length / executionTime)
        }
      });
    } catch (dbError) {
      console.error('📊 Error guardando stats:', dbError.message);
    }

    console.log(`⚡ TURBO completado: ${updated}↗️ ${created}✨ ${skipped}⏭️ ${errors}❌ (${executionTime}s @ ${Math.round(uniqueProducts.length/executionTime)}/s)`);

    res.status(200).json({
      success: true,
      mode: 'turbo',
      page: parseInt(page),
      processed: uniqueProducts.length,
      updated, created, skipped, errors,
      execution_time_seconds: executionTime,
      throughput_per_second: Math.round(uniqueProducts.length / executionTime),
      next_page: uniqueProducts.length >= parseInt(limit) ? parseInt(page) + 1 : null
    });

  } catch (error) {
    console.error('⚡ TURBO Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      mode: 'turbo'
    });
  }
}