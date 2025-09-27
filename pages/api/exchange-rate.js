import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

/**
 * API para obtener el tipo de cambio EUR a CLP usando múltiples fuentes
 * Implementa un sistema de fallback con varias APIs públicas gratuitas
 * y almacenamiento de valores históricos en base de datos
 */
export default async function handler(req, res) {
  try {
    // Lista de APIs públicas para tipo de cambio - Actualizada con fuentes más confiables
    const apis = [
      { 
        name: "ExchangeRate-API", 
        url: "https://v6.exchangerate-api.com/v6/4b2791d8815316b6f5d4e0b2/latest/EUR", 
        extractRate: (data) => data?.conversion_rates?.CLP,
        quota: "1500 llamadas/mes"
      },
      { 
        name: "Open Exchange Rates", 
        url: "https://open.er-api.com/v6/latest/EUR", 
        extractRate: (data) => data?.rates?.CLP,
        quota: "Hasta 1000 llamadas/mes"
      },
      { 
        name: "Currency API (CDN)", 
        url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json", 
        extractRate: (data) => data?.eur?.clp,
        quota: "Sin límite (CDN)"
      },
      { 
        name: "ExchangeRate Host", 
        url: "https://api.exchangerate.host/latest?base=EUR&symbols=CLP", 
        extractRate: (data) => data?.rates?.CLP,
        quota: "Sin límite documentado"
      },
      { 
        name: "Currency Freaks", 
        url: "https://api.currencyfreaks.com/v2.0/rates/latest?apikey=c5e4eb75cfde47b0a5c2972d72db1fa5&symbols=CLP&base=EUR", 
        extractRate: (data) => parseFloat(data?.rates?.CLP),
        quota: "1000 llamadas/mes"
      }
    ];

    // Registra la API usada para estadísticas
    const source = req.query.source || 'api-direct';
    console.log(`[FX] Solicitud de tipo de cambio desde: ${source}`);

    // Resultados y errores
    const results = [];
    const errors = [];
    
    // Configurar tiempos de espera más razonables
    const TIMEOUT_MS = 5000; // 5 segundos
    
    // Función para crear una promesa con timeout personalizado
    const fetchWithTimeout = async (api) => {
      try {
        console.log(`[FX] Consultando API: ${api.name}`);
        const response = await axios.get(api.url, { 
          timeout: TIMEOUT_MS,
          headers: {
            'User-Agent': 'Mozilla/5.0 MercadoLibre Currency Converter/1.0'
          }
        });
        
        const rate = api.extractRate(response.data);
        if (rate && typeof rate === 'number' && rate > 0) {
          console.log(`[FX] ✅ API ${api.name} respondió con tasa: ${rate}`);
          results.push({
            name: api.name,
            rate,
            quota: api.quota
          });
          return true;
        }
        
        console.warn(`[FX] ⚠️ API ${api.name} devolvió tasa inválida: ${rate}`);
        errors.push(`${api.name}: Tasa inválida (${rate})`);
        return false;
      } catch (error) {
        const errorMsg = error.response?.status 
          ? `Error HTTP ${error.response.status}` 
          : error.code === 'ECONNABORTED'
            ? 'Timeout'
            : error.message;
            
        console.error(`[FX] ❌ Error en API ${api.name}: ${errorMsg}`);
        errors.push(`${api.name}: ${errorMsg}`);
        return false;
      }
    };
    
    // Consultar cada API en paralelo con mejor manejo de errores
    const apiPromises = apis.map(api => fetchWithTimeout(api));
    await Promise.allSettled(apiPromises);

    // Si hay al menos un resultado exitoso
    if (results.length > 0) {
      // Ordenar por tasa para verificar outliers
      results.sort((a, b) => a.rate - b.rate);
      
      // Análisis estadístico básico para detectar valores atípicos
      let validRates = [...results];
      
      // Si hay múltiples resultados, aplicar filtrado de outliers
      if (results.length >= 4) {
        console.log("[FX] Aplicando filtro de outliers (eliminando valor más alto y más bajo)");
        validRates = results.slice(1, -1); // Eliminar el más alto y el más bajo
      } else if (results.length >= 3) {
        // Con 3 valores, verificar si hay uno muy desviado (>10% de diferencia)
        const min = Math.min(...results.map(r => r.rate));
        const max = Math.max(...results.map(r => r.rate));
        const avgExtremes = (min + max) / 2;
        const deviation = (max - min) / avgExtremes;
        
        if (deviation > 0.1) { // Si hay más de 10% de diferencia entre min y max
          console.log(`[FX] Alta variabilidad entre fuentes (${Math.round(deviation * 100)}%). Eliminando extremos.`);
          // Ordenar por distancia al valor medio y quedarse con el que esté más cerca del centro
          const mid = results.length % 2 === 1 
            ? results[Math.floor(results.length / 2)].rate 
            : (results[results.length / 2 - 1].rate + results[results.length / 2].rate) / 2;
          validRates = [results.reduce((prev, curr) => 
            (Math.abs(curr.rate - mid) < Math.abs(prev.rate - mid)) ? curr : prev, results[0])];
        }
      }
      
      // Calcular el promedio
      const sum = validRates.reduce((acc, curr) => acc + curr.rate, 0);
      const average = sum / validRates.length;
      const roundedAverage = Math.round(average);
      
      // Detalles de las fuentes utilizadas
      const sources = results.map(r => `${r.name}: ${r.rate}`).join(', ');
      
      console.log(`[FX] ✅ Tipo de cambio EUR/CLP calculado: ${roundedAverage} (promedio de ${validRates.length} fuentes válidas)`);
      
      // Guardar el valor en la base de datos para uso futuro
      try {
        const supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        
        await supabase.from("exchange_rates").insert({
          rate: roundedAverage,
          sources: validRates.map(r => r.name),
          created_at: new Date().toISOString()
        });
        
        console.log(`[FX] 💾 Tipo de cambio guardado en la base de datos: ${roundedAverage}`);
      } catch (dbError) {
        console.error(`[FX] Error al guardar tipo de cambio en la base de datos: ${dbError.message}`);
      }
      
      return res.status(200).json({
        rate: roundedAverage,
        sources: validRates.map(r => r.name),
        allSources: sources,
        date: new Date().toISOString(),
        fallback: false
      });
    }

    // Si todas las APIs fallaron, usar valor de fallback desde base de datos o archivo local
    try {
      // Intentar obtener el último tipo de cambio guardado en la base de datos
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      const { data: lastExchangeRate, error: dbError } = await supabase
        .from("exchange_rates")
        .select("rate, created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      
      // Si encontramos un valor reciente (menos de 24 horas), usarlo
      if (!dbError && lastExchangeRate && lastExchangeRate.length > 0) {
        const savedRate = lastExchangeRate[0].rate;
        const savedDate = new Date(lastExchangeRate[0].created_at);
        const hoursAgo = (Date.now() - savedDate.getTime()) / (1000 * 60 * 60);
        
        // Solo usar valores de las últimas 24 horas para garantizar precios actualizados
        if (hoursAgo < 24) {
          console.warn(`[FX] ⚠️ Usando tipo de cambio almacenado de hace ${Math.round(hoursAgo)} horas: ${savedRate}`);
          
          // Si el valor es muy reciente (menos de 1 hora), no mostrar advertencia
          const logLevel = hoursAgo < 1 ? 'info' : 'warning';
          console.log(`[FX] Tipo de cambio de la base de datos (${logLevel}): ${savedRate} CLP por EUR`);
          
          return res.status(200).json({
            rate: savedRate,
            date: new Date().toISOString(),
            savedDate: savedDate.toISOString(),
            hoursAgo: Math.round(hoursAgo),
            errors: errors,
            fallback: true,
            fallbackSource: "database_recent"
          });
        } else {
          console.warn(`[FX] ⚠️ Valor en base de datos demasiado antiguo (${Math.round(hoursAgo)} horas), buscando fuentes alternativas`);
        }
      }
    } catch (dbError) {
      console.error(`[FX] Error al obtener tipo de cambio de base de datos: ${dbError.message}`);
    }
    
    // Si todo lo demás falla, intentar fuentes directas adicionales de emergencia
    const emergencyApis = [
      { 
        name: "Currency Converter API", 
        url: "https://api.exchangerate.host/convert?from=EUR&to=CLP", 
        extractRate: (data) => data?.result,
        timeout: 5000
      },
      { 
        name: "FreeCurrency API", 
        url: "https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1/latest/currencies/eur/clp.json",
        extractRate: (data) => data?.clp,
        timeout: 5000
      },
      { 
        name: "GeoDB Cities API",
        url: "https://api.fastforex.io/fetch-one?from=EUR&to=CLP&api_key=5d7d781a86-360456c2d2-ryhkjq", 
        extractRate: (data) => data?.result?.CLP,
        timeout: 5000
      }
    ];
    
    // Intentar cada fuente de emergencia secuencialmente
    for (const emergencyApi of emergencyApis) {
      try {
        console.log(`[FX] 🔄 Intentando fuente de emergencia: ${emergencyApi.name}`);
        const emergencyResponse = await axios.get(emergencyApi.url, { 
          timeout: emergencyApi.timeout 
        });
        
        const rate = emergencyApi.extractRate(emergencyResponse.data);
        if (rate && rate > 0) {
          const emergencyRate = Math.round(rate);
          console.log(`[FX] ✅ Tipo de cambio obtenido de fuente de emergencia ${emergencyApi.name}: ${emergencyRate}`);
          
          return res.status(200).json({
            rate: emergencyRate,
            date: new Date().toISOString(),
            sources: [emergencyApi.name],
            errors: errors,
            fallback: true,
            fallbackSource: "emergency_api"
          });
        } else {
          console.warn(`[FX] ⚠️ La fuente de emergencia ${emergencyApi.name} devolvió un valor inválido: ${rate}`);
        }
      } catch (emergencyError) {
        console.error(`[FX] Error en fuente de emergencia ${emergencyApi.name}: ${emergencyError.message}`);
      }
    }
    
    // Si todas las fuentes fallaron, reportar un error
    console.error(`[FX] ❌ ERROR CRÍTICO: Todas las fuentes de tipo de cambio fallaron. Razones: ${errors.join('; ')}`);
    
    return res.status(503).json({
      error: "No se pudo obtener un tipo de cambio real EUR/CLP de ninguna fuente",
      message: "Se requiere un valor real del tipo de cambio para continuar. Todas las fuentes de datos fallaron.",
      date: new Date().toISOString(),
      errors: errors,
      suggestion: "Verifica la conectividad a Internet y el estado de las APIs de tipo de cambio"
    });
  } catch (error) {
    console.error(`[FX] Error general: ${error.message}`);
    
    // Error en caso de fallo no manejado
    return res.status(503).json({
      error: "Error crítico al obtener el tipo de cambio EUR/CLP",
      message: error.message,
      date: new Date().toISOString(),
      suggestion: "Verifica la conectividad a Internet y el estado de las APIs de tipo de cambio"
    });
  }
}
