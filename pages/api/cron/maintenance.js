// API para mantenimiento: limpiar productos discontinuados y procesar webhooks pendientes

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET method allowed' });
  }

  try {
    console.log('🧹 Iniciando mantenimiento del sistema...');
    const startTime = Date.now();

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    let webhooksProcessed = 0;
    let productsRemoved = 0;
    let cacheCleared = 0;

    // 1. Procesar webhooks pendientes
    try {
      const { data: pendingWebhooks } = await supabase
        .from('webhook_queue')
        .select('*')
        .eq('processed', false)
        .limit(100);

      if (pendingWebhooks && pendingWebhooks.length > 0) {
        console.log(`📥 Procesando ${pendingWebhooks.length} webhooks pendientes`);

        for (const webhook of pendingWebhooks) {
          try {
            // Procesar cada webhook
            const response = await fetch(`${process.env.VERCEL_URL || 'https://kinguin-ml-reseller.vercel.app'}/api/add-product`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ productId: webhook.kinguin_id })
            });

            if (response.ok) {
              await supabase
                .from('webhook_queue')
                .update({ 
                  processed: true, 
                  processed_at: new Date().toISOString() 
                })
                .eq('id', webhook.id);
              
              webhooksProcessed++;
            } else {
              // Incrementar retry count
              await supabase
                .from('webhook_queue')
                .update({ retry_count: webhook.retry_count + 1 })
                .eq('id', webhook.id);
            }
          } catch (error) {
            console.error(`Error procesando webhook ${webhook.id}:`, error.message);
          }
        }
      }
    } catch (webhookError) {
      console.error('Error procesando webhooks:', webhookError.message);
    }

    // 2. Limpiar webhooks muy antiguos (más de 7 días)
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      await supabase
        .from('webhook_queue')
        .delete()
        .lt('created_at', sevenDaysAgo.toISOString());
    } catch (cleanupError) {
      console.error('Error limpiando webhooks antiguos:', cleanupError.message);
    }

    // 3. Limpiar historial de sync muy antiguo (más de 30 días)
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { count } = await supabase
        .from('sync_history')
        .delete()
        .lt('created_at', thirtyDaysAgo.toISOString());
      
      console.log(`🗑️ Limpiados ${count || 0} registros antiguos de sync_history`);
    } catch (historyError) {
      console.error('Error limpiando historial:', historyError.message);
    }

    // 4. Verificar productos discontinuados (sample de 500 productos aleatorios)
    try {
      const response = await fetch('https://api.kinguin.net/v1/products?limit=500&sortBy=random', {
        headers: {
          'X-Api-Key': process.env.KINGUIN_API_KEY
        }
      });

      if (response.ok) {
        const data = await response.json();
        const activeProducts = data.results || [];
        
        // Aquí podrías comparar con tus productos en MercadoLibre
        // y pausar/eliminar los que ya no existen en Kinguin
        console.log(`🔍 Verificados ${activeProducts.length} productos activos en Kinguin`);
      }
    } catch (verifyError) {
      console.error('Error verificando productos activos:', verifyError.message);
    }

    const executionTime = Math.round((Date.now() - startTime) / 1000);

    // Guardar estadísticas de mantenimiento
    await supabase.from('sync_history').insert({
      sync_type: 'maintenance',
      last_update: new Date().toISOString(),
      products_updated: 0,
      products_created: 0,
      products_skipped: 0,
      products_error: 0,
      execution_time_seconds: executionTime,
      metadata: {
        webhooks_processed: webhooksProcessed,
        products_removed: productsRemoved,
        cache_cleared: cacheCleared
      }
    });

    console.log(`🧹 Mantenimiento completado: ${webhooksProcessed} webhooks procesados (${executionTime}s)`);

    res.status(200).json({
      success: true,
      type: 'maintenance',
      webhooks_processed: webhooksProcessed,
      products_removed: productsRemoved,
      cache_cleared: cacheCleared,
      execution_time_seconds: executionTime
    });

  } catch (error) {
    console.error('❌ Error en mantenimiento:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}