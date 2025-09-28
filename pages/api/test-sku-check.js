// API endpoint para probar la verificación de SKU duplicado
// pages/api/test-sku-check.js

import { axiosWithSmartRetry } from "./_http-utils";
import { logStep } from "./_logic";

// Función copiada de add-product.js para probar
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
    
    console.log(`🔍 Verificando SKU ${sku} en ${allItems.length} productos activos`);
    
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
          console.log(`🚫 SKU DUPLICADO ENCONTRADO: ${sku} en ML ID: ${result.existingItem.ml_id}`);
          return result;
        }
      }
      
      // Rate limiting entre lotes
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`✅ SKU único verificado: ${sku}`);
    
    return {
      isDuplicate: false,
      existingItem: null
    };

  } catch (error) {
    console.error(`❌ Error verificando SKU: ${error.message}`);
    
    return {
      isDuplicate: false,
      existingItem: null,
      error: error.message
    };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido, usa POST" });

  try {
    const { sku, ml_token } = req.body;
    
    if (!sku) {
      return res.status(400).json({ error: "Se requiere 'sku'" });
    }
    
    // Usar token del body o variable de entorno
    const ML_ACCESS_TOKEN = ml_token || process.env.ML_ACCESS_TOKEN;
    
    if (!ML_ACCESS_TOKEN) {
      return res.status(400).json({ error: "Token de MercadoLibre requerido" });
    }

    console.log(`🔍 Iniciando verificación de SKU: ${sku}`);
    
    const result = await checkSkuDuplicateInMercadoLibre(sku.toString(), ML_ACCESS_TOKEN);
    
    return res.status(200).json({
      success: true,
      sku: sku,
      isDuplicate: result.isDuplicate,
      existingItem: result.existingItem,
      error: result.error,
      message: result.isDuplicate 
        ? `SKU ${sku} ya existe en MercadoLibre (ML ID: ${result.existingItem.ml_id})`
        : `SKU ${sku} es único y puede ser publicado`
    });

  } catch (error) {
    console.error("Error en test-sku-check:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
      message: "Error interno del servidor"
    });
  }
}