import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('🚀 ANÁLISIS DE DUPLICADOS INICIADO - Versión 2.0');

  try {
    console.log('🔍 Iniciando análisis completo de duplicados...');
    
    // Primero obtener el conteo total
    const { count: totalCount, error: countError } = await supabase
      .from("published_products")
      .select("*", { count: 'exact', head: true })
      .neq("status", "closed_duplicate");
    
    if (countError) throw countError;
    
    console.log(`📊 Total productos encontrados: ${totalCount}`);
    
    // Obtener TODOS los productos en lotes para evitar límites
    const batchSize = 1000;
    const totalBatches = Math.ceil(totalCount / batchSize);
    let allProducts = [];
    
    for (let i = 0; i < totalBatches; i++) {
      const start = i * batchSize;
      console.log(`📥 Obteniendo lote ${i + 1}/${totalBatches} (${start} - ${start + batchSize})`);
      
      const { data: batch, error: batchError } = await supabase
        .from("published_products")
        .select("kinguin_id, id, ml_id, status, created_at, title")
        .neq("status", "closed_duplicate")
        .range(start, start + batchSize - 1);
      
      if (batchError) throw batchError;
      
      allProducts = allProducts.concat(batch || []);
    }
    
    console.log(`✅ Total productos cargados: ${allProducts.length}`);

    if (!allProducts || allProducts.length === 0) {
      return res.status(200).json({
        total_products: 0,
        duplicate_groups: 0,
        total_duplicated_records: 0,
        sample_duplicates: [],
        summary: {
          unique_products: 0,
          products_with_duplicates: 0,
          extra_duplicate_records: 0
        }
      });
    }

    // Agrupar por kinguin_id manualmente
    const groupedProducts = {};
    allProducts.forEach(product => {
      if (!groupedProducts[product.kinguin_id]) {
        groupedProducts[product.kinguin_id] = [];
      }
      groupedProducts[product.kinguin_id].push(product);
    });

    // Encontrar duplicados (grupos con más de 1 producto)
    const duplicates = [];
    const duplicateDetails = [];
    
    Object.entries(groupedProducts).forEach(([kinguin_id, products]) => {
      if (products.length > 1) {
        duplicates.push({
          kinguin_id,
          count: products.length
        });

        // Agregar detalles para los primeros 10
        if (duplicateDetails.length < 10) {
          duplicateDetails.push({
            kinguin_id,
            count: products.length,
            products: products.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          });
        }
      }
    });

    // Ordenar duplicados por cantidad (más duplicados primero)
    duplicates.sort((a, b) => b.count - a.count);

    const totalDuplicateRecords = duplicates.reduce((sum, d) => sum + d.count, 0);
    const wastedRecords = duplicates.reduce((sum, d) => sum + (d.count - 1), 0);
    const efficiencyPercentage = ((Object.keys(groupedProducts).length / allProducts.length) * 100).toFixed(2);
    
    console.log(`🔍 ANÁLISIS COMPLETADO:`);
    console.log(`  📊 Total productos: ${allProducts.length}`);
    console.log(`  🆔 Kinguin IDs únicos: ${Object.keys(groupedProducts).length}`);
    console.log(`  🔄 Grupos duplicados: ${duplicates.length}`);
    console.log(`  ❌ Registros desperdiciados: ${wastedRecords}`);
    console.log(`  ⚡ Eficiencia: ${efficiencyPercentage}%`);

    return res.status(200).json({
      analysis_complete: true,
      timestamp: new Date().toISOString(),
      total_products: allProducts.length,
      unique_kinguin_ids: Object.keys(groupedProducts).length,
      duplicate_groups: duplicates.length,
      total_duplicated_records: totalDuplicateRecords,
      wasted_records: wastedRecords,
      efficiency_percentage: efficiencyPercentage + '%',
      waste_percentage: ((wastedRecords / allProducts.length) * 100).toFixed(2) + '%',
      sample_duplicates: duplicateDetails.slice(0, 10),
      top_duplicates: duplicates.slice(0, 20).map(d => ({
        kinguin_id: d.kinguin_id,
        duplicate_count: d.count,
        waste: d.count - 1
      })),
      summary: {
        has_duplicates: duplicates.length > 0,
        unique_products: Object.keys(groupedProducts).length - duplicates.length,
        products_with_duplicates: duplicates.length,
        extra_duplicate_records: wastedRecords,
        recommendation: duplicates.length > 0 
          ? `¡ACCIÓN REQUERIDA! ${wastedRecords} registros duplicados encontrados - ejecutar cleanup`
          : 'Catálogo optimizado - no hay duplicados'
      }
    });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: 'Server error', 
      details: error.message 
    });
  }
}