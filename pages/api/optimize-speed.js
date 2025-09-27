// pages/api/optimize-speed.js
// Endpoint para ajustar la velocidad de procesamiento

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Valores de configuración predeterminados
const DEFAULT_CONFIG = {
  concurrency: 15,          // Número máximo de productos procesados simultáneamente
  batch_interval_ms: 100,   // Intervalo entre solicitudes en un lote (ms)
  max_retries: 5,           // Número máximo de reintentos
  base_delay_ms: 500,       // Retraso base para el retroceso exponencial
  request_timeout_ms: 30000 // Tiempo de espera máximo para solicitudes HTTP
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  // Endpoint para obtener la configuración actual
  if (req.method === "GET") {
    try {
      // Obtener configuración de la base de datos
      const { data, error } = await supabase
        .from("system_config")
        .select("*")
        .eq("key", "processing_speed")
        .single();
        
      if (error) {
        console.warn("No se encontró configuración de velocidad, usando valores predeterminados");
        return res.status(200).json(DEFAULT_CONFIG);
      }
      
      // Fusionar con los valores predeterminados para asegurar que todos los campos están presentes
      const config = { ...DEFAULT_CONFIG, ...data.value };
      return res.status(200).json(config);
    } catch (err) {
      console.error("Error al obtener configuración:", err);
      return res.status(500).json({ 
        error: "Error al obtener configuración de velocidad", 
        details: err.message 
      });
    }
  }
  
  // Endpoint para actualizar la configuración
  if (req.method === "POST") {
    try {
      const { concurrency, batch_interval_ms, max_retries, base_delay_ms, request_timeout_ms } = req.body;
      
      // Validar los valores recibidos
      const newConfig = {
        concurrency: validateNumber(concurrency, 1, 30, DEFAULT_CONFIG.concurrency),
        batch_interval_ms: validateNumber(batch_interval_ms, 50, 1000, DEFAULT_CONFIG.batch_interval_ms),
        max_retries: validateNumber(max_retries, 1, 10, DEFAULT_CONFIG.max_retries),
        base_delay_ms: validateNumber(base_delay_ms, 100, 2000, DEFAULT_CONFIG.base_delay_ms),
        request_timeout_ms: validateNumber(request_timeout_ms, 5000, 60000, DEFAULT_CONFIG.request_timeout_ms)
      };
      
      // Guardar la configuración en la base de datos
      const { data, error } = await supabase
        .from("system_config")
        .upsert({
          key: "processing_speed",
          value: newConfig,
          updated_at: new Date().toISOString()
        }, { onConflict: "key" });
        
      if (error) {
        throw new Error(`Error al guardar configuración: ${error.message}`);
      }
      
      return res.status(200).json({ 
        message: "Configuración de velocidad actualizada correctamente", 
        config: newConfig 
      });
    } catch (err) {
      console.error("Error al actualizar configuración:", err);
      return res.status(500).json({ 
        error: "Error al actualizar configuración de velocidad", 
        details: err.message 
      });
    }
  }
  
  return res.status(405).json({ error: "Método no permitido" });
}

// Función auxiliar para validar números dentro de un rango
function validateNumber(value, min, max, defaultValue) {
  const num = Number(value);
  if (isNaN(num) || num < min || num > max) {
    return defaultValue;
  }
  return num;
}