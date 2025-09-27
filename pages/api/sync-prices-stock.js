import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { createJob, completeJob, updateJobProgress, failJob } from "../../lib/jobs";
import {
  computePriceCLP,
  logActivity
} from "./_logic";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PRICE_CHANGE_THRESHOLD = 0.05; // 5% de cambio para registrar como cambio significativo
const BATCH_SIZE = 50; // Procesar 50 productos a la vez para no sobrecargar la API

/**
 * Función principal que actualiza precios y stock de productos existentes
 */
async function updateProductsJob(jobId, options = {}) {
  try {
    const { 
      updatePrices = true, 
      updateStock = true,
      updateOnlyWithStock = false,
      updateMl = true,
      limit = null
    } = options;

    // Obtener token de ML solo si vamos a actualizar en ML
    let ML_ACCESS_TOKEN = null;
    if (updateMl) {
      const { data: tokenData } = await supabase
        .from("tokens")
        .select("value")
        .eq("key", "ML_ACCESS_TOKEN")
        .single();
        
      if (!tokenData?.value) {
        throw new Error("No se pudo obtener el token de MercadoLibre");
      }
      
      ML_ACCESS_TOKEN = tokenData.value;
    }
    
    const KINGUIN_API_KEY = process.env.KINGUIN_API_KEY;

    if (!KINGUIN_API_KEY) {
      throw new Error("Faltan credenciales (KINGUIN_API_KEY)");
    }

    await logActivity(`Iniciando actualización de productos existentes`, 'info', options, jobId);

    // Consultar productos ya publicados
    let query = supabase
      .from("published_products")
      .select("kinguin_id, ml_id, price_clp, stock, title, updated_at")
      .order("updated_at", { ascending: true }); // Priorizar los que hace más tiempo no se actualizan
    
    if (updateOnlyWithStock) {
      query = query.gt("stock", 0);
    }
    
    if (limit) {
      query = query.limit(limit);
    }
    
    const { data: products, error } = await query;
    
    if (error) {
      throw new Error(`Error al obtener productos: ${error.message}`);
    }

    await logActivity(`Se encontraron ${products.length} productos para actualizar`, 'info', null, jobId);
    
    // Estadísticas
    const stats = {
      total: products.length,
      processed: 0,
      priceUpdated: 0,
      stockUpdated: 0,
      errors: 0,
      noStock: 0,
      unchanged: 0,
      significantPriceChanges: 0
    };
    
    // Procesar en lotes
    const batches = [];
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      batches.push(products.slice(i, i + BATCH_SIZE));
    }
    
    const updateResults = [];
    
    for (let [batchIndex, batch] of batches.entries()) {
      await logActivity(`Procesando lote ${batchIndex + 1} de ${batches.length} (${batch.length} productos)`, 'info', null, jobId);
      
      const batchPromises = batch.map(product => 
        updateSingleProduct(product, { ML_ACCESS_TOKEN, KINGUIN_API_KEY, updatePrices, updateStock, updateMl }, jobId)
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Analizar resultados
      for (const result of batchResults) {
        stats.processed++;
        
        if (result.status === 'fulfilled') {
          updateResults.push(result.value);
          
          if (result.value.status === 'error') {
            stats.errors++;
          } else {
            if (result.value.priceUpdated) stats.priceUpdated++;
            if (result.value.stockUpdated) stats.stockUpdated++;
            if (result.value.significantPriceChange) stats.significantPriceChanges++;
            if (result.value.noStock) stats.noStock++;
            if (!result.value.priceUpdated && !result.value.stockUpdated) stats.unchanged++;
          }
        } else {
          stats.errors++;
          updateResults.push({
            status: 'error',
            kinguinId: 'unknown',
            error: result.reason?.message || 'Error desconocido'
          });
        }
      }
      
      // Actualizar el progreso del trabajo
      await updateJobProgress(jobId, {
        stats,
        completed: stats.processed,
        total: stats.total,
        lastUpdated: new Date().toISOString()
      });
      
      // Breve pausa entre lotes para no sobrecargar APIs
      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Completar el trabajo
    await completeJob(jobId, {
      stats,
      completedAt: new Date().toISOString(),
      summary: `${stats.priceUpdated} precios y ${stats.stockUpdated} stocks actualizados. ${stats.errors} errores.`
    }, updateResults);
    
    await logActivity(
      `Actualización de productos completada: ${stats.priceUpdated} precios y ${stats.stockUpdated} stocks actualizados. ${stats.significantPriceChanges} cambios significativos de precio.`,
      'success',
      stats,
      jobId
    );
    
    return { success: true, stats };
    
  } catch (err) {
    console.error(`Error en actualización de productos:`, err);
    
    await logActivity(
      `Error en proceso de actualización: ${err.message}`,
      'error',
      { stack: err.stack },
      jobId
    );
    
    await failJob(jobId, err);
    throw err;
  }
}

/**
 * Actualiza un solo producto
 */
async function updateSingleProduct(product, { ML_ACCESS_TOKEN, KINGUIN_API_KEY, updatePrices, updateStock, updateMl }, jobId) {
  const { kinguin_id: kinguinId, ml_id: mlId, price_clp: currentPrice, stock: currentStock } = product;
  const result = {
    kinguinId,
    mlId,
    status: 'success',
    priceUpdated: false,
    stockUpdated: false,
    significantPriceChange: false,
    noStock: false
  };
  
  try {
    // 1. Obtener datos actualizados de Kinguin
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const { data: kinguinProduct } = await axios.get(
      `https://gateway.kinguin.net/esa/api/v1/products/${kinguinId}`,
      {
        headers: { 
          "X-Api-Key": KINGUIN_API_KEY,
          "Connection": "keep-alive"
        },
        signal: controller.signal,
        timeout: 10000
      }
    );
    
    clearTimeout(timeoutId);
    
    // 2. Verificar si hay ofertas disponibles
    if (!kinguinProduct.offers || kinguinProduct.offers.length === 0) {
      await logActivity(`Producto ${kinguinId} sin ofertas disponibles`, 'warning', null, jobId);
      result.noStock = true;
      
      // Actualizar stock a cero si está habilitada la actualización de stock
      if (updateStock && currentStock > 0) {
        await updateProductInDB(kinguinId, { stock: 0 });
        result.stockUpdated = true;
        
        if (updateMl && ML_ACCESS_TOKEN) {
          await updateMLStock(mlId, 0, ML_ACCESS_TOKEN);
        }
        
        await logActivity(`Stock actualizado a 0 para ${kinguinId} (${product.title})`, 'info', null, jobId);
      }
      
      return result;
    }
    
    const availableOffers = kinguinProduct.offers.filter(o => o.qty > 0);
    if (availableOffers.length === 0) {
      await logActivity(`Producto ${kinguinId} sin stock disponible`, 'warning', null, jobId);
      result.noStock = true;
      
      // Actualizar stock a cero si está habilitada la actualización de stock
      if (updateStock && currentStock > 0) {
        await updateProductInDB(kinguinId, { stock: 0 });
        result.stockUpdated = true;
        
        if (updateMl && ML_ACCESS_TOKEN) {
          await updateMLStock(mlId, 0, ML_ACCESS_TOKEN);
        }
        
        await logActivity(`Stock actualizado a 0 para ${kinguinId} (${product.title})`, 'info', null, jobId);
      }
      
      return result;
    }
    
    // 3. Obtener la oferta más barata
    const cheapest = availableOffers.reduce(
      (a, o) => parseFloat(o.price) < parseFloat(a.price) ? o : a, 
      availableOffers[0]
    );
    
    // 4. Actualizar precio si está habilitado
    if (updatePrices) {
      const priceData = await computePriceCLP(parseFloat(cheapest.price));
      const newPrice = priceData.priceCLP;
      
      const priceChange = Math.abs(newPrice - currentPrice) / currentPrice;
      const isSignificantChange = priceChange > PRICE_CHANGE_THRESHOLD;
      
      if (newPrice !== currentPrice) {
        // Actualizar en nuestra base de datos
        await updateProductInDB(kinguinId, { price_clp: newPrice });
        
        // Actualizar en MercadoLibre si está habilitado
        if (updateMl && ML_ACCESS_TOKEN) {
          await updateMLPrice(mlId, newPrice, ML_ACCESS_TOKEN);
        }
        
        // Registrar historial de precio
        await recordPriceChange(kinguinId, mlId, currentPrice, newPrice, priceData.FX_EUR_CLP, cheapest.price);
        
        result.priceUpdated = true;
        result.significantPriceChange = isSignificantChange;
        result.oldPrice = currentPrice;
        result.newPrice = newPrice;
        result.priceChange = (priceChange * 100).toFixed(2) + '%';
        
        const logType = isSignificantChange ? 'warning' : 'info';
        await logActivity(
          `Precio actualizado para ${kinguinId} (${product.title}): ${currentPrice} → ${newPrice} CLP (${(priceChange * 100).toFixed(2)}%)`,
          logType,
          { 
            oldPrice: currentPrice, 
            newPrice: newPrice, 
            change: priceChange,
            mlId: mlId
          },
          jobId
        );
      }
    }
    
    // 5. Actualizar stock si está habilitado
    if (updateStock && cheapest.qty !== currentStock) {
      // Actualizar en nuestra base de datos
      await updateProductInDB(kinguinId, { stock: cheapest.qty });
      
      // Actualizar en MercadoLibre si está habilitado
      if (updateMl && ML_ACCESS_TOKEN) {
        await updateMLStock(mlId, cheapest.qty, ML_ACCESS_TOKEN);
      }
      
      result.stockUpdated = true;
      result.oldStock = currentStock;
      result.newStock = cheapest.qty;
      
      await logActivity(
        `Stock actualizado para ${kinguinId} (${product.title}): ${currentStock} → ${cheapest.qty}`,
        'info',
        { oldStock: currentStock, newStock: cheapest.qty, mlId: mlId },
        jobId
      );
    }
    
    return result;
    
  } catch (error) {
    console.error(`Error actualizando producto ${kinguinId} (${mlId}):`, error.message);
    
    await logActivity(
      `Error actualizando ${kinguinId}: ${error.message}`,
      'error',
      { 
        error: error.message,
        stack: error.stack,
        mlId: mlId,
        productTitle: product.title
      },
      jobId
    );
    
    return {
      kinguinId,
      mlId,
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Actualiza el precio en MercadoLibre
 */
async function updateMLPrice(mlId, price, token) {
  await axios.put(
    `https://api.mercadolibre.com/items/${mlId}`,
    { price },
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000
    }
  );
}

/**
 * Actualiza el stock en MercadoLibre
 */
async function updateMLStock(mlId, quantity, token) {
  await axios.put(
    `https://api.mercadolibre.com/items/${mlId}`,
    { available_quantity: quantity },
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000
    }
  );
}

/**
 * Actualiza los datos en nuestra base de datos
 */
async function updateProductInDB(kinguinId, updates) {
  const { error } = await supabase
    .from("published_products")
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq("kinguin_id", String(kinguinId));
    
  if (error) throw new Error(`Error actualizando en DB: ${error.message}`);
}

/**
 * Registra un cambio de precio en el historial
 */
async function recordPriceChange(kinguinId, mlId, oldPrice, newPrice, exchangeRate, originalEurPrice) {
  const { error } = await supabase
    .from("price_history")
    .insert({
      kinguin_id: String(kinguinId),
      ml_id: mlId,
      old_price: oldPrice,
      new_price: newPrice,
      change_percentage: ((newPrice - oldPrice) / oldPrice) * 100,
      exchange_rate: exchangeRate,
      original_eur_price: originalEurPrice,
      recorded_at: new Date().toISOString()
    });
    
  if (error) console.error(`Error registrando historial de precio: ${error.message}`);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  
  // Ahora soportamos GET para cronjobs externos
  const isExternalCron = req.method === "GET" && req.query.source === "external-cron";
  
  if (req.method !== "POST" && !isExternalCron) {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    // Configurar opciones del trabajo
    let options = {
      updatePrices: true,
      updateStock: true,
      updateOnlyWithStock: false,
      updateMl: true,
      limit: isExternalCron ? 100 : null // Por defecto 100 para cronjobs
    };
    
    // Obtener opciones según el método
    if (isExternalCron) {
      if (req.query.updateOnlyWithStock === 'true') options.updateOnlyWithStock = true;
      if (req.query.limit) options.limit = parseInt(req.query.limit, 10) || 100;
      if (req.query.updateMl === 'false') options.updateMl = false;
    } else {
      const {
        updatePrices = true,
        updateStock = true,
        updateOnlyWithStock = false,
        updateMl = true,
        limit = null
      } = req.body;
      
      options = {
        updatePrices,
        updateStock,
        updateOnlyWithStock,
        updateMl,
        limit
      };
    }

    // Crear un trabajo para ejecutar la actualización
    const jobId = await createJob('sync-prices-stock', options);
    
    // Para cronjobs externos, esperamos que se complete
    if (isExternalCron) {
      try {
        const result = await updateProductsJob(jobId, options);
        return res.status(200).json({
          success: true,
          message: "Actualización completada",
          stats: result.stats,
          jobId
        });
      } catch (err) {
        return res.status(500).json({
          success: false,
          error: err.message,
          jobId
        });
      }
    } 
    // Para solicitudes normales (POST), ejecutar en segundo plano
    else {
      // Ejecutar el proceso en segundo plano
      updateProductsJob(jobId, options)
        .catch(err => console.error(`Error en job de actualización ${jobId}:`, err));
  
      return res.status(202).json({
        success: true,
        message: "Actualización de productos iniciada en segundo plano",
        jobId
      });
    }
  } catch (err) {
    console.error("Error al iniciar actualización:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}