// Controlador especializado para manejar reenvío de actualizaciones de precio con tokens renovados
// Este archivo maneja específicamente el caso en que un token expire durante la actualización

import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { 
  logActivity, 
  getEuroToClp 
} from "./_logic";
import { axiosWithSmartRetry } from "./_http-utils";
import { analyzeMercadoLibreError } from "./_ml-error-handler";

// ---------- Supabase ----------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Reintenta una actualización de precio después de refrescar el token
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido, usa POST" });
  }

  const { ml_id, eurPrice, retryAfterRefresh, jobId } = req.body;

  if (!ml_id) {
    return res.status(400).json({ error: "Falta el ID de MercadoLibre (ml_id)" });
  }

  if (typeof eurPrice !== 'number' || eurPrice <= 0) {
    return res.status(400).json({ error: "Precio en EUR inválido" });
  }

  try {
    // Paso 1: Obtener un nuevo token si se solicita el refresco
    let ML_ACCESS_TOKEN;
    
    if (retryAfterRefresh) {
      // Llamar al endpoint interno para refrescar el token
      let refreshUrl;
      if (process.env.VERCEL_URL) {
        refreshUrl = `https://${process.env.VERCEL_URL}/api/refresh-token`;
      } else {
        refreshUrl = 'http://localhost:3000/api/refresh-token';
      }
      
      await logActivity("Refrescando token de MercadoLibre...", "info", null, jobId);
      
      const refreshResponse = await axios.post(refreshUrl);
      
      if (!refreshResponse.data.success) {
        return res.status(500).json({
          error: "Error al refrescar el token",
          details: refreshResponse.data
        });
      }
      
      await logActivity("Token de MercadoLibre refrescado con éxito", "success", null, jobId);
      
      // Obtener el nuevo token desde Supabase (ya que el refresh lo guarda allí)
      const { data: tokenData } = await supabase
        .from("tokens")
        .select("value")
        .eq("key", "ML_ACCESS_TOKEN")
        .single();
      
      ML_ACCESS_TOKEN = tokenData?.value || process.env.ML_ACCESS_TOKEN;
    } else {
      // Usar directamente el token de Supabase
      const { data: tokenData } = await supabase
        .from("tokens")
        .select("value")
        .eq("key", "ML_ACCESS_TOKEN")
        .single();
      
      ML_ACCESS_TOKEN = tokenData?.value || process.env.ML_ACCESS_TOKEN;
    }
    
    if (!ML_ACCESS_TOKEN) {
      return res.status(500).json({ 
        error: "No se pudo obtener el token de MercadoLibre" 
      });
    }
    
    // Paso 2: Calcular el precio en CLP
    const { priceCLP, FX_EUR_CLP, source } = await getEuroToClp(eurPrice);
    
    if (!priceCLP || !FX_EUR_CLP) {
      return res.status(500).json({ 
        error: "Error al calcular el precio en CLP",
        details: { eurPrice, FX_EUR_CLP }
      });
    }
    
    await logActivity(`Precio calculado: ${priceCLP} CLP (${eurPrice} EUR, FX: ${FX_EUR_CLP} [${source}])`, "info", null, jobId);
    
    // Paso 3: Actualizar el precio en MercadoLibre
    try {
      await axiosWithSmartRetry(
        `https://api.mercadolibre.com/items/${ml_id}`,
        { price: priceCLP },
        {
          method: 'put',
          headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` },
          retries: 3
        }
      );
      
      await logActivity(`Precio actualizado con éxito en ML: ${ml_id}`, "success", {
        ml_id,
        price: priceCLP,
        eurPrice
      }, jobId);
      
      // Paso 4: Actualizar también en la base de datos
      await supabase
        .from("published_products")
        .update({
          price: priceCLP,
          euro_price: eurPrice,
          updated_at: new Date().toISOString()
        })
        .eq("ml_id", ml_id);
      
      return res.status(200).json({
        success: true,
        message: "Precio actualizado con éxito después de refrescar token",
        ml_id,
        price: priceCLP,
        eurPrice,
        fx_rate: FX_EUR_CLP
      });
      
    } catch (error) {
      // Analizar el error de ML para dar información detallada
      const errorAnalysis = await analyzeMercadoLibreError(error, jobId);
      
      // Si después de refrescar el token seguimos teniendo errores de autenticación
      // es posible que necesitemos intervención manual
      if (errorAnalysis.category === 'auth_error' && retryAfterRefresh) {
        await logActivity("Error crítico de autenticación incluso después de refrescar token", "error", errorAnalysis, jobId);
        
        return res.status(500).json({
          error: "Error crítico de autenticación incluso después de refrescar token",
          details: errorAnalysis,
          requiresManualIntervention: true
        });
      }
      
      return res.status(500).json({
        error: `Error al actualizar precio: ${errorAnalysis.message}`,
        category: errorAnalysis.category,
        details: errorAnalysis
      });
    }
    
  } catch (error) {
    console.error("Error en retry-update-price:", error);
    
    return res.status(500).json({
      error: "Error en el proceso de reintento de actualización",
      message: error.message,
      details: error.response?.data
    });
  }
}