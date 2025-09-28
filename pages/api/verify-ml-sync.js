import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    console.log('🔍 Verificando sincronización BD vs MercadoLibre...');

    // 1. Obtener productos de nuestra BD
    const { data: localProducts, error: localError } = await supabase
      .from('published_products')
      .select('kinguin_id, ml_id, title, created_at')
      .not('ml_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);

    if (localError) throw localError;

    console.log(`📊 Productos en BD con ML_ID: ${localProducts.length}`);

    // 2. Verificar algunos productos en MercadoLibre
    const { data: tokenData } = await supabase
      .from('tokens')
      .select('value')
      .eq('key', 'ML_ACCESS_TOKEN')
      .single();

    if (!tokenData?.value) {
      throw new Error('No ML access token found');
    }

    const ML_ACCESS_TOKEN = tokenData.value;
    
    // 3. Verificar productos en ML
    const mlVerifications = [];
    
    for (let i = 0; i < Math.min(10, localProducts.length); i++) {
      const product = localProducts[i];
      
      try {
        const mlResponse = await fetch(
          `https://api.mercadolibre.com/items/${product.ml_id}`,
          {
            headers: {
              'Authorization': `Bearer ${ML_ACCESS_TOKEN}`
            }
          }
        );
        
        if (mlResponse.ok) {
          const mlData = await mlResponse.json();
          mlVerifications.push({
            kinguin_id: product.kinguin_id,
            ml_id: product.ml_id,
            status: 'exists_in_ml',
            ml_title: mlData.title?.slice(0, 50),
            ml_sku: mlData.seller_custom_field || 'No SKU',
            ml_status: mlData.status
          });
        } else {
          mlVerifications.push({
            kinguin_id: product.kinguin_id,
            ml_id: product.ml_id,
            status: 'not_found_in_ml',
            error: `HTTP ${mlResponse.status}`
          });
        }
      } catch (error) {
        mlVerifications.push({
          kinguin_id: product.kinguin_id,
          ml_id: product.ml_id,
          status: 'verification_error',
          error: error.message
        });
      }
    }

    // 4. Buscar duplicados por SKU en nuestra muestra
    const skuGroups = {};
    mlVerifications.forEach(item => {
      if (item.ml_sku && item.ml_sku !== 'No SKU') {
        if (!skuGroups[item.ml_sku]) {
          skuGroups[item.ml_sku] = [];
        }
        skuGroups[item.ml_sku].push(item);
      }
    });

    const duplicatedSkus = Object.entries(skuGroups).filter(([sku, items]) => items.length > 1);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      analysis: {
        products_in_database: localProducts.length,
        verified_in_ml: mlVerifications.length,
        duplicated_skus_found: duplicatedSkus.length
      },
      sample_verification: mlVerifications,
      duplicated_skus: duplicatedSkus.map(([sku, items]) => ({
        sku,
        count: items.length,
        items: items.map(item => ({
          kinguin_id: item.kinguin_id,
          ml_id: item.ml_id,
          title: item.ml_title
        }))
      })),
      recommendations: duplicatedSkus.length > 0 ? [
        '🚨 Duplicados por SKU detectados en MercadoLibre',
        'Los productos están únicos en tu BD pero duplicados en ML',
        'Problema likely en el proceso de publicación',
        'Necesitas limpiar duplicados directamente en MercadoLibre'
      ] : [
        '✅ No se detectaron duplicados por SKU en la muestra',
        'Sincronización BD-ML parece correcta'
      ]
    });

  } catch (error) {
    console.error('❌ Error en verificación:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}