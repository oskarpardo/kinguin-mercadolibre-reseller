// Endpoint para verificar el estado general de la integración con MercadoLibre
// Útil para verificar si los tokens son válidos, comprobar tasas de cambio, etc.

import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { getEuroToClp, logActivity } from "./_logic";
import { axiosWithSmartRetry } from "./_http-utils";

// ---------- Supabase ----------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido, usa GET" });
  }

  try {
    const checks = {};
    const startTime = Date.now();
    
    // 1. Verificar conexión a Supabase
    try {
      const { count, error } = await supabase
        .from("published_products")
        .select("id", { count: 'exact', head: true });
      
      checks.supabase = {
        status: error ? "error" : "ok",
        productCount: count,
        error: error?.message
      };
    } catch (error) {
      checks.supabase = {
        status: "error",
        error: error.message
      };
    }
    
    // 2. Verificar Token ML
    let ML_ACCESS_TOKEN;
    try {
      // Primero intentar desde Supabase
      const { data: tokenData, error } = await supabase
        .from("tokens")
        .select("value, updated_at")
        .eq("key", "ML_ACCESS_TOKEN")
        .single();
      
      if (error) throw error;
      
      ML_ACCESS_TOKEN = tokenData.value;
      const tokenAge = Date.now() - new Date(tokenData.updated_at).getTime();
      const tokenAgeHours = Math.round(tokenAge / (1000 * 60 * 60) * 10) / 10;
      
      checks.mercadolibreToken = {
        status: "ok",
        source: "supabase",
        updatedHoursAgo: tokenAgeHours,
        tokenPresent: !!ML_ACCESS_TOKEN
      };
    } catch (error) {
      // Fallback a variables de entorno
      ML_ACCESS_TOKEN = process.env.ML_ACCESS_TOKEN;
      
      checks.mercadolibreToken = {
        status: ML_ACCESS_TOKEN ? "ok" : "error",
        source: "env",
        tokenPresent: !!ML_ACCESS_TOKEN,
        error: error.message
      };
    }
    
    // 3. Verificar validez del token comprobando el usuario de ML
    if (ML_ACCESS_TOKEN) {
      try {
        const userResponse = await axiosWithSmartRetry(
          "https://api.mercadolibre.com/users/me",
          null,
          { 
            method: 'get',
            headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
          }
        );
        
        checks.mercadolibreUser = {
          status: "ok",
          id: userResponse.data.id,
          nickname: userResponse.data.nickname,
          site_id: userResponse.data.site_id,
          permalink: userResponse.data.permalink
        };
      } catch (error) {
        checks.mercadolibreUser = {
          status: "error",
          error: error.message,
          statusCode: error.response?.status,
          needsRefresh: error.response?.status === 401
        };
      }
    } else {
      checks.mercadolibreUser = {
        status: "skip",
        reason: "No hay token disponible"
      };
    }
    
    // 4. Verificar API Key de Kinguin
    const KINGUIN_API_KEY = process.env.KINGUIN_API_KEY;
    if (KINGUIN_API_KEY) {
      try {
        const kinguinResponse = await axios.get(
          "https://gateway.kinguin.net/esa/api/v1/products?limit=1",
          { headers: { 'Api-Ecommerce-Auth': KINGUIN_API_KEY } }
        );
        
        checks.kinguin = {
          status: "ok",
          apiPresent: true,
          responseStatus: kinguinResponse.status
        };
      } catch (error) {
        checks.kinguin = {
          status: "error",
          apiPresent: !!KINGUIN_API_KEY,
          error: error.message,
          statusCode: error.response?.status
        };
      }
    } else {
      checks.kinguin = {
        status: "error",
        apiPresent: false,
        error: "API Key de Kinguin no está configurada"
      };
    }
    
    // 5. Verificar tasa de cambio EUR a CLP
    try {
      const { priceCLP, FX_EUR_CLP, source } = await getEuroToClp(1);
      
      checks.exchangeRate = {
        status: "ok",
        eurToCLP: FX_EUR_CLP,
        source: source,
        testPrice: priceCLP
      };
    } catch (error) {
      checks.exchangeRate = {
        status: "error",
        error: error.message
      };
    }
    
    // 6. Verificar productos publicados
    try {
      const { data: publishedStats, error } = await supabase
        .from("published_products")
        .select("status")
        .in("status", ["active", "paused", "closed"]);
      
      if (error) throw error;
      
      const stats = publishedStats.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, { active: 0, paused: 0, closed: 0 });
      
      checks.publishedProducts = {
        status: "ok",
        total: publishedStats.length,
        active: stats.active,
        paused: stats.paused,
        closed: stats.closed
      };
    } catch (error) {
      checks.publishedProducts = {
        status: "error",
        error: error.message
      };
    }
    
    // Registrar la verificación de estado en los logs
    await logActivity(
      `Verificación de estado del sistema completada (${checks.mercadolibreUser?.status === "ok" ? "✅" : "❌"} ML, ${checks.kinguin?.status === "ok" ? "✅" : "❌"} Kinguin)`,
      "info",
      checks
    );
    
    return res.status(200).json({
      success: true,
      checks,
      timestamp: new Date().toISOString(),
      executionTimeMs: Date.now() - startTime
    });
    
  } catch (error) {
    console.error("Error en health-check:", error);
    
    return res.status(500).json({
      success: false,
      error: "Error al verificar el estado del sistema",
      message: error.message,
      details: error.response?.data
    });
  }
}