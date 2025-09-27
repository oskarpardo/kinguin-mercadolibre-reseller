import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Límite de registros para evitar sobrecarga
const MAX_LOG_ENTRIES = 100;

/**
 * API endpoint para obtener y registrar logs de actividad del sistema
 * Permite tanto consultar logs recientes como añadir nuevos logs
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Manejar preflight requests para CORS
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method === "GET") {
      // Obtener logs recientes con paginación opcional
      const { limit = 50, offset = 0, jobId } = req.query;

      let query = supabase
        .from("activity_logs")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(Math.min(parseInt(limit), MAX_LOG_ENTRIES))
        .range(parseInt(offset), parseInt(offset) + Math.min(parseInt(limit), MAX_LOG_ENTRIES) - 1);

      // Filtrar por jobId si se proporciona
      if (jobId) {
        query = query.eq("job_id", jobId);
      }

      const { data, error } = await query;

      if (error) throw error;

      return res.status(200).json({
        success: true,
        logs: data || []
      });
    } 
    else if (req.method === "POST") {
      // Registrar un nuevo log
      const { message, type = 'info', details = null, jobId = null } = req.body;

      if (!message) {
        return res.status(400).json({
          success: false,
          error: "Se requiere un mensaje para el log"
        });
      }

      const { data, error } = await supabase
        .from("activity_logs")
        .insert({
          message,
          type, // info, success, error, warning
          details,
          job_id: jobId,
          timestamp: new Date().toISOString()
        })
        .select();

      if (error) throw error;

      return res.status(201).json({
        success: true,
        log: data[0]
      });
    } 
    else {
      return res.status(405).json({
        success: false,
        error: "Método no permitido"
      });
    }
  } catch (err) {
    console.error("Error en API de logs:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}