import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔍 INICIANDO ANÁLISIS COMPLETO DE 18K+ PRODUCTOS...');
    
    // 1. Obtener conteo total exacto
    const { count: totalCount, error: countError } = await supabase
      .from("published_products")
      .select("*", { count: 'exact', head: true });
    
    if (countError) throw countError;
    
    console.log(`📊 Total productos en BD: ${totalCount}`);
    
    // 2. Obtener TODOS los productos en lotes
    const batchSize = 1000;
    const totalBatches = Math.ceil(totalCount / batchSize);
    let allProducts = [];
    
    console.log(`📥 Procesando ${totalBatches} lotes de ${batchSize} productos cada uno...`);
    
    for (let i = 0; i < totalBatches; i++) {
      const start = i * batchSize;
      console.log(`⏳ Lote ${i + 1}/${totalBatches} - Productos ${start} a ${start + batchSize - 1}`);
      
      const { data: batch, error: batchError } = await supabase
        .from("published_products")
        .select("kinguin_id, id, ml_id, status, created_at, title")
        .range(start, start + batchSize - 1);
      
      if (batchError) {
        console.error(`❌ Error en lote ${i + 1}:`, batchError);
        throw batchError;
      }
      
      if (batch && batch.length > 0) {
        allProducts = allProducts.concat(batch);
        console.log(`✅ Lote ${i + 1} completado: ${batch.length} productos agregados`);
      }
    }
    
    console.log(`✅ CARGA COMPLETA: ${allProducts.length} productos cargados`);

    if (!allProducts || allProducts.length === 0) {
      return res.status(200).json({
        error: 'No products found',
        total_products: 0
      });
    }

    // 3. Análisis de duplicados
    console.log('🔍 Analizando duplicados...');
    const kinguinGroups = {};
    
    allProducts.forEach((product, index) => {
      if (index % 1000 === 0) {
        console.log(`📊 Procesando producto ${index + 1}/${allProducts.length}`);
      }
      
      const kinguinId = String(product.kinguin_id);
      if (!kinguinGroups[kinguinId]) {
        kinguinGroups[kinguinId] = [];
      }
      kinguinGroups[kinguinId].push(product);
    });

    // 4. Identificar duplicados
    const duplicateGroups = [];
    let totalDuplicateRecords = 0;
    
    Object.entries(kinguinGroups).forEach(([kinguinId, products]) => {
      if (products.length > 1) {
        duplicateGroups.push({
          kinguin_id: kinguinId,
          count: products.length,
          products: products.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        });
        totalDuplicateRecords += products.length;
      }
    });

    // 5. Ordenar por mayor cantidad de duplicados
    duplicateGroups.sort((a, b) => b.count - a.count);
    
    const uniqueKinguinIds = Object.keys(kinguinGroups).length;
    const wastedRecords = totalDuplicateRecords - duplicateGroups.length;
    const efficiencyPercentage = ((uniqueKinguinIds / allProducts.length) * 100).toFixed(2);
    const wastePercentage = ((wastedRecords / allProducts.length) * 100).toFixed(2);
    
    console.log(`🎯 ANÁLISIS COMPLETADO:`);
    console.log(`  📊 Total productos: ${allProducts.length}`);
    console.log(`  🆔 Kinguin IDs únicos: ${uniqueKinguinIds}`);
    console.log(`  🔄 Grupos duplicados: ${duplicateGroups.length}`);
    console.log(`  ❌ Registros desperdiciados: ${wastedRecords}`);
    console.log(`  ⚡ Eficiencia: ${efficiencyPercentage}%`);
    console.log(`  🗑️ Desperdicio: ${wastePercentage}%`);

    return res.status(200).json({
      success: true,
      analysis_complete: true,
      timestamp: new Date().toISOString(),
      database_stats: {
        total_products_analyzed: allProducts.length,
        unique_kinguin_ids: uniqueKinguinIds,
        duplicate_groups_found: duplicateGroups.length,
        total_duplicate_records: totalDuplicateRecords,
        wasted_records: wastedRecords,
        efficiency_percentage: efficiencyPercentage + '%',
        waste_percentage: wastePercentage + '%'
      },
      duplicate_analysis: {
        has_duplicates: duplicateGroups.length > 0,
        worst_offenders: duplicateGroups.slice(0, 20).map(group => ({
          kinguin_id: group.kinguin_id,
          duplicate_count: group.count,
          waste_count: group.count - 1,
          sample_title: group.products[0]?.title?.slice(0, 60) + '...' || 'Sin título'
        }))
      },
      recommendations: duplicateGroups.length > 0 ? [
        `🚨 DUPLICADOS ENCONTRADOS: ${duplicateGroups.length} grupos`,
        `💸 DESPERDICIO: ${wastedRecords} registros (${wastePercentage}% del total)`,
        `⚡ EFICIENCIA ACTUAL: ${efficiencyPercentage}%`,
        '🔧 ACCIÓN RECOMENDADA: Ejecutar limpieza de duplicados',
        `💰 AHORRO POTENCIAL: ${wastedRecords} espacios liberados`
      ] : [
        '✅ NO HAY DUPLICADOS DETECTADOS',
        '🎯 CATÁLOGO OPTIMIZADO AL 100%',
        '🚀 SISTEMA FUNCIONANDO EFICIENTEMENTE'
      ]
    });
    
  } catch (error) {
    console.error('❌ Error en análisis completo:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Analysis failed', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}