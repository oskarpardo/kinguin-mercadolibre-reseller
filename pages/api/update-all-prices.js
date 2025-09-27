/**
 * Endpoint para actualizar el precio de todos los productos activos
 * usando el tipo de cambio más reciente
 */
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { getEuroToClp, computePriceCLP, logActivity } from "./_logic";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") return res.status(200).end();
  
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Método no permitido. Usa POST." });
  }
  
  try {
    // 1. Obtener el tipo de cambio actual
    const currentFX = await getEuroToClp();
    
    if (!currentFX) {
      throw new Error("No se pudo obtener el tipo de cambio actual");
    }
    
    // 2. Obtener todos los productos activos
    const { data: activeProducts, error: queryError } = await supabase
      .from("published_products")
      .select("id, ml_id, kinguin_id, euro_price, price")
      .eq("status", "active");
    
    if (queryError) {
      throw new Error(`Error al consultar productos activos: ${queryError.message}`);
    }
    
    if (!activeProducts || activeProducts.length === 0) {
      return res.status(200).json({ 
        success: true, 
        message: "No hay productos activos para actualizar" 
      });
    }
    
    // 3. Registrar el inicio del proceso
    await logActivity(
      `Iniciando actualización de precios para ${activeProducts.length} productos con tipo de cambio ${currentFX}`,
      'info',
      { fx: currentFX, productCount: activeProducts.length }
    );
    
    // 4. Procesar productos en lotes para no sobrecargar la API
    const BATCH_SIZE = 50;
    let updatedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < activeProducts.length; i += BATCH_SIZE) {
      const batch = activeProducts.slice(i, i + BATCH_SIZE);
      const updates = [];
      
      // Procesar cada producto en el lote
      for (const product of batch) {
        try {
          // Solo actualizar si tiene euro_price
          if (product.euro_price && product.euro_price > 0) {
            // Calcular nuevo precio
            const { priceCLP } = await computePriceCLP(product.euro_price);
            
            if (priceCLP && priceCLP > 0) {
              // Si el precio es diferente, añadir a la lista de actualizaciones
              if (Math.abs(priceCLP - product.price) > 10) {
                updates.push({
                  id: product.id,
                  ml_id: product.ml_id,
                  kinguin_id: product.kinguin_id,
                  old_price: product.price,
                  new_price: priceCLP,
                  euro_price: product.euro_price
                });
              }
            }
          }
        } catch (error) {
          console.error(`Error procesando producto ${product.kinguin_id}:`, error);
          errorCount++;
        }
      }
      
      // Realizar actualizaciones en MercadoLibre y en Supabase
      for (const update of updates) {
        try {
          // Actualizar en MercadoLibre
          const ML_ACCESS_TOKEN = await getTokenFromSupabase("ML_ACCESS_TOKEN");
          
          await axios.put(
            `https://api.mercadolibre.com/items/${update.ml_id}`,
            { price: update.new_price },
            { headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` } }
          );
          
          // Actualizar en Supabase
          await supabase
            .from("published_products")
            .update({
              price: update.new_price,
              updated_at: new Date().toISOString()
            })
            .eq("id", update.id);
          
          updatedCount++;
          
          // Registrar la actualización
          await logActivity(
            `Precio actualizado para producto ${update.kinguin_id}: ${update.old_price} → ${update.new_price} CLP (${update.euro_price} EUR, FX: ${currentFX})`,
            'info',
            {
              kinguin_id: update.kinguin_id,
              ml_id: update.ml_id,
              old_price: update.old_price,
              new_price: update.new_price,
              euro_price: update.euro_price,
              fx: currentFX
            }
          );
        } catch (error) {
          console.error(`Error actualizando producto ${update.kinguin_id}:`, error);
          errorCount++;
        }
      }
      
      // Pequeña pausa entre lotes para no sobrecargar la API
      await new Promise(r => setTimeout(r, 1000));
      
      // Registrar progreso
      console.log(`Procesado lote ${Math.ceil(i/BATCH_SIZE) + 1} de ${Math.ceil(activeProducts.length/BATCH_SIZE)}`);
    }
    
    // 5. Registrar finalización
    await logActivity(
      `Actualización de precios completada: ${updatedCount} productos actualizados, ${errorCount} errores`,
      errorCount > 0 ? 'warning' : 'success',
      {
        total: activeProducts.length,
        updated: updatedCount,
        errors: errorCount,
        fx: currentFX
      }
    );
    
    // 6. Responder con el resultado
    return res.status(200).json({
      success: true,
      message: `Actualización de precios completada`,
      totalProducts: activeProducts.length,
      updatedProducts: updatedCount,
      errors: errorCount,
      currentFX: currentFX
    });
    
  } catch (error) {
    console.error("Error al actualizar precios:", error);
    return res.status(500).json({
      success: false,
      error: `Error al actualizar precios: ${error.message}`
    });
  }
}

// Función auxiliar para obtener token
async function getTokenFromSupabase(key) {
  try {
    const { data, error } = await supabase
      .from("tokens")
      .select("value")
      .eq("key", key)
      .single();

    if (error) throw error;
    return data?.value || process.env[key];
  } catch (err) {
    console.warn(`Error al obtener ${key} desde Supabase: ${err.message}. Usando variable de entorno.`);
    return process.env[key];
  }
}