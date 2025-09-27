import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

  try {
    const { kinguinId, mlId, days = 30 } = req.query;
    
    if (!kinguinId && !mlId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Se requiere kinguinId o mlId para obtener el historial' 
      });
    }
    
    // Calculamos la fecha límite (hace X días)
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - parseInt(days, 10));
    
    // Consultar historial desde la base de datos
    let query = supabase
      .from('price_history')
      .select('*')
      .gte('recorded_at', limitDate.toISOString());
      
    // Filtrar por kinguinId o mlId según lo proporcionado
    if (kinguinId) {
      query = query.eq('kinguin_id', kinguinId);
    }
    
    if (mlId) {
      query = query.eq('ml_id', mlId);
    }
    
    // Ordenar por fecha descendente para tener los cambios más recientes primero
    query = query.order('recorded_at', { ascending: false });
    
    const { data: history, error: historyError } = await query;
    
    if (historyError) {
      console.error('Error al consultar el historial de precios:', historyError);
      return res.status(500).json({
        success: false,
        error: 'Error al consultar el historial de precios'
      });
    }
    
    // Calcular estadísticas del historial
    let stats = null;
    
    if (history && history.length > 0) {
      // Calcular estadísticas mediante una función en la base de datos
      const { data: statsData, error: statsError } = await supabase
        .rpc('get_price_change_stats', { 
          product_id: kinguinId || null,
          ml_product_id: mlId || null,
          days_limit: parseInt(days, 10)
        });
        
      if (!statsError && statsData) {
        stats = statsData;
      } else {
        console.warn('Error al calcular estadísticas de precios:', statsError);
        
        // Calculamos estadísticas básicas en el backend como respaldo
        const changes = history.map(record => record.change_percentage).filter(Boolean);
        
        if (changes.length > 0) {
          const avgChange = changes.reduce((sum, val) => sum + val, 0) / changes.length;
          const increases = changes.filter(val => val > 0);
          const decreases = changes.filter(val => val < 0);
          
          stats = {
            changeCount: changes.length,
            avgChange: avgChange,
            maxIncrease: increases.length > 0 ? Math.max(...increases) : 0,
            maxDecrease: decreases.length > 0 ? Math.min(...decreases) : 0
          };
        }
      }
    }
    
    return res.status(200).json({
      success: true,
      history,
      stats
    });
  } catch (error) {
    console.error('Error en el endpoint de historial de precios:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
}