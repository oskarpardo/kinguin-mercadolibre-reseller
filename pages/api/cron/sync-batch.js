// API para sincronización por lotes optimizada para cron jobs externos
// Maneja 5000 productos por llamada para maximizar eficiencia

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET method allowed' });
  }

  try {
    console.log('🔄 Iniciando sync por lotes...');
    const startTime = Date.now();

    // Obtener parámetros
    const { 
      page = 1, 
      limit = 5000,  // 5000 productos por batch
      priority = 'medium' 
    } = req.query;

    const response = await fetch(`https://api.kinguin.net/v1/products?limit=${limit}&page=${page}`, {
      headers: {
        'X-Api-Key': process.env.KINGUIN_API_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`Kinguin API error: ${response.status}`);
    }

    const data = await response.json();
    const products = data.results || [];
    
    console.log(`📦 Procesando ${products.length} productos (página ${page})`);

    let updated = 0;
    let created = 0;
    let skipped = 0;
    let errors = 0;

    // Procesar productos en chunks más pequeños para evitar timeouts
    const chunkSize = 50;
    for (let i = 0; i < products.length; i += chunkSize) {
      const chunk = products.slice(i, i + chunkSize);
      
      const promises = chunk.map(async (product) => {
        try {
          // Llamar al endpoint add-product existente
          const addResponse = await fetch(`${process.env.VERCEL_URL || 'https://kinguin-ml-reseller.vercel.app'}/api/add-product`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: product.kinguinId })
          });

          const result = await addResponse.json();
          
          if (addResponse.ok) {
            if (result.action === 'created') created++;
            else if (result.action === 'updated') updated++;
            else skipped++;
          } else {
            errors++;
            console.error(`❌ Error producto ${product.kinguinId}:`, result.message);
          }
        } catch (error) {
          errors++;
          console.error(`❌ Error procesando ${product.kinguinId}:`, error.message);
        }
      });

      await Promise.allSettled(promises);
      
      // Pausa pequeña entre chunks para evitar rate limits
      if (i + chunkSize < products.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const executionTime = Math.round((Date.now() - startTime) / 1000);

    // Guardar estadísticas en Supabase
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      
      await supabase.from('sync_history').insert({
        sync_type: 'batch',
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
          total_processed: products.length
        }
      });
    } catch (dbError) {
      console.error('Error guardando en DB:', dbError.message);
    }

    console.log(`✅ Batch completado: ${updated} actualizados, ${created} creados, ${skipped} omitidos, ${errors} errores (${executionTime}s)`);

    res.status(200).json({
      success: true,
      page: parseInt(page),
      processed: products.length,
      updated,
      created,
      skipped,
      errors,
      execution_time_seconds: executionTime,
      next_page: products.length === parseInt(limit) ? parseInt(page) + 1 : null
    });

  } catch (error) {
    console.error('❌ Error en sync batch:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}