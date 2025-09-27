import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * API de Sincronización Incremental con Kinguin
 * Solo procesa productos que han cambiado desde la última sincronización
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Use POST.' });
  }

  const startTime = Date.now();
  
  try {
    console.log(`🔄 Iniciando sincronización incremental...`);

    // 1. Obtener timestamp de última sincronización
    const { data: lastSync } = await supabase
      .from('sync_history')
      .select('last_update')
      .in('sync_type', ['complete', 'incremental'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const updatedSince = lastSync?.last_update || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    console.log(`📅 Buscando productos actualizados desde: ${updatedSince}`);

    // 2. Obtener API key
    const KINGUIN_API_KEY = process.env.KINGUIN_API_KEY;
    if (!KINGUIN_API_KEY) {
      throw new Error('KINGUIN_API_KEY no configurada');
    }

    // 3. Consultar productos que cambiaron
    const response = await fetch(
      `https://gateway.kinguin.net/esa/api/v1/products?updatedSince=${encodeURIComponent(updatedSince)}`,
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
    const updatedProducts = data.results || [];
    
    console.log(`📊 Productos encontrados: ${updatedProducts.length}`);

    // 4. Registrar en historial
    const executionTimeSeconds = Math.round((Date.now() - startTime) / 1000);
    
    await supabase.from('sync_history').insert({
      sync_type: 'incremental',
      last_update: new Date().toISOString(),
      products_updated: updatedProducts.length,
      execution_time_seconds: executionTimeSeconds,
      metadata: { previous_sync: updatedSince }
    });

    return res.status(200).json({
      success: true,
      message: `Sincronización incremental completada`,
      stats: {
        products_found: updatedProducts.length,
        execution_time_seconds: executionTimeSeconds,
        previous_sync: updatedSince
      }
    });

  } catch (error) {
    const executionTimeSeconds = Math.round((Date.now() - startTime) / 1000);
    
    console.error(`💥 Error en sincronización incremental:`, error);

    return res.status(500).json({
      success: false,
      message: 'Error en sincronización incremental',
      error: error.message,
      execution_time_seconds: executionTimeSeconds
    });
  }
}