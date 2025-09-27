import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  // Verificar método HTTP
  if (req.method === 'GET') {
    return await getConfig(req, res);
  } else if (req.method === 'POST') {
    return await updateConfig(req, res);
  } else if (req.method === 'DELETE') {
    return await resetConfig(req, res);
  }
  
  return res.status(405).json({ success: false, error: 'Método no permitido' });
}

// Obtener la configuración actual de los cronjobs
async function getConfig(req, res) {
  try {
    // Obtener la configuración actual
    const { data, error } = await supabase
      .from('cron_config')
      .select('*')
      .order('id', { ascending: false })
      .limit(1);
      
    if (error) throw error;
    
    // Si no hay configuración, devolver valores por defecto
    if (!data || data.length === 0) {
      const defaultConfig = {
        update_stock_schedule: '0 */12 * * *',
        update_all_schedule: '0 3 * * *',
        exchange_rate_schedule: '0 */6 * * *',
        active: true,
        description: 'Configuración por defecto'
      };
      
      return res.status(200).json({
        success: true,
        config: defaultConfig,
        isDefault: true
      });
    }
    
    // Obtener estadísticas de ejecuciones
    const { data: statsData, error: statsError } = await supabase
      .from('cron_execution_stats')
      .select('*');
      
    if (statsError) {
      console.warn('Error al obtener estadísticas de cronjobs:', statsError);
    }
    
    // Obtener últimas ejecuciones
    const { data: recentExecutions, error: recentError } = await supabase
      .from('cron_execution_history')
      .select('*')
      .order('start_time', { ascending: false })
      .limit(10);
      
    if (recentError) {
      console.warn('Error al obtener historial de ejecuciones:', recentError);
    }
    
    return res.status(200).json({
      success: true,
      config: data[0],
      stats: statsData || [],
      recentExecutions: recentExecutions || [],
      isDefault: false
    });
  } catch (error) {
    console.error('Error al obtener configuración de cronjobs:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Error al obtener configuración de cronjobs'
    });
  }
}

// Actualizar la configuración de los cronjobs
async function updateConfig(req, res) {
  try {
    const {
      updateStockSchedule,
      updateAllSchedule,
      exchangeRateSchedule,
      active,
      description
    } = req.body;
    
    // Validar que se enviaron todos los campos necesarios
    if (!updateStockSchedule || !updateAllSchedule || !exchangeRateSchedule || active === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Faltan campos requeridos'
      });
    }
    
    // Validar el formato cron de los horarios
    const cronRegex = /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/;
    
    if (!cronRegex.test(updateStockSchedule) || !cronRegex.test(updateAllSchedule) || !cronRegex.test(exchangeRateSchedule)) {
      return res.status(400).json({
        success: false,
        error: 'Formato de horario cron inválido'
      });
    }
    
    // Actualizar la configuración
    const { data, error } = await supabase
      .from('cron_config')
      .insert({
        update_stock_schedule: updateStockSchedule,
        update_all_schedule: updateAllSchedule,
        exchange_rate_schedule: exchangeRateSchedule,
        active,
        last_modified_by: req.body.userName || 'system',
        description: description || 'Actualización manual'
      })
      .select();
      
    if (error) throw error;
    
    // Registrar la actividad
    await supabase.from('activity_logs').insert({
      message: `Configuración de cronjobs actualizada. Estado: ${active ? 'Activado' : 'Desactivado'}`,
      type: 'info',
      source: 'api'
    });
    
    return res.status(200).json({
      success: true,
      config: data[0],
      message: 'Configuración actualizada correctamente'
    });
  } catch (error) {
    console.error('Error al actualizar configuración de cronjobs:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Error al actualizar configuración de cronjobs'
    });
  }
}

// Restablecer configuración por defecto
async function resetConfig(req, res) {
  try {
    // Configuración por defecto
    const defaultConfig = {
      update_stock_schedule: '0 */12 * * *',
      update_all_schedule: '0 3 * * *',
      exchange_rate_schedule: '0 */6 * * *',
      active: true,
      last_modified_by: req.body.userName || 'system',
      description: 'Restablecido a valores por defecto'
    };
    
    // Insertar configuración por defecto
    const { data, error } = await supabase
      .from('cron_config')
      .insert(defaultConfig)
      .select();
      
    if (error) throw error;
    
    // Registrar la actividad
    await supabase.from('activity_logs').insert({
      message: 'Configuración de cronjobs restablecida a valores por defecto',
      type: 'info',
      source: 'api'
    });
    
    return res.status(200).json({
      success: true,
      config: data[0],
      message: 'Configuración restablecida a valores por defecto'
    });
  } catch (error) {
    console.error('Error al restablecer configuración de cronjobs:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Error al restablecer configuración de cronjobs'
    });
  }
}