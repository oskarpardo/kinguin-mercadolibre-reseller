import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Endpoint para limpiar trabajos estancados (colgados)
 * Un trabajo se considera estancado si lleva más de 30 minutos en estado "running"
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método no permitido, usa POST"
    });
  }

  try {
    // Obtener todos los trabajos en estado "running"
    const { data: runningJobs, error } = await supabase
      .from("job_logs")
      .select("id, status, created_at, summary")
      .eq("status", "running");

    if (error) {
      throw new Error(`Error al consultar trabajos: ${error.message}`);
    }

    // Considerar como estancados los trabajos que llevan más de 30 minutos en ejecución
    const MAX_JOB_RUNTIME_MS = 30 * 60 * 1000; // 30 minutos
    const now = new Date();
    
    const stalledJobs = runningJobs.filter(job => {
      const createdAt = new Date(job.created_at);
      const elapsedMs = now - createdAt;
      return elapsedMs >= MAX_JOB_RUNTIME_MS;
    });

    // Actualizar todos los trabajos estancados a estado "failed"
    const updates = [];
    for (const job of stalledJobs) {
      const { error: updateError } = await supabase
        .from("job_logs")
        .update({ 
          status: "failed", 
          summary: { 
            ...job.summary,
            error: "Trabajo interrumpido o estancado (limpieza manual)"
          },
          finished_at: new Date().toISOString()
        })
        .eq("id", job.id);
        
      if (updateError) {
        console.error(`Error al actualizar trabajo ${job.id}:`, updateError);
      } else {
        updates.push(job.id);
      }
    }

    // Responder con el número de trabajos actualizados
    return res.status(200).json({
      success: true,
      message: `Se han limpiado ${stalledJobs.length} trabajos estancados`,
      cleaned: updates
    });
  } catch (err) {
    console.error("Error al limpiar trabajos estancados:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}