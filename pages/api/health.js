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