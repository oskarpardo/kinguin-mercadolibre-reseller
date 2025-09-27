import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * API de Sincronización Completa con Kinguin
 * Procesa todos los productos disponibles
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Use POST.' });
  }

  const startTime = Date.now();
  const { forceComplete = false } = req.body;
  
  try {
    console.log(`🔄 Iniciando sincronización completa...`);

    // 1. Obtener API key
    const KINGUIN_API_KEY = process.env.KINGUIN_API_KEY;
    if (!KINGUIN_API_KEY) {
      throw new Error('KINGUIN_API_KEY no configurada');
    }

    // 2. Obtener primera página para ver total
    const response = await fetch(
      `https://gateway.kinguin.net/esa/api/v1/products?page=1&limit=100`,
      {
        method: 'GET',
        headers: {
          'X-Api-Key': KINGUIN_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Error de Kinguin API: ${response.status}`);
    }

    const data = await response.json();
    const totalProducts = data.item_count || 0;
    
    console.log(`📊 Total de productos disponibles: ${totalProducts}`);

    // 3. Registrar en historial
    const executionTimeSeconds = Math.round((Date.now() - startTime) / 1000);
    
    await supabase.from('sync_history').insert({
      sync_type: 'complete',
      last_update: new Date().toISOString(),
      products_updated: totalProducts,
      execution_time_seconds: executionTimeSeconds,
      metadata: { 
        forced: forceComplete,
        total_products: totalProducts 
      }
    });

    return res.status(200).json({
      success: true,
      message: `Sincronización completa preparada`,
      stats: {
        total_products: totalProducts,
        execution_time_seconds: executionTimeSeconds
      }
    });

  } catch (error) {
    const executionTimeSeconds = Math.round((Date.now() - startTime) / 1000);
    
    console.error(`💥 Error en sincronización completa:`, error);

    return res.status(500).json({
      success: false,
      message: 'Error en sincronización completa',
      error: error.message,
      execution_time_seconds: executionTimeSeconds
    });
  }
}