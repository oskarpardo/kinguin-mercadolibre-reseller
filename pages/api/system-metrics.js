import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * API para obtener estadísticas y métricas del sistema
 * Proporciona datos para el panel de monitoreo
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Método no permitido, usa GET"
    });
  }

  try {
    // Obtener trabajos recientes
    const { data: recentJobs, error: recentJobsError } = await supabase
      .from("job_logs")
      .select("id, status, summary, total_products, created_at, finished_at")
      .order("created_at", { ascending: false })
      .limit(5);

    if (recentJobsError) throw recentJobsError;

    // Obtener estadísticas de productos publicados
    const { data: productsStats, error: productsStatsError } = await supabase
      .rpc("get_products_stats"); // Asumiendo una función RPC que devuelve estadísticas

    // Fallback si no existe la función RPC
    let productMetrics = { total: 0, today: 0, this_week: 0, this_month: 0 };
    
    if (productsStatsError) {
      console.warn("Error al obtener estadísticas de productos:", productsStatsError);
      
      // Como alternativa, obtenemos conteos básicos
      const { count: totalCount } = await supabase
        .from("published_products")
        .select("*", { count: "exact", head: true });
        
      // Fecha de hoy (inicio del día)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const { count: todayCount } = await supabase
        .from("published_products")
        .select("*", { count: "exact", head: true })
        .gte("created_at", today.toISOString());
        
      productMetrics = {
        total: totalCount || 0,
        today: todayCount || 0,
        this_week: 0, // Podríamos calcular esto con más queries
        this_month: 0 // Podríamos calcular esto con más queries
      };
    } else {
      productMetrics = productsStats || productMetrics;
    }

    // Obtener trabajos activos con detección de trabajos "colgados"
    const { data: potentialActiveJobs, error: activeJobsError } = await supabase
      .from("job_logs")
      .select("id, status, summary, total_products, created_at, results")
      .eq("status", "running")
      .order("created_at", { ascending: false });

    if (activeJobsError) throw activeJobsError;
    
    // Filtrar trabajos "colgados" (más de 30 minutos sin cambios)
    const MAX_JOB_RUNTIME_MS = 30 * 60 * 1000; // 30 minutos
    const now = new Date();
    
    // Solo consideramos activos los trabajos que estén en ejecución menos de 30 minutos
    const activeJobs = potentialActiveJobs?.filter(job => {
      const createdAt = new Date(job.created_at);
      const elapsedMs = now - createdAt;
      return elapsedMs < MAX_JOB_RUNTIME_MS;
    }) || [];
    
    // Actualizar automáticamente los trabajos que se detectan como "colgados"
    const stalledJobs = potentialActiveJobs?.filter(job => {
      const createdAt = new Date(job.created_at);
      const elapsedMs = now - createdAt;
      return elapsedMs >= MAX_JOB_RUNTIME_MS;
    }) || [];
    
    // Marcar los trabajos estancados como fallidos
    for (const job of stalledJobs) {
      await supabase
        .from("job_logs")
        .update({ 
          status: "failed", 
          summary: { 
            ...job.summary,
            error: "Trabajo interrumpido o estancado (timeout automático)"
          },
          finished_at: new Date().toISOString()
        })
        .eq("id", job.id);
        
      console.log(`Marcado trabajo ${job.id} como fallido por inactividad`);
    }

    // Obtener métricas de sistema si es posible (espacio en disco, etc.)
    // Esto normalmente requiere una función RPC personalizada o endpoint adicional

    return res.status(200).json({
      success: true,
      metrics: {
        products: productMetrics,
        jobs: {
          active: activeJobs?.length || 0,
          recent: recentJobs || []
        },
        system: {
          // Métricas del sistema podrían venir de otro endpoint
          status: "online",
          lastUpdate: new Date().toISOString()
        }
      }
    });
  } catch (err) {
    console.error("Error al obtener métricas:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}