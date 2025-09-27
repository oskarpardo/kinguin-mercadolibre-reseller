import { createClient } from '@supabase/supabase-js';
import { logActivity } from './_logic';

export default async function handler(req, res) {
  try {
    // Inicializar cliente Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Obtener registros de crons externos
    const { data: cronLogs, error } = await supabase
      .from('external_cron_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      throw new Error(`Error al obtener registros de crons: ${error.message}`);
    }

    // Obtener estadísticas agregadas
    const { data: cronStats, error: statsError } = await supabase
      .from('external_cron_stats')
      .select('*')
      .order('category', { ascending: true });

    if (statsError) {
      console.warn(`Error al obtener estadísticas de crons: ${statsError.message}`);
    }

    // Registrar actividad
    await logActivity('Consulta al historial de crons externos', 'info');

    // Devolver datos
    return res.status(200).json({
      success: true,
      logs: cronLogs,
      stats: cronStats || [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error en API de historial de crons:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}