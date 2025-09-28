import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { createJob, completeJob, updateJobProgress, failJob } from "../../lib/jobs";
import {
  validateProduct,
  normalizePlatform,
  getProductType,
  regionVerdict as regionVerdictLogic,
  computePriceCLP,
  titleFrom,
  descriptionFrom,
  postPlainDescription,
  getKinguinProduct,
  logActivity,
  logStep,
  logDecision
} from "./_logic";
// ✅ IMPORTAR VALIDACIÓN DE MERCADO para evitar infracciones de precios
import { validateMarketPrice, isReasonableGamePrice } from "./_market-validation";
import { 
  axiosWithSmartRetry, 
  batchRequests
} from "./_http-utils";
import {
  analyzeMercadoLibreError,
  recoverFromMercadoLibreError
} from "./_ml-error-handler";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------- Verificación de SKU duplicado en MercadoLibre ----------
async function checkSkuDuplicateInMercadoLibre(sku, ML_ACCESS_TOKEN, jobId = null) {
  try {
    // Obtener info del usuario
    const userResponse = await axiosWithSmartRetry(
      'https://api.mercadolibre.com/users/me',
      null,
      {
        method: 'get',
        headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
      }
    );

    const userId = userResponse.data.id;

    // Buscar productos activos del usuario con más productos
    let allItems = [];
    let offset = 0;
    const limit = 50;
    
    // Obtener hasta 200 productos activos para verificar duplicados
    for (let page = 0; page < 4; page++) {
      const itemsResponse = await axiosWithSmartRetry(
        `https://api.mercadolibre.com/users/${userId}/items/search?status=active&offset=${offset}&limit=${limit}`,
        null,
        {
          method: 'get',
          headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
        }
      );

      const items = itemsResponse.data.results || [];
      if (items.length === 0) break;
      
      allItems = allItems.concat(items);
      offset += limit;
      
      if (allItems.length >= itemsResponse.data.paging.total) break;
    }
    
    await logStep("SKU_CHECK_SCOPE", `🔍 Verificando SKU en ${allItems.length} productos activos`, { 
      sku, 
      products_to_check: allItems.length 
    }, jobId);
    
    // Verificar productos en lotes para mayor eficiencia
    const batchSize = 10;
    
    for (let i = 0; i < allItems.length; i += batchSize) {
      const batch = allItems.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (itemId) => {
        try {
          const itemResponse = await axiosWithSmartRetry(
            `https://api.mercadolibre.com/items/${itemId}`,
            null,
            {
              method: 'get',
              headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
            }
          );

          const item = itemResponse.data;
          
          // Extraer SKU del atributo SELLER_SKU
          const skuAttribute = item.attributes?.find(attr => attr.id === 'SELLER_SKU');
          const existingSku = skuAttribute?.value_name;

          if (existingSku === sku) {
            return {
              isDuplicate: true,
              existingItem: {
                ml_id: itemId,
                title: item.title,
                sku: existingSku,
                status: item.status,
                price: item.price
              }
            };
          }
          
          return { isDuplicate: false };
          
        } catch (itemError) {
          console.warn(`⚠️ Error verificando item ${itemId}:`, itemError.message);
          return { isDuplicate: false, error: itemError.message };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      // Verificar si alguno es duplicado
      for (const result of batchResults) {
        if (result.isDuplicate) {
          await logStep("SKU_DUPLICATE_FOUND", `🚫 SKU DUPLICADO ENCONTRADO en MercadoLibre`, {
            duplicate_sku: sku,
            existing_ml_id: result.existingItem.ml_id,
            existing_title: result.existingItem.title,
            existing_status: result.existingItem.status
          }, jobId);

          return result;
        }
      }
      
      // Rate limiting entre lotes
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    await logStep("SKU_CHECK_PASSED", `✅ SKU único verificado: ${sku}`, { 
      sku, 
      products_checked: allItems.length 
    }, jobId);
    
    return {
      isDuplicate: false,
      existingItem: null
    };

  } catch (error) {
    await logStep("SKU_CHECK_ERROR", `❌ Error verificando SKU: ${error.message}`, { 
      sku, 
      error: error.message 
    }, jobId);
    
    // En caso de error, permitir continuar (no bloquear por problemas de verificación)
    console.warn(`⚠️ Error verificando SKU duplicado: ${error.message}`);
    return {
      isDuplicate: false,
      existingItem: null,
      error: error.message
    };
  }
}

// ---------- Tokens desde Supabase (con fallback a ENV) ----------
async function getTokenFromSupabase(key) {
  try {
    const { data, error } = await supabase
      .from("tokens")
      .select("value")
      .eq("key", key)
      .single();

    if (error) throw error;
    return data?.value;
  } catch (err) {
    console.warn(`⚠️ Error al obtener ${key} desde Supabase: ${err.message}. Usando variable de entorno.`);
    return process.env[key];
  }
}

async function processSingleProduct(kinguinId, existingProduct, { ML_ACCESS_TOKEN, KINGUIN_API_KEY }, jobId = null) {
  const startTime = Date.now();
  let duration = 0;
  let updatedFields = []; // Variable para rastrear campos actualizados
  
  try {
    await logStep("INICIO", `Procesando producto Kinguin ID: ${kinguinId}`, { existingProduct }, jobId);
    
    // 🚫 VERIFICACIÓN CRÍTICA TEMPRANA: Detener INMEDIATAMENTE si ya existe
    await logStep("VERIFICACION_TEMPRANA", `🔍 VERIFICACIÓN CRÍTICA - Buscando duplicados para Kinguin ID: ${kinguinId}`, { kinguin_id: kinguinId }, jobId);
    
    // ✅ RESERVA ATÓMICA: Intentar reservar el Kinguin ID insertando un registro de "processing"
    const reservationData = {
      kinguin_id: kinguinId,
      status: 'processing',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    try {
      // Usar ON CONFLICT para prevenir duplicados de forma atómica
      const { data: insertResult, error: insertError } = await supabase
        .from("published_products")
        .upsert(reservationData, { 
          onConflict: 'kinguin_id',
          ignoreDuplicates: false 
        })
        .select();
        
      if (insertError) {
        // Si hay error de conflicto, significa que ya existe
        await logDecision("SKIP_ATOMIC_CONFLICT", `Producto ya siendo procesado por otro proceso - Kinguin ID: ${kinguinId}`, { 
          kinguin_id: kinguinId,
          error: insertError.message
        }, jobId);
        
        return { 
          success: true, 
          skipped: true, 
          reason: "atomic_conflict",
          message: `Producto ya siendo procesado: ${kinguinId}`
        };
      }
      
      await logStep("ATOMIC_RESERVATION", `✅ Reserva atómica exitosa para Kinguin ID: ${kinguinId}`, { kinguin_id: kinguinId }, jobId);
      
    } catch (atomicError) {
      await logDecision("SKIP_ATOMIC_ERROR", `Error en reserva atómica - Kinguin ID: ${kinguinId}`, { 
        kinguin_id: kinguinId,
        error: atomicError.message
      }, jobId);
      
      return { 
        success: true, 
        skipped: true, 
        reason: "atomic_error",
        message: `Error en reserva atómica: ${atomicError.message}`
      };
    }
    
    // Verificación adicional por si acaso
    const { data: existingCheck, error: checkError } = await supabase
      .from("published_products")
      .select("id, ml_id, status, created_at")
      .eq("kinguin_id", kinguinId)
      .neq("status", "closed_duplicate")
      .limit(5);
      
    if (checkError) {
      await logStep("ERROR", `Error en verificación temprana: ${checkError.message}`, { error: checkError }, jobId);
    } else if (existingCheck && existingCheck.length > 1) {
      // Si hay más de 1 registro (el que acabamos de crear + otros), hay un problema
      await logStep("MULTIPLE_DETECTED", `⚠️ Múltiples registros detectados para Kinguin ID ${kinguinId}: ${existingCheck.length}`, { 
        kinguin_id: kinguinId,
        records: existingCheck
      }, jobId);
      
      // Verificar si alguno tiene ML_ID activo
      for (const record of existingCheck) {
        if (record.ml_id) {
          try {
            const mlResponse = await axiosWithSmartRetry(
              `https://api.mercadolibre.com/items/${record.ml_id}`,
              null,
              {
                method: 'get',
                headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` },
                timeout: 8000
              }
            );
            
            if (mlResponse.data?.status === 'active') {
              await logDecision("SKIP_ACTIVE_EXISTS", `Producto activo encontrado - NO REPUBLICAR Kinguin ID: ${kinguinId}`, { 
                ml_id: record.ml_id,
                kinguin_id: kinguinId,
                status: mlResponse.data.status,
                price: mlResponse.data.price
              }, jobId);
              
              // Remover nuestro registro de procesamiento ya que no vamos a procesar
              await supabase
                .from("published_products")
                .delete()
                .eq("kinguin_id", kinguinId)
                .eq("status", "processing")
                .is("ml_id", null);
              
              return { 
                success: true, 
                skipped: true, 
                reason: "active_product_exists",
                ml_id: record.ml_id,
                message: `Producto ya activo en MercadoLibre: ${record.ml_id}`
              };
            }
          } catch (mlError) {
            await logStep("ML_CHECK", `Error verificando ML ID ${record.ml_id}: ${mlError.message}`, { ml_id: record.ml_id }, jobId);
          }
        }
      }
    }
    
    // 1. Obtener detalles del producto desde Kinguin
    let productData;
    try {
      // Timeout específico para llamadas a Kinguin API (15 segundos)
      const kinguinTimeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout: Kinguin API tomó más de 15 segundos')), 15000)
      );
      
      const kinguinPromise = getKinguinProduct(kinguinId, { KINGUIN_API_KEY });
      productData = await Promise.race([kinguinPromise, kinguinTimeoutPromise]);
      
      await logStep("INFO_KINGUIN", "Información obtenida de Kinguin API", { name: productData.name, platform: productData.platform, id: productData.id }, jobId);
    } catch (kinguinError) {
      await logDecision("ERROR", `Error accediendo a API de Kinguin: ${kinguinError.message}`, { error: kinguinError.message }, jobId);
      
      if (kinguinError.response?.status === 401) {
        throw new Error("Error de autenticación con Kinguin API. Verifica tu KINGUIN_API_KEY en las variables de entorno.");
      }
      
      throw kinguinError;
    }
    
    // ✅ INICIALIZAR VARIABLE PARA PRODUCTO EXISTENTE
    let existingProduct = null;
    
    // ✅ DETECCIÓN MEJORADA DE DUPLICADOS: Buscar ALL productos del mismo Kinguin ID (incluidos los que están en proceso)
    const { data: allDuplicates, error: duplicateError } = await supabase
      .from("published_products")
      .select("*")
      .eq("kinguin_id", kinguinId)
      .neq("status", "closed_duplicate"); // Excluir duplicados ya cerrados
      
    if (duplicateError) {
      await logStep("ERROR", `Error buscando duplicados: ${duplicateError.message}`, { error: duplicateError }, jobId);
    }

    // ✅ FILTRO CRÍTICO: Si YA HAY PRODUCTOS de este Kinguin ID (incluso sin ML_ID), DETENER
    if (allDuplicates && allDuplicates.length > 0) {
      await logStep("DUPLICATE_PREVENTION", `🚫 PRODUCTO YA EXISTE - Kinguin ID: ${kinguinId} tiene ${allDuplicates.length} registros`, { 
        kinguin_id: kinguinId,
        existing_records: allDuplicates.length,
        records: allDuplicates.map(duplicate => ({
          id: duplicate.id,
          ml_id: duplicate.ml_id,
          status: duplicate.status,
          created_at: duplicate.created_at
        }))
      }, jobId);

      // Verificar si hay al menos uno con ML_ID activo
      let hasActiveProduct = false;
      for (const duplicate of allDuplicates) {
        if (duplicate.ml_id) {
          try {
            const mlCheckResponse = await axiosWithSmartRetry(
              `https://api.mercadolibre.com/items/${duplicate.ml_id}`,
              null,
              {
                method: 'get',
                headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
              }
            );
            
            if (mlCheckResponse.data?.status === 'active') {
              hasActiveProduct = true;
              await logStep("ACTIVE_FOUND", `✅ Producto activo encontrado: ML ID ${duplicate.ml_id}`, { 
                ml_id: duplicate.ml_id,
                status: mlCheckResponse.data.status,
                price: mlCheckResponse.data.price
              }, jobId);
              break;
            }
          } catch (mlError) {
            await logStep("ML_CHECK", `ML ID ${duplicate.ml_id} no accesible: ${mlError.response?.status || 'error'}`, { 
              ml_id: duplicate.ml_id
            }, jobId);
          }
        }
      }

      if (hasActiveProduct) {
        await logDecision("SKIP_DUPLICATE", `Producto ya existe activo - no republicar Kinguin ID: ${kinguinId}`, { 
          kinguin_id: kinguinId,
          reason: "duplicate_active_product"
        }, jobId);
        return { 
          success: true, 
          skipped: true, 
          reason: "duplicate_active_product",
          message: `Producto ya existe activo para Kinguin ID: ${kinguinId}`
        };
      }

      // Si no hay productos activos pero hay registros recientes (últimos 10 minutos), también evitar duplicados
      const recentRecords = allDuplicates.filter(duplicate => {
        const createdAt = new Date(duplicate.created_at);
        const now = new Date();
        const diffMinutes = (now - createdAt) / (1000 * 60);
        return diffMinutes < 10; // Menos de 10 minutos
      });

      if (recentRecords.length > 0) {
        await logDecision("SKIP_RECENT", `Producto creado recientemente - evitando duplicado Kinguin ID: ${kinguinId}`, { 
          kinguin_id: kinguinId,
          recent_records: recentRecords.length,
          reason: "recent_creation"
        }, jobId);
        return { 
          success: true, 
          skipped: true, 
          reason: "recent_creation",
          message: `Producto creado recientemente para Kinguin ID: ${kinguinId}`
        };
      }
    }

    // ✅ ESTABLECER existingProduct si hay exactamente 1 producto
    if (allDuplicates && allDuplicates.length === 1) {
      existingProduct = allDuplicates[0];
      await logStep("SINGLE_PRODUCT", `📋 Un solo producto encontrado para Kinguin ID: ${kinguinId}`, { 
        kinguin_id: kinguinId,
        supabase_id: existingProduct.id,
        ml_id: existingProduct.ml_id,
        status: existingProduct.status
      }, jobId);
    }

    let activeDuplicates = [];
    if (allDuplicates && allDuplicates.length > 1) {
      await logStep("DUPLICATE_DETECTION", `🔍 Encontrados ${allDuplicates.length} registros del mismo Kinguin ID: ${kinguinId}`, { 
        total_found: allDuplicates.length,
        kinguin_id: kinguinId,
        ml_ids: allDuplicates.map(duplicate => duplicate.ml_id)
      }, jobId);
      
      // Verificar cuáles están realmente activos en MercadoLibre
      for (const duplicate of allDuplicates) {
        if (!duplicate.ml_id) continue; // Skip productos sin ML_ID
        
        try {
          const mlCheckResponse = await axiosWithSmartRetry(
            `https://api.mercadolibre.com/items/${duplicate.ml_id}`,
            null,
            {
              method: 'get',
              headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
            }
          );
          
          if (mlCheckResponse.data?.status === 'active') {
            activeDuplicates.push({
              ...duplicate,
              ml_data: mlCheckResponse.data
            });
          }
          
        } catch (mlCheckError) {
          await logStep("ML_CHECK", `ML ID ${duplicate.ml_id} no accesible (${mlCheckError.response?.status || 'error'})`, { 
            ml_id: duplicate.ml_id,
            error: mlCheckError.response?.status
          }, jobId);
        }
      }
      
      await logStep("ACTIVE_DUPLICATES", `🔍 Duplicados ACTIVOS encontrados: ${activeDuplicates.length}`, { 
        active_count: activeDuplicates.length,
        active_ml_ids: activeDuplicates.map(duplicate => duplicate.ml_id)
      }, jobId);
      
      // ✅ LIMPIEZA AUTOMÁTICA: Si hay múltiples activos, mantener solo uno
      if (activeDuplicates.length > 1) {
        await logStep("CLEANUP_START", `🧹 INICIANDO LIMPIEZA - ${activeDuplicates.length} duplicados activos detectados`, { 
          duplicates: activeDuplicates.length
        }, jobId);
        
        // Ordenar por fecha de creación (mantener el más reciente) y precio (mantener el mejor precio)
        const sortedDuplicates = activeDuplicates.sort((a, b) => {
          // Primero por fecha (más reciente primero)
          const dateCompare = new Date(b.created_at) - new Date(a.created_at);
          if (dateCompare !== 0) return dateCompare;
          
          // Si son de la misma fecha, mantener el de mejor precio (menor precio)
          return (a.ml_data?.price || 999999) - (b.ml_data?.price || 999999);
        });
        
        const keepProduct = sortedDuplicates[0]; // Mantener el primero (más reciente/mejor precio)
        const toDelete = sortedDuplicates.slice(1); // Eliminar el resto
        
        await logStep("CLEANUP_PLAN", `📋 PLAN: Mantener ML ID ${keepProduct.ml_id} (${keepProduct.ml_data?.price} CLP), eliminar ${toDelete.length} duplicados`, { 
          keep: keepProduct.ml_id,
          keep_price: keepProduct.ml_data?.price,
          delete: toDelete.map(duplicate => duplicate.ml_id)
        }, jobId);
        
        // Eliminar duplicados de MercadoLibre
        for (const duplicate of toDelete) {
          try {
            await axiosWithSmartRetry(
              `https://api.mercadolibre.com/items/${duplicate.ml_id}`,
              { status: "closed" },
              {
                method: 'put',
                headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
              }
            );
            
            await logStep("DUPLICATE_CLOSED", `✅ Duplicado cerrado en ML: ${duplicate.ml_id}`, { 
              closed_ml_id: duplicate.ml_id
            }, jobId);
            
            // Actualizar estado en Supabase
            await supabase
              .from("published_products")
              .update({ 
                status: "closed_duplicate",
                updated_at: new Date().toISOString(),
                ml_id: null // Remover ML ID para evitar confusiones futuras
              })
              .eq("id", duplicate.id);
              
          } catch (closeError) {
            await logStep("ERROR", `Error cerrando duplicado ${duplicate.ml_id}: ${closeError.message}`, { 
              error: closeError.message,
              ml_id: duplicate.ml_id
            }, jobId);
          }
        }
        
        // Establecer el producto a mantener como el existingProduct para continuar con la actualización
        existingProduct = keepProduct;
        
        await logStep("CLEANUP_COMPLETE", `🎯 LIMPIEZA COMPLETADA - Manteniendo ML ID: ${keepProduct.ml_id}`, { 
          kept_product: keepProduct.ml_id,
          closed_duplicates: toDelete.length
        }, jobId);
      }
    }
    
    // ✅ FILTRO CRÍTICO: Verificar si el producto YA ESTÁ PUBLICADO en Supabase
    if (existingProduct && existingProduct.ml_id) {
      await logStep("SUPABASE_CHECK", `🔍 Producto YA EXISTE en Supabase con ML ID: ${existingProduct.ml_id}`, { 
        ml_id: existingProduct.ml_id,
        kinguin_id: kinguinId,
        status: existingProduct.status
      }, jobId);
      
      // Verificar el estado actual en MercadoLibre
      try {
        const mlResponse = await axiosWithSmartRetry(
          `https://api.mercadolibre.com/items/${existingProduct.ml_id}`,
          null,
          {
            method: 'get',
            headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
          }
        );
        
        const mlStatus = mlResponse.data?.status || 'unknown';
        
        await logStep("ML_STATUS", `📊 Estado en MercadoLibre: "${mlStatus}"`, { 
          ml_id: existingProduct.ml_id, 
          status: mlStatus,
          current_price: mlResponse.data?.price 
        }, jobId);
        
        // ✅ REGLA CRÍTICA: Si está ACTIVO en ML, NO republicar - solo actualizar precio/título
        if (mlStatus === 'active') {
          await logStep("SKIP_REPUBLISH", `✅ Producto YA ACTIVO en ML - solo actualizando precio/título`, { 
            ml_id: existingProduct.ml_id,
            current_status: mlStatus
          }, jobId);
          // Continuar para actualizar precio/título más adelante
        } else {
          await logStep("ML_INACTIVE", `⚠️ Producto inactivo en ML (${mlStatus}) - evaluando republicación`, { 
            ml_id: existingProduct.ml_id,
            status: mlStatus
          }, jobId);
        }
        
      } catch (mlError) {
        // Si hay error al verificar estado (404 o producto no encontrado)
        if (mlError.response?.status === 404) {
          await logStep("ML_NOT_FOUND", `❌ Producto ya no existe en MercadoLibre: ${existingProduct.ml_id}`, null, jobId);
          // Marcar como que no existe para que se cree uno nuevo
          existingProduct.ml_id = null;
        } else {
          await logStep("ERROR", `Error al verificar estado en ML: ${mlError.message}`, { error: mlError.message }, jobId);
          // Continuar con el proceso normal, intentando actualizar
        }
      }
    }
    
    // 2. Validar el producto
    const { isValid, errors } = validateProduct(productData);
    
    if (!isValid) {
      await logDecision("[SKIP] RECHAZADO", `Producto inválido: ${errors.join(", ")}`, { errors }, jobId);
      duration = (Date.now() - startTime) / 1000;
      return { kinguinId, status: 'skipped', reason: 'invalid_product', message: `Producto rechazado: ${errors.join(", ")}`, errors, timeElapsed: `${duration}s` };
    }
    
    // 3. Verificar la región
    const { allowed, norm: normalizedRegion } = regionVerdictLogic(productData.regionLimitations);
    
    if (!allowed) {
      await logDecision("[SKIP] RECHAZADO", `Región no permitida: ${productData.regionLimitations}`, { normalizedRegion }, jobId);
      duration = (Date.now() - startTime) / 1000;
      return { kinguinId, status: 'skipped', reason: 'invalid_region', message: `Región no permitida: ${productData.regionLimitations}`, normalizedRegion, timeElapsed: `${duration}s` };
    }
    
    // 4. Verificar stock (considerando diferentes estructuras de respuesta de la API)
    if (!productData.offers || productData.offers.length === 0) {
      await logDecision("[SKIP] RECHAZADO", "Producto sin ofertas", { offers: productData.offers }, jobId);
      
      // Si el producto ya existe en MercadoLibre, pausarlo por falta de stock
      if (existingProduct && existingProduct.ml_id) {
        try {
          await logStep("STOCK", "Pausando producto en ML por falta de stock", { ml_id: existingProduct.ml_id }, jobId);
          
          await axiosWithSmartRetry(
            `https://api.mercadolibre.com/items/${existingProduct.ml_id}`,
            { status: "paused" },
            {
              method: 'put',
              headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
            }
          );
          
          // Actualizar estado en Supabase
          await supabase
            .from("published_products")
            .update({
              status: "paused",
              updated_at: new Date().toISOString()
            })
            .eq("kinguin_id", kinguinId);
            
          await logStep("STOCK", "Producto pausado por falta de stock", { ml_id: existingProduct.ml_id }, jobId);
        } catch (pauseError) {
          await logStep("ERROR", `Error al pausar producto sin stock: ${pauseError.message}`, { error: pauseError.message }, jobId);
        }
      }
      
      duration = (Date.now() - startTime) / 1000;
      return { kinguinId, status: 'skipped', reason: 'no_stock', message: 'Producto sin ofertas disponibles', timeElapsed: `${duration}s` };
    }
    
    // Verificar si hay al menos una oferta válida con stock y precio
    // La API de Kinguin puede devolver campos "quantity", "qty", "stock" o "quantityOffers" dependiendo de la versión
    const hasValidOffer = productData.offers.some(offer => {
      // Verificar precio
      const hasValidPrice = typeof offer.price === 'number' && offer.price > 0;
      if (!hasValidPrice) return false;
      
      // Verificar stock en cualquiera de sus posibles formatos
      const hasStock = (
        // Diferentes formatos posibles para la cantidad
        (typeof offer.quantity === 'number' && offer.quantity > 0) || 
        (typeof offer.qty === 'number' && offer.qty > 0) ||
        (typeof offer.quantityOffers === 'number' && offer.quantityOffers > 0) ||
        // En algunos casos, la existencia de price con stock=true implica disponibilidad
        (typeof offer.stock === 'boolean' && offer.stock === true)
      );
      
      return hasValidPrice && hasStock;
    });
    
    if (!hasValidOffer) {
      await logDecision("[SKIP] RECHAZADO", "Sin stock o sin ofertas válidas con precio", { 
        offersCount: productData.offers.length,
        sampleOffer: productData.offers[0]
      }, jobId);
      
      // Si el producto ya existe en MercadoLibre, pausarlo por falta de stock
      if (existingProduct && existingProduct.ml_id) {
        try {
          await logStep("STOCK", "Pausando producto en ML por falta de stock", { ml_id: existingProduct.ml_id }, jobId);
          
          await axiosWithSmartRetry(
            `https://api.mercadolibre.com/items/${existingProduct.ml_id}`,
            { status: "paused" },
            {
              method: 'put',
              headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
            }
          );
          
          // Actualizar estado en Supabase
          await supabase
            .from("published_products")
            .update({
              status: "paused",
              updated_at: new Date().toISOString()
            })
            .eq("kinguin_id", kinguinId);
            
          await logStep("STOCK", "Producto pausado por falta de stock", { ml_id: existingProduct.ml_id }, jobId);
        } catch (pauseError) {
          await logStep("ERROR", `Error al pausar producto sin stock: ${pauseError.message}`, { error: pauseError.message }, jobId);
        }
      }
      
      duration = (Date.now() - startTime) / 1000;
      return { kinguinId, status: 'skipped', reason: 'no_stock', message: 'Sin stock o sin ofertas válidas con precio', timeElapsed: `${duration}s` };
    }
    
    // Si el producto estaba pausado y ahora tiene stock, reactivarlo
    if (existingProduct && existingProduct.ml_id && existingProduct.status === "paused") {
      try {
        await logStep("STOCK", "Reactivando producto pausado que ahora tiene stock", { ml_id: existingProduct.ml_id }, jobId);
        
        await axiosWithSmartRetry(
          `https://api.mercadolibre.com/items/${existingProduct.ml_id}`,
          { status: "active" },
          {
            method: 'put',
            headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
          }
        );
        
        // La actualización del estado en Supabase se hará más adelante en el código
        await logStep("STOCK", "Producto reactivado, ahora tiene stock", { ml_id: existingProduct.ml_id }, jobId);
      } catch (activateError) {
        await logStep("ERROR", `Error al reactivar producto con stock: ${activateError.message}`, { error: activateError.message }, jobId);
      }
    }
    
    // 5. Determinar precio CLP
    // Filtrar ofertas válidas con stock y ordenar por precio
    await logStep("FILTERING_OFFERS", `🔍 Filtrando ofertas - Total disponibles: ${productData.offers?.length || 0}`, { 
      totalOffers: productData.offers?.length || 0,
      sampleOffers: productData.offers?.slice(0, 2) || []
    }, jobId);
    
    const validOffers = productData.offers.filter(offer => {
      // Verificar que el objeto offer existe
      if (!offer || typeof offer !== 'object') {
        return false;
      }
      
      // Verificar precio
      const hasValidPrice = typeof offer.price === 'number' && offer.price > 0 && !isNaN(offer.price);
      if (!hasValidPrice) {
        return false;
      }
      
      // Verificar stock en cualquiera de sus posibles formatos
      const hasStock = (
        (typeof offer.quantity === 'number' && offer.quantity > 0) || 
        (typeof offer.qty === 'number' && offer.qty > 0) ||
        (typeof offer.quantityOffers === 'number' && offer.quantityOffers > 0) ||
        (typeof offer.stock === 'boolean' && offer.stock === true)
      );
      
      return hasValidPrice && hasStock;
    });
    
    await logStep("OFFERS_FILTERED", `📊 Resultado del filtrado: ${validOffers?.length || 0} ofertas válidas`, { 
      validOffersCount: validOffers?.length || 0,
      totalOriginal: productData.offers?.length || 0,
      validOffersSample: validOffers?.slice(0, 2)?.map(offer => ({ 
        price: offer.price, 
        stock: offer.quantity || offer.qty || offer.quantityOffers || offer.stock 
      })) || []
    }, jobId);
    
    // ✅ VALIDACIÓN CRÍTICA: Verificar que hay ofertas válidas
    if (!validOffers || validOffers.length === 0) {
      await logDecision(
        "[SKIP] RECHAZADO", 
        "No se encontraron ofertas válidas con stock y precio", 
        { 
          totalOffers: productData.offers?.length || 0,
          validOffers: 0,
          sampleOffers: productData.offers?.slice(0, 3) || []
        }, 
        jobId
      );
      return {
        kinguinId,
        status: 'skipped',
        reason: 'no_valid_offers',
        message: "No se encontraron ofertas válidas con stock y precio"
      };
    }
    
    // ✅ PROTECCIÓN CRÍTICA: Crear copia del array y ordenar de forma segura
    let lowestOffer;
    try {
      const offersCopy = Array.from(validOffers || []);
      const sortedOffers = offersCopy.sort((offerA, offerB) => {
        const priceA = (offerA && typeof offerA.price === 'number') ? offerA.price : 999999;
        const priceB = (offerB && typeof offerB.price === 'number') ? offerB.price : 999999;
        return priceA - priceB;
      });
      
      lowestOffer = sortedOffers[0];
      
      await logStep("OFFER_SORT", `🔄 Ofertas ordenadas, seleccionando la más barata`, { 
        totalOffers: offersCopy.length,
        selectedPrice: lowestOffer?.price
      }, jobId);
      
    } catch (sortError) {
      await logStep("ERROR", `Error ordenando ofertas: ${sortError.message}`, { error: sortError }, jobId);
      
      return {
        kinguinId,
        status: 'error',
        reason: 'offer_sort_error',
        message: `Error ordenando ofertas: ${sortError.message}`
      };
    }
    
    // ✅ DOBLE VERIFICACIÓN: Asegurar que lowestOffer existe
    if (!lowestOffer || typeof lowestOffer.price !== 'number' || lowestOffer.price <= 0) {
      await logDecision(
        "[SKIP] RECHAZADO", 
        "Error al obtener la oferta más barata", 
        { 
          lowestOffer,
          validOffersCount: validOffers.length
        }, 
        jobId
      );
      return {
        kinguinId,
        status: 'skipped',
        reason: 'invalid_lowest_offer',
        message: "Error al obtener la oferta más barata"
      };
    }
    
    const { priceCLP, FX_EUR_CLP } = await computePriceCLP(lowestOffer.price);
    
    // Verificar si se pudo calcular un precio válido
    if (priceCLP === null || !FX_EUR_CLP) {
      await logDecision(
        "[SKIP] RECHAZADO", 
        "No se pudo calcular un precio válido debido a problemas con el tipo de cambio", 
        { eurPrice: lowestOffer.price }, 
        jobId
      );
      return {
        kinguinId,
        status: 'skipped',
        reason: 'invalid_fx',
        message: "No se pudo calcular un precio válido debido a problemas con el tipo de cambio"
      };
    }
    
    await logStep("PRECIO", `Precio calculado: ${priceCLP} CLP (${lowestOffer.price} EUR, FX: ${FX_EUR_CLP})`, { price: priceCLP, eurPrice: lowestOffer.price }, jobId);
    
    // ✅ VALIDACIÓN ANTI-INFRACCIÓN: Precio para MercadoLibre
    if (!priceCLP || isNaN(priceCLP) || priceCLP < 100 || priceCLP > 50000000) {
      await logDecision(
        "[SKIP] PRECIO_INVALIDO", 
        `Precio fuera del rango permitido por MercadoLibre: ${priceCLP} CLP`, 
        { price: priceCLP, min: 100, max: 50000000 }, 
        jobId
      );
      
      duration = (Date.now() - startTime) / 1000;
      return {
        kinguinId,
        status: 'skipped',
        reason: 'invalid_price_range',
        message: `Precio ${priceCLP} CLP fuera del rango permitido (100 - 50,000,000 CLP)`,
        timeElapsed: `${duration}s`
      };
    }
    
    // Asegurar que el precio sea un entero (MercadoLibre CLP no acepta decimales)
    priceCLP = Math.round(priceCLP);
    
    // ✅ VALIDACIÓN ANTI-INFRACCIÓN: Verificar que el precio sea razonable para el mercado
    const gameBasePriceUSD = lowestOffer.price * 0.9; // Aproximar EUR a USD
    if (gameBasePriceUSD > 0.1 && gameBasePriceUSD < 200) { // Solo para juegos normales
      const expectedPriceCLP = gameBasePriceUSD * 950; // ~$950 CLP por USD
      const priceRatio = priceCLP / expectedPriceCLP;
      
      // Si el precio es 5x más alto o 50% más bajo que esperado, rechazar
      if (priceRatio > 5.0 || priceRatio < 0.5) {
        await logDecision(
          "[SKIP] PRECIO_MERCADO", 
          `Precio muy diferente al valor de mercado: ${priceCLP} CLP vs esperado ~${Math.round(expectedPriceCLP)} CLP (ratio: ${priceRatio.toFixed(2)}x)`, 
          { 
            calculated_price: priceCLP, 
            expected_price: Math.round(expectedPriceCLP), 
            ratio: priceRatio,
            base_usd: gameBasePriceUSD 
          }, 
          jobId
        );
        
        duration = (Date.now() - startTime) / 1000;
        return {
          kinguinId,
          status: 'skipped',
          reason: 'price_significantly_different',
          message: `Precio ${priceCLP} CLP muy diferente al valor de mercado (~${Math.round(expectedPriceCLP)} CLP)`,
          price_ratio: priceRatio,
          timeElapsed: `${duration}s`
        };
      }
    }
    
    // ✅ VALIDACIÓN ANTI-INFRACCIÓN: Verificar precio competitivo del mercado
    const gameNameForSearch = (productData.originalName || productData.name || '').toLowerCase();
    
    // Solo verificar precios para juegos normales (no gift cards o cuentas)
    if (!gameNameForSearch.includes('gift') && !gameNameForSearch.includes('account') && 
        !gameNameForSearch.includes('wallet') && priceCLP > 1000) {
      
      await logStep("MARKET_VALIDATION", "Validando precio contra mercado chileno...", { 
        price: priceCLP, 
        game_name: gameNameForSearch 
      }, jobId);
      
      try {
        const marketValidation = await validateMarketPrice(gameNameForSearch, priceCLP);
        
        if (!marketValidation.isValid && marketValidation.reason === 'outside_market_range') {
          await logDecision(
            "[SKIP] PRECIO_MERCADO", 
            `Precio significativamente diferente al mercado: ${priceCLP} CLP. Rango aceptable: ${marketValidation.marketStats.acceptableRange.min} - ${marketValidation.marketStats.acceptableRange.max} CLP`, 
            { 
              proposed_price: priceCLP,
              market_stats: marketValidation.marketStats,
              price_ratios: marketValidation.priceRatio,
              sample_size: marketValidation.marketStats.sampleSize
            }, 
            jobId
          );
          
          duration = (Date.now() - startTime) / 1000;
          return {
            kinguinId,
            status: 'skipped',
            reason: 'price_significantly_different_market',
            message: `Precio ${priceCLP} CLP fuera del rango de mercado (${marketValidation.marketStats.acceptableRange.min} - ${marketValidation.marketStats.acceptableRange.max} CLP)`,
            market_validation: marketValidation,
            timeElapsed: `${duration}s`
          };
        }
        
        await logStep("MARKET_VALIDATION", `✅ Precio validado contra mercado`, { 
          validation_result: marketValidation.reason,
          market_range: marketValidation.marketStats?.acceptableRange
        }, jobId);
        
      } catch (validationError) {
        // Si falla la validación de mercado, continuar pero registrar advertencia
        await logStep("WARNING", `No se pudo validar precio de mercado: ${validationError.message}`, { 
          error: validationError.message 
        }, jobId);
      }
    }
    
    // 6. Preparar datos para ML
    const productType = getProductType(productData);
    const rawTitle = titleFrom(productData, productType);
    
    // ✅ VALIDACIÓN ANTI-INFRACCIÓN: Limpiar título para MercadoLibre
    let title = rawTitle
      .replace(/[^\w\s\-|áéíóúñÁÉÍÓÚÑ]/g, '') // Solo caracteres seguros
      .replace(/\s+/g, ' ') // Limpiar espacios múltiples
      .replace(/\$[\d,\.]+/g, '') // ✅ REMOVER precios específicos del título
      .replace(/precio\s*mínimo/gi, '') // ✅ REMOVER "precio mínimo"
      .replace(/desde\s*\$/gi, '') // ✅ REMOVER "desde $"
      .replace(/por\s*\$/gi, '') // ✅ REMOVER "por $"
      .replace(/\s+/g, ' ') // Limpiar espacios múltiples nuevamente
      .trim();
    
    // Verificar longitud (MercadoLibre máximo 60 caracteres)
    if (title.length > 60) {
      title = title.substring(0, 57) + '...';
    }
    
    // ✅ VALIDACIÓN ANTI-INFRACCIÓN: Verificar que el título no contenga precios
    const containsPrice = /\$[\d,\.]+|precio|mínimo|desde|por\s*\$/.test(title.toLowerCase());
    if (containsPrice) {
      await logStep("WARNING", `Título contiene referencias de precio, limpiando: "${title}"`, { original_title: rawTitle }, jobId);
      // Limpiar más agresivamente si aún contiene precios
      title = title
        .replace(/precio/gi, '')
        .replace(/mínimo/gi, '')
        .replace(/desde/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    
    // Verificar que no esté vacío o muy corto
    if (!title || title.length < 10) {
      await logDecision(
        "[SKIP] TITULO_INVALIDO", 
        `Título inválido o muy corto después de limpieza: "${title}"`, 
        { original_title: rawTitle, cleaned_title: title }, 
        jobId
      );
      
      duration = (Date.now() - startTime) / 1000;
      return {
        kinguinId,
        status: 'skipped',
        reason: 'invalid_title',
        message: `Título inválido: "${title}"`,
        timeElapsed: `${duration}s`
      };
    }
    const platform = normalizePlatform(productData.platform);
    const description = descriptionFrom(productData, productType);
    
    // 7. ✅ LÓGICA CRÍTICA: Publicar o actualizar SOLO si está activo en MercadoLibre
    // Si ya existe en Supabase, verificar si necesita actualización
    if (existingProduct && existingProduct.ml_id) {
      await logStep("UPDATE_CHECK", `🔄 Verificando si necesita actualización: ML ID ${existingProduct.ml_id}`, { 
        ml_id: existingProduct.ml_id,
        kinguin_id: kinguinId
      }, jobId);
      
      // Obtener información actual del producto en MercadoLibre para comparar
      let needsUpdate = false;
      let currentMLProduct = null;
      
      try {
        const { data: mlProduct } = await axiosWithSmartRetry(
          `https://api.mercadolibre.com/items/${existingProduct.ml_id}`,
          null,
          {
            method: 'get',
            headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
          }
        );
        currentMLProduct = mlProduct;
        
        // ✅ REGLA CRÍTICA: Solo actualizar si el producto está ACTIVO en MercadoLibre
        if (mlProduct.status !== 'active') {
          await logDecision(
            "[SKIP] NO_ACTIVO", 
            `Producto no está activo en ML (${mlProduct.status}) - no se actualiza`, 
            { 
              ml_id: existingProduct.ml_id, 
              current_status: mlProduct.status,
              kinguin_id: kinguinId
            }, 
            jobId
          );
          
          duration = (Date.now() - startTime) / 1000;
          return {
            kinguinId,
            status: 'skipped',
            reason: 'not_active_in_ml',
            message: `Producto no activo en ML (${mlProduct.status})`,
            ml_id: existingProduct.ml_id,
            ml_status: mlProduct.status,
            timeElapsed: `${duration}s`
          };
        }
        
        await logStep("ACTIVE_CHECK", `✅ Producto ACTIVO en ML - verificando necesidad de actualización`, { 
          ml_id: existingProduct.ml_id,
          current_price: mlProduct.price,
          calculated_price: priceCLP,
          current_title: mlProduct.title,
          calculated_title: title
        }, jobId);
        
        // Verificar si el precio necesita actualización (tolerancia reducida a 5 CLP)
        if (Math.abs(mlProduct.price - priceCLP) > 5) { // Tolerancia más estricta
          needsUpdate = true;
          updatedFields.push(`precio: ${mlProduct.price} → ${priceCLP}`);
        }
        
        // Verificar si el título necesita actualización
        if (mlProduct.title.trim() !== title.trim()) {
          needsUpdate = true;
          updatedFields.push(`título: "${mlProduct.title}" → "${title}"`);
        }
        
        // ✅ REGLA CRÍTICA: Solo actualizar precio y título - NO descripción innecesaria
        // (Cumpliendo instrucción del usuario de no tocar descripción si no es necesario)
        
      } catch (error) {
        await logStep("ERROR", `Error al verificar producto en ML: ${error.message}`, { error: error.message }, jobId);
        // Si no podemos verificar, procedemos con la actualización por seguridad
        needsUpdate = true;
        updatedFields.push(`verificación fallida - actualizando por seguridad`);
      }
      
      // Si el producto está activo y NO necesita actualización, hacer SKIP detallado
      if (currentMLProduct && currentMLProduct.status === 'active' && !needsUpdate) {
        const priceDiff = Math.abs(currentMLProduct.price - priceCLP);
        await logStep("SKIP", `Producto activo y actualizado - sin cambios necesarios. Precio ML: ${currentMLProduct.price} vs Calculado: ${priceCLP} (diff: ${priceDiff} CLP)`, { 
          ml_id: existingProduct.ml_id,
          current_price: currentMLProduct.price,
          calculated_price: priceCLP,
          price_difference: priceDiff,
          current_title: currentMLProduct.title,
          calculated_title: title,
          title_match: currentMLProduct.title.trim() === title.trim()
        }, jobId);
        
        // Usar logDecision con emoji verde para SKIP exitoso (producto ya actualizado)
        await logDecision("SKIP_OK", `Producto activo y actualizado - sin cambios necesarios`, { 
          ml_id: existingProduct.ml_id,
          current_price: currentMLProduct.price,
          calculated_price: priceCLP,
          price_difference: priceDiff
        }, jobId);
        
        duration = (Date.now() - startTime) / 1000;
        return { 
          kinguinId, 
          status: 'skipped', 
          reason: 'up_to_date', 
          message: `Producto activo y actualizado - Precio ML: ${currentMLProduct.price} vs Calculado: ${priceCLP} (diferencia: ${priceDiff} CLP)`, 
          ml_id: existingProduct.ml_id, 
          title: currentMLProduct.title, 
          price: currentMLProduct.price, 
          timeElapsed: `${duration}s` 
        };
      }
      
      // Si necesita actualización, proceder
      if (needsUpdate) {
        await logStep("ACTUALIZAR", `Actualizando producto en ML: ${updatedFields.join(', ')}`, { 
          ml_id: existingProduct.ml_id,
          updates: updatedFields
        }, jobId);
      } else {
        await logStep("ACTUALIZAR", `Actualizando producto existente en ML: ${existingProduct.ml_id}`, null, jobId);
      }
      
      try {
        // ✅ REGLA CRÍTICA: Solo actualizar precio y título - NO descripción
        await logStep("UPDATE_PRICE_TITLE", `🔄 Actualizando SOLO precio y título en ML`, { 
          ml_id: existingProduct.ml_id,
          new_price: priceCLP,
          new_title: title,
          updated_fields: updatedFields
        }, jobId);
        
        await axiosWithSmartRetry(
          `https://api.mercadolibre.com/items/${existingProduct.ml_id}`,
          { 
            price: priceCLP,
            title: title  // Actualizar también el título
          },
          {
            method: 'put',
            headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
          }
        );
        
        // ✅ PROHIBIDO: NO actualizar descripción automáticamente
        // await postPlainDescription(existingProduct.ml_id, description, ML_ACCESS_TOKEN, productData);
        
        const updateMessage = updatedFields.length > 0 
          ? `✅ Producto actualizado en ML: ${updatedFields.join(', ')}` 
          : `✅ Producto actualizado en ML con ID: ${existingProduct.ml_id}`;
          
        await logDecision("ACTUALIZADO", updateMessage, { 
          ml_id: existingProduct.ml_id, 
          price: priceCLP,
          title: title,
          updatedFields: updatedFields
        }, jobId);
        
        // Actualizar en Supabase con el precio actual y título
        await supabase
          .from("published_products")
          .update({
            price: priceCLP,
            title: title,
            updated_at: new Date().toISOString(),
            euro_price: lowestOffer.price,
            status: "active"
          })
          .eq("kinguin_id", kinguinId);
      } catch (error) {
        // Si hay error al actualizar, intentar republicar
        await logStep("ERROR", `Error al actualizar: ${error.message}. Intentando republicar.`, { error: error.message }, jobId);
        
        // Eliminar el producto anterior
        try {
          await axiosWithSmartRetry(
            `https://api.mercadolibre.com/items/${existingProduct.ml_id}`,
            { status: "closed" },
            {
              method: 'put',
              headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
            }
          );
          await logStep("CERRAR", `Producto anterior cerrado: ${existingProduct.ml_id}`, null, jobId);
        } catch (closeError) {
          await logStep("ERROR", `Error al cerrar producto: ${closeError.message}`, { error: closeError.message }, jobId);
        }
        
        // Y continuar con la creación de un nuevo producto
        existingProduct = null;
      }
    }
    
    // Si no existe o no tiene ML ID, crear nuevo
    if (!existingProduct || !existingProduct.ml_id) {
      // Si existe en DB pero sin ML ID
      if (existingProduct && !existingProduct.ml_id) {
        await logStep("NUEVO", "Producto existente en DB pero sin ML ID. Creando nuevo en ML", { 
          kinguin_id: kinguinId 
        }, jobId);
      } else {
        await logStep("NUEVO", "Creando nuevo producto en ML", null, jobId);
      }
      
      const ML_USER_ID = process.env.ML_USER_ID;
      if (!ML_USER_ID) {
        throw new Error("Falta ML_USER_ID en variables de entorno");
      }
      
      // Extraer imágenes de Kinguin para gold_pro (portada primero + máximo 6 imágenes)
      let pictures = [];
      
      // 1. SIEMPRE comenzar con la portada si existe (estructura correcta de Kinguin API)
      if (productData.images && productData.images.cover && productData.images.cover.url) {
        pictures.push({ source: productData.images.cover.url });
        await logStep("IMAGES", "Portada agregada como imagen principal", { cover: productData.images.cover.url }, jobId);
      }
      
      // 2. Agregar screenshots adicionales hasta completar máximo 6 imágenes (estructura correcta de Kinguin API)
      if (productData.images && productData.images.screenshots && Array.isArray(productData.images.screenshots) && productData.images.screenshots.length > 0) {
        const remainingSlots = 6 - pictures.length; // Espacios restantes
        const additionalScreenshots = productData.images.screenshots
          .slice(0, remainingSlots)
          .map(screenshot => ({
            source: screenshot.url
          }));
        
        pictures.push(...additionalScreenshots);
        await logStep("IMAGES", `${additionalScreenshots.length} screenshots adicionales agregados`, { screenshots: additionalScreenshots.length }, jobId);
      }
      
      await logStep("IMAGES", `Total de imágenes preparadas: ${pictures.length}/6`, { total: pictures.length }, jobId);

      const mlItemData = {
        title,
        category_id: "MLC159270", // Videojuegos - categoría que funciona 100%
        price: priceCLP,
        currency_id: "CLP",
        available_quantity: 1,
        buying_mode: "buy_it_now",
        listing_type_id: "gold_pro", // Requiere imágenes pero las extraemos de Kinguin
        condition: "new",
        seller_custom_field: String(kinguinId), // 🔑 SKU CRÍTICO para detección de duplicados
        attributes: [
          {
            id: "COLLECTION",
            value_name: productData.name || "Videojuego Digital" // Usar nombre del producto
          },
          {
            id: "CONSOLE_VERSION",
            value_id: "59585252", // PC - SIEMPRE usar este value_id
            value_name: "PC" // Agregar también el value_name para evitar errores de resolución
          },
          {
            id: "EDITION", 
            value_name: productData.name || "Código Digital Standard"
          },
          {
            id: "EMPTY_GTIN_REASON",
            value_id: "17055159" // El producto es un kit o un pack
          },
          {
            id: "FORMAT",
            value_id: "2132699" // Digital
          },
          {
            id: "ITEM_CONDITION",
            value_id: "2230284" // Nuevo
          },
          {
            id: "PUBLISHERS",
            value_name: productData.publishers?.[0] || "Desarrollador Independiente" // Usar publishers de Kinguin
          },
          {
            id: "REGION",
            value_id: "1233475" // Global
          },
          {
            id: "SELLER_SKU",
            value_name: kinguinId.toString()
          },
          {
            id: "US_GAME_CLASSIFICATION",
            value_name: "RP (Rating Pending)"
          },
          {
            id: "VIDEO_GAME_PLATFORM",
            value_id: "126552" // PC
          },
          {
            id: "VIDEO_GAME_TITLE",
            value_name: productData.originalName || productData.name || "Videojuego Digital" // Usar originalName preferentemente
          }
        ],
        sale_terms: [
          {
            id: "WARRANTY_TYPE",
            value_name: "Garantía del vendedor"
          },
          {
            id: "WARRANTY_TIME", 
            value_name: "1 día"
          }
        ],
        shipping: {
          mode: "not_specified", // EXACTAMENTE como en MLC1698199965
          free_shipping: false,
          local_pick_up: false
        },
        // Descripción simple como texto plano
        description: {
          plain_text: description
        }
      };

      // Agregar imágenes solo si las tenemos (gold_pro las requiere)
      if (pictures.length > 0) {
        mlItemData.pictures = pictures;
        await logStep("IMAGES", `Agregando ${pictures.length} imágenes al producto`, { pictures: pictures.length }, jobId);
      } else {
        await logStep("IMAGES", "ADVERTENCIA: No se encontraron imágenes para gold_pro", null, jobId);
      }
      
      // Log detallado antes de crear el item en ML
      await logStep("ML_REQUEST", `Enviando producto a ML: ${title.substring(0, 30)}...`, {
        title: title,
        category_id: mlItemData.category_id,
        price: mlItemData.price,
        currency_id: mlItemData.currency_id,
        available_quantity: mlItemData.available_quantity,
        condition: mlItemData.condition,
        listing_type_id: mlItemData.listing_type_id
      }, jobId);
      
      // ✅ VERIFICACIÓN CRÍTICA: Comprobar duplicados por SKU en MercadoLibre ANTES de publicar
      await logStep("SKU_VERIFICATION", `🔍 Verificando SKU duplicado: ${kinguinId}`, { sku: kinguinId }, jobId);
      
      const skuCheck = await checkSkuDuplicateInMercadoLibre(kinguinId.toString(), ML_ACCESS_TOKEN, jobId);
      
      if (skuCheck.isDuplicate) {
        await logDecision("SKU_DUPLICATE_REJECTED", `🚫 PRODUCTO RECHAZADO - SKU ya existe en MercadoLibre`, {
          kinguin_id: kinguinId,
          duplicate_sku: kinguinId,
          existing_ml_id: skuCheck.existingItem.ml_id,
          existing_title: skuCheck.existingItem.title,
          existing_price: skuCheck.existingItem.price
        }, jobId);

        // Limpiar registro de procesamiento
        await supabase
          .from("published_products")
          .delete()
          .eq("kinguin_id", kinguinId)
          .eq("status", "processing")
          .is("ml_id", null);

        return {
          kinguinId,
          status: 'skipped',
          reason: 'sku_duplicate_in_mercadolibre',
          message: `SKU ${kinguinId} ya existe en MercadoLibre (ML ID: ${skuCheck.existingItem.ml_id})`,
          existing_item: skuCheck.existingItem,
          success: false
        };
      }
      
      await logStep("SKU_UNIQUE", `✅ SKU único confirmado, procediendo con publicación`, { sku: kinguinId }, jobId);
      
      // Crear el item en ML
      const { data: createdItem } = await axiosWithSmartRetry(
        "https://api.mercadolibre.com/items",
        mlItemData,
        {
          method: 'post',
          headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
        }
      );
      
      await logStep("CREADO", `Producto creado en ML con ID: ${createdItem.id}`, { ml_id: createdItem.id }, jobId);
      
      // Actualizar descripción
      await postPlainDescription(createdItem.id, description, ML_ACCESS_TOKEN, productData);
      await logStep("DESCRIPCION", "Descripción actualizada", null, jobId);
      
      // ✅ ACTUALIZAR el registro de "processing" con la información completa
      const { error: updateError } = await supabase
        .from("published_products")
        .update({
          ml_id: createdItem.id,
          price: priceCLP,
          euro_price: lowestOffer.price,
          title,
          platform,
          product_type: productType,
          updated_at: new Date().toISOString(),
          region: normalizedRegion,
          status: "active"
        })
        .eq("kinguin_id", kinguinId)
        .eq("status", "processing");
        
      if (updateError) {
        await logStep("ERROR", `Error actualizando registro en Supabase: ${updateError.message}`, { error: updateError }, jobId);
      } else {
        await logStep("SUPABASE_UPDATE", "Registro actualizado en Supabase exitosamente", { ml_id: createdItem.id }, jobId);
      }
      
      await logDecision("APROBADO", `Nuevo producto publicado en ML con ID: ${createdItem.id}`, { ml_id: createdItem.id, price: priceCLP }, jobId);
      
      duration = (Date.now() - startTime) / 1000;
      return { 
        kinguinId, 
        status: 'success', 
        reason: 'published', 
        message: `Nuevo producto publicado en MercadoLibre`, 
        ml_id: createdItem.id, 
        title, 
        price: priceCLP, 
        timeElapsed: `${duration}s` 
      };
    }
    
    duration = (Date.now() - startTime) / 1000;
    const finalUpdateMessage = updatedFields.length > 0 
      ? `Producto actualizado: ${updatedFields.join(', ')}` 
      : `Producto existente actualizado correctamente`;
      
    // Log adicional para mostrar claramente que se actualizó
    await logDecision("ACTUALIZADO", `${finalUpdateMessage} - ML ID: ${existingProduct.ml_id}`, { 
      ml_id: existingProduct.ml_id, 
      price: priceCLP,
      title: title,
      updatedFields: updatedFields,
      duration: `${duration}s`
    }, jobId);
      
    return { 
      kinguinId, 
      status: 'success', 
      reason: 'updated', 
      message: finalUpdateMessage, 
      ml_id: existingProduct.ml_id, 
      title, 
      price: priceCLP, 
      timeElapsed: `${duration}s` 
    };
  } catch (error) {
    duration = (Date.now() - startTime) / 1000;
    
    // Manejar específicamente los errores 400 de MercadoLibre con nuestro analizador especializado
    if (error.response?.status === 400) {
      // Analizar el error para determinar el tipo y posibles acciones
      const errorAnalysis = await analyzeMercadoLibreError(error, jobId);
      
      // Intentar recuperación automática si es posible
      if (existingProduct?.ml_id && errorAnalysis.recoveryAction?.canRetry) {
        await logStep("RECUPERACIÓN", `Intentando recuperación automática para error de tipo: ${errorAnalysis.category}`, null, jobId);
        
        const recoveryResult = await recoverFromMercadoLibreError(
          errorAnalysis,
          {
            ml_id: existingProduct.ml_id,
            ml_token: ML_ACCESS_TOKEN,
            title,
            description,
            productData
          },
          jobId
        );
        
        if (recoveryResult.success) {
          await logDecision("RECUPERADO", recoveryResult.message, { 
            ml_id: existingProduct.ml_id,
            updatedFields: recoveryResult.updatedFields
          }, jobId);
          
          return { 
            kinguinId, 
            status: 'partial_success', 
            ml_id: existingProduct.ml_id, 
            title, 
            recoveryAction: recoveryResult.message,
            timeElapsed: `${duration}s` 
          };
        } else {
          await logStep("ERROR", `Falló la recuperación automática: ${recoveryResult.message}`, null, jobId);
        }
      }
      
      // Log más detallado para errores de validación
      const errorDetails = error.response?.data;
      
      // Extraer información específica del error
      let detailedErrorMsg = 'Error de validación desconocido';
      let specificCause = '';
      
      if (errorDetails) {
        // Si hay un mensaje directo
        if (errorDetails.message) {
          detailedErrorMsg = errorDetails.message;
        }
        
        // Si hay errores específicos en cause (común en MercadoLibre)
        if (errorDetails.cause) {
          if (Array.isArray(errorDetails.cause)) {
            // Múltiples errores
            specificCause = errorDetails.cause.map(causeItem => 
              typeof causeItem === 'object' ? 
                `${causeItem.code}: ${causeItem.message}` : 
                causeItem.toString()
            ).join(' | ');
          } else if (typeof errorDetails.cause === 'object') {
            // Un solo error estructurado
            specificCause = `${errorDetails.cause.code || 'ERROR'}: ${errorDetails.cause.message || errorDetails.cause}`;
          } else {
            // Texto plano
            specificCause = errorDetails.cause.toString();
          }
          
          if (specificCause) {
            detailedErrorMsg = `${detailedErrorMsg} - ${specificCause}`;
          }
        }
        
        // Si no hay nada útil, mostrar el objeto completo (pero limitado)
        if (detailedErrorMsg === 'Error de validación desconocido' && !specificCause) {
          detailedErrorMsg = JSON.stringify(errorDetails).substring(0, 200);
        }
      }
        
      console.error(`💥 Error 400 procesando ${kinguinId} en ${duration}s:`, errorDetails);
      
      // Log específico con más detalles para debugging
      await logStep("ERROR", `Error 400 de MercadoLibre: ${detailedErrorMsg}`, { 
        errorType: errorAnalysis.category,
        errorDetails: errorDetails,
        specificCause: specificCause,
        recoveryAvailable: errorAnalysis.recoveryAction?.canRetry
      }, jobId);
      
      return { 
        kinguinId, 
        status: 'error', 
        reason: 'ml_validation_error', 
        message: errorAnalysis.message,
        cause: errorAnalysis.cause,
        category: errorAnalysis.category,
        recoveryAction: errorAnalysis.recoveryAction?.description,
        timeElapsed: `${duration}s` 
      };
    } 
    // Manejo general para otros errores
    else {
      await logDecision("ERROR", `Error procesando producto: ${error.message}`, { error: error.message }, jobId);
      
      // Extraer detalles de error de Axios
      const errorDetails = error.response?.data || error.message;
      console.error(`💥 Error procesando ${kinguinId} en ${duration}s:`, errorDetails);
      
      const errorMessage = (typeof error.response?.data === 'object' && error.response.data !== null)
        ? error.response.data.message || JSON.stringify(error.response.data)
        : (error.response?.data || error.message);

      // 🧹 LIMPIAR registro de "processing" si hay error
      try {
        await supabase
          .from("published_products")
          .delete()
          .eq("kinguin_id", kinguinId)
          .eq("status", "processing")
          .is("ml_id", null);
          
        await logStep("CLEANUP", `Registro de processing eliminado para Kinguin ID: ${kinguinId}`, { kinguin_id: kinguinId }, jobId);
      } catch (cleanupError) {
        await logStep("ERROR", `Error limpiando registro de processing: ${cleanupError.message}`, { error: cleanupError }, jobId);
      }

      return { 
        kinguinId, 
        status: 'error', 
        reason: 'general_error', 
        message: errorMessage, 
        timeElapsed: `${duration}s` 
      };
    }
  }
}

/**
 * Función principal que se ejecuta en segundo plano para procesar todos los productos.
 * Ahora también registra el progreso en Supabase.
 */
async function runProductProcessingJob(jobId, kinguinIds) {
  console.log(`🚀 [Job ID: ${jobId}] === INICIANDO runProductProcessingJob ===`);
  console.log(`🚀 [Job ID: ${jobId}] Productos a procesar: ${kinguinIds.length}`);
  console.log(`🚀 [Job ID: ${jobId}] Timestamp: ${new Date().toISOString()}`);
  
  try {
    console.log(`🎯 [Job ID: ${jobId}] Función runProductProcessingJob iniciada`);
    await logActivity(`Iniciando runProductProcessingJob para ${kinguinIds.length} productos`, 'info', { jobId, productCount: kinguinIds.length }, jobId);
    // 1. Obtener configuración de procesamiento
    let speedConfig;
    try {
      console.log(`⚙️ [Job ID: ${jobId}] Obteniendo configuración de velocidad...`);
      
      // Obtener configuración desde la API interna, funciona tanto en Vercel como en desarrollo local
      let apiUrl;
      if (process.env.VERCEL_URL) {
        // Estamos en Vercel, usar la URL completa
        apiUrl = `https://${process.env.VERCEL_URL}/api/optimize-speed`;
      } else {
        // Estamos en desarrollo local
        apiUrl = 'http://localhost:3000/api/optimize-speed';
      }
      
      // Usar timeout muy corto para evitar que se cuelgue
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 segundos máximo
      
      const speedConfigResponse = await fetch(apiUrl, {
        signal: controller.signal,
        timeout: 3000
      });
      clearTimeout(timeoutId);
      
      speedConfig = await speedConfigResponse.json();
      console.log(`✅ [Job ID: ${jobId}] Configuración de velocidad obtenida:`, speedConfig);
    } catch (configError) {
      console.warn(`⚠️ [Job ID: ${jobId}] Error obteniendo configuración (${configError.message}). Usando valores predeterminados.`);
      speedConfig = {
        concurrency: 15,
        batch_interval_ms: 100,
        max_retries: 5,
        base_delay_ms: 500,
        request_timeout_ms: 30000
      };
      console.log(`📋 [Job ID: ${jobId}] Usando configuración por defecto:`, speedConfig);
    }
    
    await logActivity(`Configuración aplicada: concurrencia=${speedConfig.concurrency}`, 'info', { speedConfig }, jobId);
    
    console.log(`🔑 [Job ID: ${jobId}] === OBTENIENDO TOKENS ===`);
    
    // Obtener tokens necesarios
    // Primero intentar desde Supabase, con fallback a variables de entorno directas de Vercel
    let ML_ACCESS_TOKEN;
    try {
      console.log(`🔐 [Job ID: ${jobId}] Obteniendo ML_ACCESS_TOKEN desde Supabase...`);
      ML_ACCESS_TOKEN = await getTokenFromSupabase("ML_ACCESS_TOKEN");
      console.log(`✅ [Job ID: ${jobId}] ML_ACCESS_TOKEN obtenido desde Supabase`);
    } catch (tokenError) {
      console.warn(`⚠️ [Job ID: ${jobId}] No se pudo obtener ML_ACCESS_TOKEN desde Supabase: ${tokenError.message}. Usando variable de entorno.`);
      ML_ACCESS_TOKEN = process.env.ML_ACCESS_TOKEN;
      console.log(`✅ [Job ID: ${jobId}] ML_ACCESS_TOKEN obtenido desde variables de entorno`);
    }
    
    // La API key de Kinguin siempre viene directamente de las variables de entorno de Vercel
    console.log(`🔐 [Job ID: ${jobId}] Obteniendo KINGUIN_API_KEY...`);
    const KINGUIN_API_KEY = process.env.KINGUIN_API_KEY;
    const MAX_RETRIES = speedConfig.max_retries || 3;
    console.log(`✅ [Job ID: ${jobId}] KINGUIN_API_KEY obtenida`);

    if (!ML_ACCESS_TOKEN || !KINGUIN_API_KEY) {
      throw new Error("Faltan credenciales (ML_ACCESS_TOKEN o KINGUIN_API_KEY)");
    }
    
    console.log(`🏁 [Job ID: ${jobId}] === INICIANDO PROCESAMIENTO PRINCIPAL ===`);
    await logActivity(`Iniciando procesamiento para ${kinguinIds.length} productos.`, 'info', null, jobId);
    console.log(`🚀 [Job ID: ${jobId}] Iniciando procesamiento para ${kinguinIds.length} productos.`);
    const CONCURRENCY_LIMIT = 50; // Procesa 50 productos por lote
    const allResults = [];

    // Deduplica IDs para evitar procesamiento duplicado
    const uniqueIds = [...new Set(kinguinIds.map(id => String(id)))]; 
    if (uniqueIds.length < kinguinIds.length) {
      console.log(`ℹ️ [Job ID: ${jobId}] Se encontraron ${kinguinIds.length - uniqueIds.length} IDs duplicados que serán ignorados.`);
    }

    for (let i = 0; i < uniqueIds.length; i += CONCURRENCY_LIMIT) {
      const chunk = uniqueIds.slice(i, i + CONCURRENCY_LIMIT);
      const currentBatch = Math.floor(i / CONCURRENCY_LIMIT) + 1;
      const totalBatches = Math.ceil(uniqueIds.length / CONCURRENCY_LIMIT);
      
      console.log(`--- [Job ID: ${jobId}] Procesando Lote ${currentBatch}/${totalBatches} (${chunk.length} productos) ---`);

      // Buscar productos existentes en la DB de forma segura con reintentos más rápidos
      let existingProductsInChunk = [];
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const { data, error } = await supabase
            .from("published_products")
            .select("kinguin_id, ml_id")
            .in("kinguin_id", chunk);
          
          if (error) throw new Error(`Error DB: ${error.message}`);
          existingProductsInChunk = data || [];
          break; // Éxito, salir del bucle de reintentos
        } catch (err) {
          if (attempt === MAX_RETRIES) {
            console.error(`⚠️ [Job ID: ${jobId}] Error al obtener productos existentes después de ${MAX_RETRIES} intentos: ${err.message}`);
            // Continuar con array vacío en último caso
          } else {
            console.warn(`⚠️ [Job ID: ${jobId}] Error al obtener productos existentes (intento ${attempt}): ${err.message}. Reintentando...`);
            await new Promise(r => setTimeout(r, 500 * attempt)); // Espera reducida a la mitad
          }
        }
      }
      
      const existingProductMap = new Map(existingProductsInChunk.map(product => [String(product.kinguin_id), product]));

      // Procesar con nuestro sistema inteligente de lotes
      console.log(`🔄 [Job ID: ${jobId}] Procesando lote ${currentBatch} con sistema optimizado de concurrencia`);
      await logActivity(`Iniciando procesamiento de lote ${currentBatch} con ${chunk.length} productos`, 'info', null, jobId);
      
      // Preparar las funciones de procesamiento
      const processFunctions = chunk.map(id => {
        return async () => {
          // Usar sistema de reintentos para cada producto individual CON TIMEOUT
          try {
            // Timeout de 60 segundos por producto
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout: Producto tomó más de 60 segundos')), 60000)
            );
            
            const processingPromise = processSingleProduct(
              id, 
              existingProductMap.get(String(id)), 
              { ML_ACCESS_TOKEN, KINGUIN_API_KEY }, 
              jobId
            );
            
            return await Promise.race([processingPromise, timeoutPromise]);
          } catch (err) {
            console.error(`❌ [Job ID: ${jobId}] Error procesando producto ${id}:`, err.message);
            // Devolver un objeto de error en lugar de lanzar la excepción
            return { 
              kinguinId: id, 
              status: 'error', 
              reason: err.message.includes('Timeout') ? 'timeout_error' : 'processing_error',
              message: err.message,
              timeElapsed: 'N/A'
            };
          }
        };
      });
      
      // Usar batchRequests para procesar con concurrencia controlada
      // Agregar timeout al lote completo para evitar cuelgues
      const batchTimeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Timeout: Lote ${currentBatch} tomó más de 5 minutos`)), 300000) // 5 minutos
      );
      
      const batchProcessingPromise = batchRequests(processFunctions, {
        concurrency: speedConfig.concurrency || 15, // Usar el valor configurado
        intervalMs: speedConfig.batch_interval_ms || 100,
        onProgress: (index, result) => {
          if (index % 5 === 0 || result.completed === chunk.length) {
            console.log(`📊 [Job ID: ${jobId}] Progreso del lote ${currentBatch}: ${result.completed}/${chunk.length}`);
          }
        }
      });
      
      const batchResults = await Promise.race([batchProcessingPromise, batchTimeoutPromise]);
      
      console.log(`✅ [Job ID: ${jobId}] Lote ${currentBatch} completado exitosamente`);
      await logActivity(`Lote ${currentBatch} completado: ${chunk.length} productos procesados`, 'info', null, jobId);
      
      // Mapear resultados para formato consistente
      const results = batchResults.map(result => result.success ? result.data : result.error);
      
      allResults.push(...results);

      await updateJobProgress(jobId, allResults); // Actualiza el progreso en la DB
      const processingSpeed = results.length > 0 
        ? (results.reduce((sum, r) => sum + (parseFloat(r.timeElapsed) || 0), 0) / results.length).toFixed(2)
        : "N/A";
        
      // Registrar estadísticas de progreso
      await logActivity(
        `Progreso: ${allResults.length}/${kinguinIds.length} productos procesados. Velocidad media: ${processingSpeed}s/producto.`,
        'info',
        {
          processed: allResults.length,
          total: kinguinIds.length,
          avgSpeed: processingSpeed,
          success: allResults.filter(result => result.status === 'success').length,
          failed: allResults.filter(result => result.status !== 'success').length
        },
        jobId
      );
      
      console.log(`📈 [Job ID: ${jobId}] Progreso: ${allResults.length}/${kinguinIds.length} productos procesados. Velocidad media: ${processingSpeed}s/producto.`);
    }

    const summary = allResults.reduce((acc, result) => {
      const key = result.status;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, { total: allResults.length });

    await completeJob(jobId, summary, allResults);
    
    // Registrar finalización exitosa
    await logActivity(
      `Procesamiento completado con éxito. Total: ${allResults.length}, Exitosos: ${summary.success || 0}, Errores: ${summary.failed || 0}`,
      'success',
      summary,
      jobId
    );
    
    console.log(`✅ [Job ID: ${jobId}] Procesamiento completado.`);
  } catch (err) {
    // Registrar error fatal
    await logActivity(
      `ERROR FATAL EN EL PROCESO: ${err.message}`,
      'error',
      err.response?.data || { message: err.message, stack: err.stack },
      jobId
    );
    
    console.error(`\n💥 [Job ID: ${jobId}] ERROR FATAL EN EL PROCESO:`, err.response?.data || err.message);
    await failJob(jobId, err);
  }
}

export default async function handler(req, res) {
  // Configurar un timeout de 60 segundos para la API route completa
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido, usa POST" });

  try {
    const { kinguinIds } = req.body;
    if (!Array.isArray(kinguinIds) || kinguinIds.length === 0) {
      return res.status(400).json({ error: "Se requiere un array 'kinguinIds'." });
    }

    // Optimizar - eliminar duplicados y validar formato al inicio
    const uniqueIds = [...new Set(kinguinIds.map(id => String(id).trim()))].filter(id => id);
    if (uniqueIds.length === 0) {
      return res.status(400).json({ error: "No hay IDs válidos para procesar" });
    }
    
    if (uniqueIds.length < kinguinIds.length) {
      console.log(`Optimización: Se eliminaron ${kinguinIds.length - uniqueIds.length} IDs duplicados`);
    }

    // 1. Crear un registro del "job" en Supabase
    console.log(`🔄 Creando job para ${uniqueIds.length} productos...`);
    const jobId = await createJob('add-product', uniqueIds);
    console.log(`✅ Job creado con ID: ${jobId}`);
    
    // Log inicial para confirmar que el job fue creado
    await logActivity(`Job ${jobId} creado para ${uniqueIds.length} productos`, 'info', { jobId, productCount: uniqueIds.length }, jobId);

    // 2. Iniciar el procesamiento en segundo plano (no esperamos a que termine)
    console.log(`🚀 Iniciando procesamiento en segundo plano para job ${jobId}...`);
    runProductProcessingJob(jobId, uniqueIds);

    // 3. Responder inmediatamente al cliente
    console.log(`📤 Respondiendo al cliente con jobId: ${jobId}`);
    return res.status(202).json({
      message: `El procesamiento ha comenzado en segundo plano para ${uniqueIds.length} productos.`,
      jobId: jobId,
    });

  } catch (err) {
    console.error(`\n💥 ERROR FATAL EN EL PROCESO:`, err.response?.data || err.message);
    return res.status(500).json({
      message: "❌ ERROR: Fallo el procesamiento por lotes",
      reason: "batch_error",
      error: err.response?.data || err.message,
    });
  }
}
