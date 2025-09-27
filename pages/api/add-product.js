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
  logActivity
} from "./_logic";
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

// ---------- Logging ----------
async function logStep(step, message, data = null, jobId = null) {
  console.log(`🔄 [${step}] ${message}`);
  if (data) console.log(`📊 Datos:`, JSON.stringify(data, null, 2));
  
  // Registrar en sistema de logs
  await logActivity(
    `[${step}] ${message}`, 
    'info',
    data ? { data } : null,
    jobId
  );
}

async function logDecision(decision, reason, details = null, jobId = null) {
  const emoji = decision === 'APROBADO' ? '✅' : 
               decision === 'SKIP_OK' ? '✅' :  // Producto ya actualizado correctamente
               decision === 'ACTUALIZADO' ? '✅' :  // Producto actualizado exitosamente
               '❌';  // Solo errores reales
  const logType = decision.startsWith('[SKIP]') ? console.warn : console.log;
  logType(`${emoji} [${decision}] ${reason}`);
  if (details) console.log(`📊 Detalles:`, JSON.stringify(details, null, 2));
  
  // Registrar en sistema de logs
  await logActivity(
    `[${decision}] ${reason}`,
    decision === 'APROBADO' || decision === 'SKIP_OK' || decision === 'ACTUALIZADO' ? 'success' : 
    (decision.startsWith('[SKIP]') ? 'warning' : 'error'),
    details,
    jobId
  );
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
    
    // Verificar si el producto ya existe en la DB y si tiene un ML ID asociado
    if (existingProduct && existingProduct.ml_id) {
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
        
        await logStep("ML", `Estado en MercadoLibre: "${mlStatus}"`, { 
          ml_id: existingProduct.ml_id, 
          status: mlStatus 
        }, jobId);
        
        // Si el producto está publicado en ML, continuar con el proceso normal
        // Esto permitirá actualizar precio, título y descripción más adelante
      } catch (mlError) {
        // Si hay error al verificar estado (404 o producto no encontrado)
        if (mlError.response?.status === 404) {
          await logStep("ML", `Producto ya no existe en MercadoLibre: ${existingProduct.ml_id}`, null, jobId);
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
    const validOffers = productData.offers.filter(offer => {
      // Verificar precio
      const hasValidPrice = typeof offer.price === 'number' && offer.price > 0;
      if (!hasValidPrice) return false;
      
      // Verificar stock en cualquiera de sus posibles formatos
      const hasStock = (
        (typeof offer.quantity === 'number' && offer.quantity > 0) || 
        (typeof offer.qty === 'number' && offer.qty > 0) ||
        (typeof offer.quantityOffers === 'number' && offer.quantityOffers > 0) ||
        (typeof offer.stock === 'boolean' && offer.stock === true)
      );
      
      return hasValidPrice && hasStock;
    });
    
    const lowestOffer = [...validOffers].sort((a, b) => a.price - b.price)[0];
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
    
    // Validar precio para MercadoLibre
    if (!priceCLP || isNaN(priceCLP) || priceCLP < 100 || priceCLP > 50000000) {
      throw new Error(`Precio inválido para MercadoLibre: ${priceCLP} CLP. Debe estar entre 100 y 50,000,000 CLP`);
    }
    
    // Asegurar que el precio sea un entero (MercadoLibre CLP no acepta decimales)
    priceCLP = Math.round(priceCLP);
    
    // 6. Preparar datos para ML
    const productType = getProductType(productData);
    const rawTitle = titleFrom(productData, productType);
    
    // Validar y limpiar el título para MercadoLibre
    let title = rawTitle
      .replace(/[^\w\s\-|áéíóúñÁÉÍÓÚÑ]/g, '') // Solo caracteres seguros
      .replace(/\s+/g, ' ') // Limpiar espacios múltiples
      .trim();
    
    // Verificar longitud (MercadoLibre máximo 60 caracteres)
    if (title.length > 60) {
      title = title.substring(0, 57) + '...';
    }
    
    // Verificar que no esté vacío
    if (!title || title.length < 10) {
      throw new Error(`Título inválido o muy corto: "${title}"`);
    }
    const platform = normalizePlatform(productData.platform);
    const description = descriptionFrom(productData, productType);
    
    // 7. Publicar o actualizar en MercadoLibre
    // Si ya existe, verificar si necesita actualización
    if (existingProduct && existingProduct.ml_id) {
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
        
        // Verificar si la descripción necesita actualización
        try {
          const { data: currentDescription } = await axiosWithSmartRetry(
            `https://api.mercadolibre.com/items/${existingProduct.ml_id}/description`,
            null,
            {
              method: 'get',
              headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
            }
          );
          
          const currentDesc = currentDescription.plain_text || "";
          const expectedDesc = description.trim();
          
          if (currentDesc.trim() !== expectedDesc) {
            needsUpdate = true;
            updatedFields.push(`descripción actualizada`);
          }
        } catch (descError) {
          // Si no se puede obtener la descripción, asumimos que necesita actualización
          needsUpdate = true;
          updatedFields.push(`descripción (error al verificar)`);
        }
        
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
        // Actualizar precio y título en ML
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
        
        // Actualizar descripción en ML
        await postPlainDescription(existingProduct.ml_id, description, ML_ACCESS_TOKEN, productData);
        
        const updateMessage = updatedFields.length > 0 
          ? `Producto actualizado en ML: ${updatedFields.join(', ')}` 
          : `Producto actualizado en ML con ID: ${existingProduct.ml_id}`;
          
        await logDecision("APROBADO", updateMessage, { 
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
      
      // Guardar relación en Supabase
      await supabase.from("published_products").insert({
        kinguin_id: kinguinId,
        ml_id: createdItem.id,
        price: priceCLP,
        euro_price: lowestOffer.price,
        title,
        platform,
        product_type: productType,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        region: normalizedRegion,
        status: "active"
      });
      
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
            specificCause = errorDetails.cause.map(c => 
              typeof c === 'object' ? 
                `${c.code}: ${c.message}` : 
                c.toString()
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
      
      const existingProductMap = new Map(existingProductsInChunk.map(p => [String(p.kinguin_id), p]));

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
      const results = batchResults.map(r => r.success ? r.data : r.error);
      
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
          success: allResults.filter(r => r.status === 'success').length,
          failed: allResults.filter(r => r.status !== 'success').length
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
