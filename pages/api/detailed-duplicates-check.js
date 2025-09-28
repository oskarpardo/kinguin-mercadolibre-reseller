import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    // 1. Contar total de productos
    const { count: totalCount, error: countError } = await supabase
      .from('published_products')
      .select('*', { count: 'exact', head: true });

    if (countError) throw countError;

    console.log(`📊 Total productos en BD: ${totalCount}`);

    // 2. Obtener estadísticas de kinguin_id
    const { data: allProducts, error: fetchError } = await supabase
      .from('published_products')
      .select('kinguin_id, ml_id, created_at, title')
      .order('kinguin_id');

    if (fetchError) throw fetchError;

    // 3. Analizar duplicados manualmente
    const kinguinIdCount = new Map();
    const duplicateGroups = new Map();

    allProducts.forEach(product => {
      const kinguinId = String(product.kinguin_id);
      
      if (!kinguinIdCount.has(kinguinId)) {
        kinguinIdCount.set(kinguinId, []);
      }
      
      kinguinIdCount.get(kinguinId).push({
        ml_id: product.ml_id,
        created_at: product.created_at,
        title: product.title?.slice(0, 50) + '...'
      });
    });

    // 4. Identificar grupos duplicados
    for (const [kinguinId, products] of kinguinIdCount.entries()) {
      if (products.length > 1) {
        duplicateGroups.set(kinguinId, products);
      }
    }

    // 5. Estadísticas detalladas
    const stats = {
      total_products: totalCount,
      unique_kinguin_ids: kinguinIdCount.size,
      duplicate_groups: duplicateGroups.size,
      total_duplicated_records: Array.from(duplicateGroups.values()).reduce((sum, group) => sum + group.length, 0),
      largest_duplicate_group: duplicateGroups.size > 0 ? Math.max(...Array.from(duplicateGroups.values()).map(g => g.length)) : 0
    };

    // 6. Muestra de duplicados (primeros 10)
    const sampleDuplicates = Array.from(duplicateGroups.entries()).slice(0, 10).map(([kinguinId, products]) => ({
      kinguin_id: kinguinId,
      count: products.length,
      products: products.map(p => ({
        ml_id: p.ml_id,
        created_at: p.created_at,
        title: p.title
      }))
    }));

    console.log(`🔍 Duplicados encontrados: ${duplicateGroups.size} grupos`);
    console.log(`📈 Total registros duplicados: ${stats.total_duplicated_records}`);

    return res.status(200).json({
      status: 'success',
      timestamp: new Date().toISOString(),
      stats,
      sample_duplicates: sampleDuplicates,
      summary: {
        has_duplicates: duplicateGroups.size > 0,
        efficiency_loss: stats.total_duplicated_records - stats.unique_kinguin_ids,
        duplicate_percentage: ((stats.total_duplicated_records - stats.unique_kinguin_ids) / stats.total_products * 100).toFixed(2) + '%'
      }
    });

  } catch (error) {
    console.error('❌ Error checking duplicates:', error);
    return res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}