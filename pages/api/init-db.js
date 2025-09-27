import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * API endpoint para inicializar tablas necesarias en Supabase
 * Este endpoint crea las tablas job_logs y activity_logs si no existen
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
    // Verificar si el usuario tiene una clave de autorización
    const { authorization } = req.headers;
    const expectedAuth = process.env.API_SECRET_KEY || "oskar123"; // Fallback a "oskar123" si no está configurado
    
    if (!authorization || authorization !== `Bearer ${expectedAuth}`) {
      return res.status(401).json({
        success: false,
        error: "No autorizado"
      });
    }

    // Crear la tabla job_logs si no existe
    await supabase.rpc('create_tables_if_not_exist');

    // Verificar si la creación fue exitosa intentando seleccionar datos
    const { error: jobLogsError } = await supabase
      .from("job_logs")
      .select("id")
      .limit(1);

    const { error: activityLogsError } = await supabase
      .from("activity_logs")
      .select("id")
      .limit(1);

    if (jobLogsError || activityLogsError) {
      // Si hay un error, intentamos crear las tablas manualmente
      await createTablesManually();
      
      // Verificar nuevamente
      const { error: finalJobsError } = await supabase
        .from("job_logs")
        .select("id")
        .limit(1);
        
      const { error: finalActivityError } = await supabase
        .from("activity_logs")
        .select("id")
        .limit(1);
        
      if (finalJobsError || finalActivityError) {
        throw new Error(`Error al verificar tablas: ${finalJobsError?.message || finalActivityError?.message}`);
      }
    }

    // Insertar un log de prueba en activity_logs
    const { error: insertError } = await supabase
      .from("activity_logs")
      .insert({
        message: "Tablas inicializadas correctamente",
        type: "success",
        timestamp: new Date().toISOString()
      });

    if (insertError) {
      throw new Error(`Error al insertar log de prueba: ${insertError.message}`);
    }

    return res.status(200).json({
      success: true,
      message: "Tablas creadas o verificadas correctamente"
    });
  } catch (err) {
    console.error("Error al inicializar tablas:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

/**
 * Función para crear manualmente las tablas si el RPC no está disponible
 */
async function createTablesManually() {
  // Crear tabla job_logs
  await supabase.rpc('execute_sql', {
    sql_query: `
      CREATE TABLE IF NOT EXISTS job_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status TEXT CHECK (status IN ('running', 'completed', 'failed')) NOT NULL DEFAULT 'running',
        total_products INTEGER NOT NULL DEFAULT 0,
        summary JSONB,
        details JSONB,
        results JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ
      );
    `
  });

  // Crear tabla activity_logs
  await supabase.rpc('execute_sql', {
    sql_query: `
      CREATE TABLE IF NOT EXISTS activity_logs (
        id BIGSERIAL PRIMARY KEY,
        message TEXT NOT NULL,
        type TEXT CHECK (type IN ('info', 'success', 'warning', 'error')) NOT NULL DEFAULT 'info',
        details JSONB,
        job_id UUID REFERENCES job_logs(id) ON DELETE SET NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      
      -- Crear índices para mejorar el rendimiento de las consultas
      CREATE INDEX IF NOT EXISTS activity_logs_job_id_idx ON activity_logs(job_id);
      CREATE INDEX IF NOT EXISTS activity_logs_timestamp_idx ON activity_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS activity_logs_type_idx ON activity_logs(type);
    `
  });

  // Crear función para estadísticas de productos
  await supabase.rpc('execute_sql', {
    sql_query: `
      CREATE OR REPLACE FUNCTION get_products_stats()
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $$
      DECLARE
        total_count INTEGER;
        today_count INTEGER;
        week_count INTEGER;
        month_count INTEGER;
      BEGIN
        -- Total de productos
        SELECT COUNT(*) INTO total_count FROM published_products;
        
        -- Productos añadidos hoy
        SELECT COUNT(*) INTO today_count 
        FROM published_products 
        WHERE DATE(created_at) = CURRENT_DATE;
        
        -- Productos añadidos esta semana
        SELECT COUNT(*) INTO week_count 
        FROM published_products 
        WHERE created_at >= DATE_TRUNC('week', CURRENT_DATE);
        
        -- Productos añadidos este mes
        SELECT COUNT(*) INTO month_count 
        FROM published_products 
        WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE);
        
        -- Retornar las estadísticas como un objeto JSON
        RETURN jsonb_build_object(
          'total', total_count,
          'today', today_count,
          'this_week', week_count,
          'this_month', month_count
        );
      END;
      $$;
    `
  });
}