import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido, usa GET" });
  }

  // 🧹 FUNCIÓN ESPECIAL: Detectar duplicados en MercadoLibre por SKU
  if (req.query.action === 'detect_ml_duplicates') {
    try {
      console.log('🔍 Iniciando detección de duplicados en MercadoLibre...');

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

      // 2. Obtener info del usuario
      const userResponse = await fetch('https://api.mercadolibre.com/users/me', {
        headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
      });

      if (!userResponse.ok) throw new Error('Failed to get user info');

      const userData = await userResponse.json();
      console.log(`👤 Usuario: ${userData.nickname}`);

      // 3. Obtener productos activos (primeros 100 para análisis rápido)
      const itemsResponse = await fetch(
        `https://api.mercadolibre.com/users/${userData.id}/items/search?status=active&limit=100`,
        { headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` } }
      );

      if (!itemsResponse.ok) throw new Error('Failed to get items');

      const itemsData = await itemsResponse.json();
      console.log(`📊 Analizando ${itemsData.results.length} productos de ${itemsData.paging.total} totales`);

      // 4. Obtener detalles de cada producto para verificar SKUs
      const skuGroups = {};
      const processedItems = [];

      for (let i = 0; i < Math.min(50, itemsData.results.length); i++) {
        const itemId = itemsData.results[i];
        
        try {
          const detailResponse = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
            headers: { 'Authorization': `Bearer ${ML_ACCESS_TOKEN}` }
          });

          if (detailResponse.ok) {
            const itemDetail = await detailResponse.json();
            const sku = itemDetail.seller_custom_field || itemId;
            
            if (!skuGroups[sku]) {
              skuGroups[sku] = [];
            }
            
            const itemInfo = {
              ml_id: itemId,
              sku: sku,
              title: itemDetail.title?.slice(0, 60) + '...',
              created: itemDetail.date_created,
              price: itemDetail.price,
              status: itemDetail.status
            };
            
            skuGroups[sku].push(itemInfo);
            processedItems.push(itemInfo);
          }
        } catch (error) {
          console.error(`Error procesando ${itemId}:`, error.message);
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // 5. Identificar duplicados
      const duplicatedSkus = Object.entries(skuGroups).filter(([sku, items]) => items.length > 1);
      const totalDuplicates = duplicatedSkus.reduce((sum, [sku, items]) => sum + (items.length - 1), 0);

      console.log(`🔍 Duplicados encontrados: ${duplicatedSkus.length} SKUs con múltiples productos`);

      return res.status(200).json({
        success: true,
        action: 'detect_ml_duplicates',
        timestamp: new Date().toISOString(),
        analysis: {
          total_ml_products: itemsData.paging.total,
          analyzed_products: processedItems.length,
          unique_skus: Object.keys(skuGroups).length,
          duplicated_skus: duplicatedSkus.length,
          total_duplicate_items: totalDuplicates,
          efficiency: `${((Object.keys(skuGroups).length / processedItems.length) * 100).toFixed(1)}%`
        },
        duplicates_found: duplicatedSkus.map(([sku, items]) => ({
          sku,
          count: items.length,
          duplicate_count: items.length - 1,
          items: items.sort((a, b) => new Date(b.created) - new Date(a.created)).map(item => ({
            ml_id: item.ml_id,
            title: item.title,
            created: item.created,
            price: item.price,
            keep: items.indexOf(item) === 0 ? 'SÍ (más reciente)' : 'NO (eliminar)'
          }))
        })),
        summary: totalDuplicates > 0 ? 
          `🚨 ${totalDuplicates} productos duplicados encontrados que deben ser eliminados` :
          '✅ No se encontraron duplicados en la muestra analizada',
        next_steps: totalDuplicates > 0 ? [
          'Revisar lista de duplicados arriba',
          'Los productos más antiguos están marcados para eliminación',
          'Ejecutar limpieza automática si confirmas',
          `Potencial ahorro: ${totalDuplicates} productos eliminados`
        ] : ['Tu catálogo está optimizado']
      });

    } catch (error) {
      console.error('❌ Error detectando duplicados ML:', error);
      return res.status(500).json({
        success: false,
        error: error.message,
        action: 'detect_ml_duplicates'
      });
    }
  }

  const { id, action } = req.query;

  // Si no es una acción especial, requiere id
  if (!action && !id) {
    return res.status(400).json({ error: "Se requiere el parámetro 'id' del trabajo." });
  }

  // Si es job normal, continuar con la lógica original
  if (!action && id) {
    try {
      const { data, error } = await supabase
        .from("job_logs")
        .select("status, summary, results, total_products")
        .eq("id", id)
        .single();

      if (error) throw error;

      // Asegurarse de que 'results' sea siempre un array para evitar errores en el cliente.
      const responseData = { ...data, results: data.results || [] };

      return res.status(200).json(responseData);
    } catch (error) {
      return res.status(500).json({ error: "Error al consultar el estado del trabajo.", details: error.message });
    }
  }

  // Si llegamos aquí sin acción válida, error
  return res.status(400).json({ error: "Parámetros inválidos" });
}