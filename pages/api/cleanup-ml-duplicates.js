import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST method allowed' });
  }

  try {
    console.log('🧹 Iniciando limpieza de duplicados en MercadoLibre...');

    // 1. Obtener token de ML
    const { data: tokenData } = await supabase
      .from('tokens')
      .select('value')
      .eq('key', 'ML_ACCESS_TOKEN')
      .single();

    if (!tokenData?.value) {
      throw new Error('No ML access token found');
    }

    const ML_ACCESS_TOKEN = tokenData.value;

    // 2. Obtener el user_id de MercadoLibre
    const userResponse = await fetch('https://api.mercadolibre.com/users/me', {
      headers: {
        'Authorization': `Bearer ${ML_ACCESS_TOKEN}`
      }
    });

    if (!userResponse.ok) {
      throw new Error('Failed to get user info from MercadoLibre');
    }

    const userData = await userResponse.json();
    const userId = userData.id;

    console.log(`👤 Usuario ML: ${userData.nickname} (ID: ${userId})`);

    // 3. Obtener TODOS los productos activos del usuario en ML
    let allMLItems = [];
    let offset = 0;
    const limit = 50;
    let hasMore = true;

    console.log('📥 Obteniendo productos de MercadoLibre...');

    while (hasMore) {
      const itemsResponse = await fetch(
        `https://api.mercadolibre.com/users/${userId}/items/search?status=active&offset=${offset}&limit=${limit}`,
        {
          headers: {
            'Authorization': `Bearer ${ML_ACCESS_TOKEN}`
          }
        }
      );

      if (!itemsResponse.ok) {
        console.error(`Error obteniendo items: ${itemsResponse.status}`);
        break;
      }

      const itemsData = await itemsResponse.json();
      
      if (itemsData.results && itemsData.results.length > 0) {
        allMLItems = allMLItems.concat(itemsData.results);
        offset += limit;
        console.log(`📊 Items obtenidos: ${allMLItems.length}/${itemsData.paging.total}`);
        
        if (allMLItems.length >= itemsData.paging.total) {
          hasMore = false;
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        hasMore = false;
      }
    }

    console.log(`✅ Total items en ML: ${allMLItems.length}`);

    // 4. Obtener detalles de cada producto para revisar SKUs
    console.log('🔍 Analizando SKUs para detectar duplicados...');
    
    const skuGroups = {};
    const itemDetails = [];
    
    // Procesar en lotes para evitar rate limits
    const batchSize = 10;
    
    for (let i = 0; i < allMLItems.length; i += batchSize) {
      const batch = allMLItems.slice(i, i + batchSize);
      
      console.log(`📊 Procesando lote ${Math.floor(i/batchSize) + 1}/${Math.ceil(allMLItems.length/batchSize)}`);
      
      const batchPromises = batch.map(async (itemId) => {
        try {
          const response = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
            headers: {
              'Authorization': `Bearer ${ML_ACCESS_TOKEN}`
            }
          });
          
          if (response.ok) {
            const itemData = await response.json();
            const sku = itemData.seller_custom_field || itemData.id; // Usar ML_ID como fallback
            
            return {
              ml_id: itemData.id,
              title: itemData.title,
              sku: sku,
              status: itemData.status,
              created: itemData.date_created,
              price: itemData.price
            };
          }
          return null;
        } catch (error) {
          console.error(`Error obteniendo detalles de ${itemId}:`, error.message);
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      const validResults = batchResults.filter(item => item !== null);
      
      itemDetails.push(...validResults);
      
      // Rate limiting entre lotes
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // 5. Agrupar por SKU para encontrar duplicados
    itemDetails.forEach(item => {
      if (!skuGroups[item.sku]) {
        skuGroups[item.sku] = [];
      }
      skuGroups[item.sku].push(item);
    });

    // 6. Identificar duplicados
    const duplicatedSkus = Object.entries(skuGroups).filter(([sku, items]) => items.length > 1);
    
    console.log(`🔍 Duplicados encontrados: ${duplicatedSkus.length} SKUs con múltiples productos`);

    // 7. Preparar reporte de duplicados
    const duplicateReport = duplicatedSkus.map(([sku, items]) => {
      // Ordenar por fecha (mantener el más reciente)
      const sortedItems = items.sort((a, b) => new Date(b.created) - new Date(a.created));
      const keepItem = sortedItems[0];
      const duplicateItems = sortedItems.slice(1);
      
      return {
        sku,
        total_count: items.length,
        duplicate_count: duplicateItems.length,
        keep_item: {
          ml_id: keepItem.ml_id,
          title: keepItem.title?.slice(0, 60) + '...',
          created: keepItem.created,
          reason: 'más reciente'
        },
        duplicate_items: duplicateItems.map(item => ({
          ml_id: item.ml_id,
          title: item.title?.slice(0, 60) + '...',
          created: item.created,
          action: 'marcar para eliminación'
        }))
      };
    });

    const totalDuplicateItems = duplicateReport.reduce((sum, group) => sum + group.duplicate_count, 0);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      analysis: {
        total_ml_items: allMLItems.length,
        items_analyzed: itemDetails.length,
        unique_skus: Object.keys(skuGroups).length,
        duplicated_skus: duplicatedSkus.length,
        total_duplicate_items: totalDuplicateItems,
        efficiency_percentage: ((Object.keys(skuGroups).length / itemDetails.length) * 100).toFixed(2) + '%'
      },
      duplicate_report: duplicateReport.slice(0, 20), // Mostrar solo los primeros 20
      summary: {
        duplicates_found: totalDuplicateItems > 0,
        action_needed: totalDuplicateItems > 0 ? `Eliminar ${totalDuplicateItems} productos duplicados` : 'No hay duplicados',
        potential_savings: `${totalDuplicateItems} productos pueden ser eliminados`
      },
      next_steps: totalDuplicateItems > 0 ? [
        '1. Revisar la lista de duplicados',
        '2. Confirmar que quieres eliminar los productos más antiguos',
        '3. Ejecutar el proceso de eliminación automática',
        '4. Verificar que los productos correctos se mantuvieron activos'
      ] : [
        '✅ No hay duplicados para limpiar',
        '🎯 Tu catálogo de MercadoLibre está optimizado'
      ]
    });

  } catch (error) {
    console.error('❌ Error en limpieza de duplicados ML:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}