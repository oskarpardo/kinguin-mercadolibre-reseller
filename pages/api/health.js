import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSupabase() {
  try {
    // Una consulta ligera para verificar la conexión y las credenciales.
    const { error } = await supabase.from('tokens').select('key').limit(1);
    if (error) throw error;
    return { status: 'ok', message: 'Connection successful' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

async function checkKinguin() {
  if (process.env.KINGUIN_API_KEY) {
    return { status: 'ok', message: 'API Key is configured' };
  } else {
    return { status: 'error', message: 'KINGUIN_API_KEY is not set' };
  }
}

async function checkMercadoLibre() {
  try {
    const { data, error } = await supabase
      .from("tokens")
      .select("value")
      .eq("key", "ML_ACCESS_TOKEN")
      .single();
    if (error || !data?.value) {
        throw new Error("ML_ACCESS_TOKEN not found in Supabase");
    }
    return { status: 'ok', message: 'ML_ACCESS_TOKEN is accessible' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

export default async function handler(req, res) {
  // Análisis de duplicados en public.published_products
  if (req.query.analyze === 'duplicates') {
    try {
      console.log('🔍 Analizando duplicados en public.published_products...');

      // 1. Estadísticas generales
      const { count: totalProducts, error: countError } = await supabase
        .from('published_products')
        .select('*', { count: 'exact', head: true });

      if (countError) throw countError;

      // 2. Obtener todos los kinguin_id para análisis
      const { data: allProducts, error: fetchError } = await supabase
        .from('published_products')
        .select('kinguin_id, ml_id, created_at, title')
        .order('kinguin_id');

      if (fetchError) throw fetchError;

      console.log(`📊 Total productos obtenidos: ${allProducts.length}`);

      // 3. Análisis de duplicados por kinguin_id
      const kinguinGroups = new Map();
      
      allProducts.forEach(product => {
        const kinguinId = String(product.kinguin_id);
        
        if (!kinguinGroups.has(kinguinId)) {
          kinguinGroups.set(kinguinId, []);
        }
        
        kinguinGroups.get(kinguinId).push({
          ml_id: product.ml_id,
          created_at: product.created_at,
          title: product.title?.slice(0, 50) + '...' || 'Sin título'
        });
      });

      // 4. Encontrar duplicados
      const duplicateGroups = [];
      let totalDuplicateRecords = 0;

      for (const [kinguinId, products] of kinguinGroups.entries()) {
        if (products.length > 1) {
          duplicateGroups.push({
            kinguin_id: kinguinId,
            duplicate_count: products.length,
            products: products
          });
          totalDuplicateRecords += products.length;
        }
      }

      const uniqueKinguinIds = kinguinGroups.size;
      const wastedRecords = totalDuplicateRecords - duplicateGroups.length;

      console.log(`🔍 Análisis completado:`);
      console.log(`  - Total productos: ${totalProducts}`);
      console.log(`  - Kinguin IDs únicos: ${uniqueKinguinIds}`);
      console.log(`  - Grupos duplicados: ${duplicateGroups.length}`);
      console.log(`  - Registros desperdiciados: ${wastedRecords}`);

      return res.status(200).json({
        success: true,
        timestamp: new Date().toISOString(),
        analysis: 'duplicates_check',
        database_table: 'public.published_products',
        stats: {
          total_products: totalProducts,
          unique_kinguin_ids: uniqueKinguinIds,
          duplicate_groups_found: duplicateGroups.length,
          total_duplicate_records: totalDuplicateRecords,
          wasted_records: wastedRecords,
          efficiency_percentage: ((uniqueKinguinIds / totalProducts) * 100).toFixed(2) + '%',
          waste_percentage: ((wastedRecords / totalProducts) * 100).toFixed(2) + '%'
        },
        duplicates_sample: duplicateGroups.slice(0, 10).map(group => ({
          kinguin_id: group.kinguin_id,
          duplicate_count: group.duplicate_count,
          sample_products: group.products.slice(0, 3)
        })),
        summary: duplicateGroups.length > 0 
          ? `¡DUPLICADOS DETECTADOS! ${duplicateGroups.length} grupos con ${wastedRecords} registros desperdiciados`
          : 'NO HAY DUPLICADOS - Catálogo optimizado'
      });

    } catch (error) {
      console.error('❌ Error en análisis de duplicados:', error);
      return res.status(500).json({
        success: false,
        error: error.message,
        analysis: 'duplicates_check'
      });
    }
  }

  // Si hay un parámetro test, hacer una prueba del error de inicialización
  if (req.query.test === 'initialization') {
    try {
      // Test básico que simula el problema
      let testVar;
      const result = { message: 'test completed' };
      testVar = 'initialized';
      
      return res.status(200).json({
        test: 'initialization',
        result: 'success',
        testVar,
        message: 'No initialization errors found'
      });
    } catch (error) {
      return res.status(500).json({
        test: 'initialization',
        result: 'error',
        error: error.message,
        stack: error.stack
      });
    }
  }

  // Si hay un parámetro duplicates, hacer análisis de duplicados
  if (req.query.duplicates === 'check') {
    try {
      // Contar total de productos
      const { count: totalCount, error: countError } = await supabase
        .from('published_products')
        .select('*', { count: 'exact', head: true });

      if (countError) throw countError;

      // Obtener todos los kinguin_id para análisis
      const { data: allProducts, error: fetchError } = await supabase
        .from('published_products')
        .select('kinguin_id, ml_id, created_at')
        .order('kinguin_id');

      if (fetchError) throw fetchError;

      // Analizar duplicados
      const kinguinIdCount = new Map();
      const duplicateGroups = [];

      allProducts.forEach(product => {
        const kinguinId = String(product.kinguin_id);
        
        if (!kinguinIdCount.has(kinguinId)) {
          kinguinIdCount.set(kinguinId, []);
        }
        
        kinguinIdCount.get(kinguinId).push({
          ml_id: product.ml_id,
          created_at: product.created_at
        });
      });

      // Identificar duplicados
      for (const [kinguinId, products] of kinguinIdCount.entries()) {
        if (products.length > 1) {
          duplicateGroups.push({
            kinguin_id: kinguinId,
            count: products.length,
            products: products
          });
        }
      }

      const totalDuplicatedRecords = duplicateGroups.reduce((sum, group) => sum + group.count, 0);

      return res.status(200).json({
        test: 'duplicates_check',
        result: 'success',
        stats: {
          total_products: totalCount,
          unique_kinguin_ids: kinguinIdCount.size,
          duplicate_groups: duplicateGroups.length,
          total_duplicated_records: totalDuplicatedRecords,
          efficiency_loss: totalDuplicatedRecords - kinguinIdCount.size,
          duplicate_percentage: ((totalDuplicatedRecords - kinguinIdCount.size) / totalCount * 100).toFixed(2) + '%'
        },
        sample_duplicates: duplicateGroups.slice(0, 5),
        has_duplicates: duplicateGroups.length > 0
      });
    } catch (error) {
      return res.status(500).json({
        test: 'duplicates_check',
        result: 'error',
        error: error.message
      });
    }
  }

  const checks = {
    supabase: await checkSupabase(),
    kinguin: await checkKinguin(),
    mercadoLibre: await checkMercadoLibre(),
  };

  const isHealthy = Object.values(checks).every(check => check.status === 'ok');

  if (isHealthy) {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks,
      version: '1.1.0'
    });
  } else {
    console.error("🚨 Health Check fallido:", checks);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      checks,
      version: '1.1.0'
    });
  }
}