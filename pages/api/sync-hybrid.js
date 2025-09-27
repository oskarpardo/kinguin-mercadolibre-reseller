// Sistema híbrido: Analiza productos existentes en tu catálogo + nuevos de Kinguin
// Combina datos de Supabase (productos ya publicados) con Kinguin API

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET method allowed' });
  }

  try {
    console.log('🔄 Iniciando análisis híbrido: Catálogo existente + Kinguin...');
    const startTime = Date.now();

    const { 
      sync_existing = 'true',
      add_new = 'true',
      limit = 1000
    } = req.query;

    // 1. Obtener productos existentes de tu catálogo en Supabase
    let existingProducts = [];
    if (sync_existing === 'true') {
      existingProducts = await getExistingCatalogProducts();
      console.log(`📦 Encontrados ${existingProducts.length} productos en tu catálogo`);
    }

    // 2. Obtener productos nuevos/actualizados de Kinguin
    let kinguinProducts = [];
    if (add_new === 'true') {
      kinguinProducts = await getKinguinProductsWithPriority(parseInt(limit));
      console.log(`🎮 Obtenidos ${kinguinProducts.length} productos de Kinguin`);
    }

    // 3. Combinar y analizar todos los productos
    const allProducts = await combineAndAnalyzeProducts(existingProducts, kinguinProducts);
    
    // 4. Clasificar por prioridad inteligente
    const classification = classifyProductsByIntelligentPriority(allProducts);
    
    // 5. Procesar según prioridad (actualizar existentes + agregar nuevos)
    const results = await processHybridProducts(classification, sync_existing === 'true');

    const executionTime = Math.round((Date.now() - startTime) / 1000);

    res.status(200).json({
      success: true,
      type: 'hybrid_sync',
      mode: {
        sync_existing: sync_existing === 'true',
        add_new: add_new === 'true'
      },
      analysis: results.analysis,
      processing: results.processing,
      execution_time_seconds: executionTime,
      recommendations: generateSyncRecommendations(results.analysis)
    });

  } catch (error) {
    console.error('🔄 Error en sync híbrido:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function getExistingCatalogProducts() {
  try {
    // Obtener productos de tu base de datos/catálogo existente
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    
    // Buscar en tabla de tokens (donde guardas los productos sincronizados)
    const { data: tokens, error } = await supabase
      .from('tokens')
      .select('*')
      .limit(5000); // Limitar para evitar timeout

    if (error) {
      console.error('Error obteniendo productos existentes:', error);
      return [];
    }

    console.log(`📊 Productos existentes en base de datos: ${tokens?.length || 0}`);

    // Transformar a formato estándar para análisis
    return (tokens || []).map(token => ({
      kinguinId: token.kinguin_id,
      mlId: token.ml_item_id,
      name: token.title,
      price: { amount: token.price },
      lastSync: token.updated_at,
      status: token.status,
      isExisting: true,
      daysSinceLastSync: Math.floor((new Date() - new Date(token.updated_at)) / (1000 * 60 * 60 * 24))
    }));

  } catch (error) {
    console.error('Error obteniendo catálogo existente:', error);
    return [];
  }
}

async function getKinguinProductsWithPriority(limit) {
  const endpoints = [
    {
      url: `https://api.kinguin.net/v1/products?sortBy=popularity&order=desc&limit=${Math.floor(limit * 0.4)}`,
      category: 'top_sellers',
      weight: 10
    },
    {
      url: `https://api.kinguin.net/v1/products?sortBy=releaseDate&order=desc&limit=${Math.floor(limit * 0.3)}`,
      category: 'new_releases',
      weight: 8
    },
    {
      url: `https://api.kinguin.net/v1/products?activePreorder=true&limit=${Math.floor(limit * 0.2)}`,
      category: 'preorders',
      weight: 9
    },
    {
      url: `https://api.kinguin.net/v1/products?hasDiscount=true&sortBy=discountPercentage&order=desc&limit=${Math.floor(limit * 0.1)}`,
      category: 'discounted',
      weight: 7
    }
  ];

  const allKinguinProducts = [];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        headers: { 'X-Api-Key': process.env.KINGUIN_API_KEY }
      });

      if (response.ok) {
        const data = await response.json();
        const products = (data.results || []).map(product => ({
          ...product,
          sourceCategory: endpoint.category,
          sourceWeight: endpoint.weight,
          isExisting: false
        }));
        
        allKinguinProducts.push(...products);
      }
    } catch (error) {
      console.error(`Error obteniendo ${endpoint.category}:`, error.message);
    }
  }

  return allKinguinProducts;
}

async function combineAndAnalyzeProducts(existingProducts, kinguinProducts) {
  console.log('🔄 Combinando productos existentes con nuevos de Kinguin...');
  
  const productMap = new Map();

  // Agregar productos existentes
  existingProducts.forEach(product => {
    if (product.kinguinId) {
      productMap.set(product.kinguinId, {
        ...product,
        priorityScore: 0,
        categories: [],
        needsUpdate: product.daysSinceLastSync > 1, // Actualizar si no se ha sincronizado en 24h
        action: 'update_existing'
      });
    }
  });

  // Agregar/actualizar con datos de Kinguin
  kinguinProducts.forEach(product => {
    const kinguinId = product.kinguinId;
    const existing = productMap.get(kinguinId);
    
    if (existing) {
      // Producto ya existe, actualizar información
      existing.name = product.name;
      existing.price = product.price;
      existing.platforms = product.platforms;
      existing.sourceCategory = product.sourceCategory;
      existing.sourceWeight = product.sourceWeight;
      existing.action = 'update_existing';
    } else {
      // Producto nuevo
      productMap.set(kinguinId, {
        ...product,
        priorityScore: 0,
        categories: [],
        isExisting: false,
        needsUpdate: true,
        action: 'add_new'
      });
    }
  });

  // Calcular scores para todos los productos
  const allProducts = Array.from(productMap.values());
  
  allProducts.forEach(product => {
    let score = 0;
    const categories = [];

    // Score base por categoría de origen
    if (product.sourceWeight) {
      score += product.sourceWeight * 50; // Base score
      categories.push(product.sourceCategory);
    }

    // Bonus por ser producto existente con ventas
    if (product.isExisting) {
      score += 200; // Bonus por tener historial
      categories.push('existing_catalog');
    }

    // Penalty por no actualizar hace tiempo
    if (product.isExisting && product.daysSinceLastSync > 7) {
      score += 300; // ALTO bonus por necesitar actualización urgente
      categories.push('needs_urgent_update');
    }

    // Score por novedad si es nuevo producto
    if (!product.isExisting) {
      const releaseDate = product.releaseDate ? new Date(product.releaseDate) : new Date('2020-01-01');
      const daysSinceRelease = Math.floor((new Date() - releaseDate) / (1000 * 60 * 60 * 24));
      
      if (daysSinceRelease <= 30) {
        score += 500 - (daysSinceRelease * 10);
        categories.push('new_release');
      }
    }

    product.priorityScore = score;
    product.categories = categories;
  });

  return allProducts;
}

function classifyProductsByIntelligentPriority(products) {
  // Ordenar por score
  products.sort((a, b) => b.priorityScore - a.priorityScore);

  const totalProducts = products.length;
  
  return {
    ultra: products.slice(0, Math.floor(totalProducts * 0.10)),    // Top 10% (productos críticos)
    high: products.slice(Math.floor(totalProducts * 0.10), Math.floor(totalProducts * 0.30)),  // 10-30%
    medium: products.slice(Math.floor(totalProducts * 0.30), Math.floor(totalProducts * 0.70)), // 30-70% 
    low: products.slice(Math.floor(totalProducts * 0.70))          // 70%+
  };
}

async function processHybridProducts(classification, shouldUpdateExisting) {
  console.log('⚡ Procesando productos híbridos...');
  
  const results = {
    analysis: {
      ultra: classification.ultra.length,
      high: classification.high.length,
      medium: classification.medium.length,
      low: classification.low.length,
      total: Object.values(classification).reduce((sum, arr) => sum + arr.length, 0)
    },
    processing: {
      existing_updated: 0,
      new_added: 0,
      skipped: 0,
      errors: 0
    }
  };

  // Procesar solo una muestra de cada prioridad para demo
  const sampleSizes = {
    ultra: Math.min(20, classification.ultra.length),
    high: Math.min(15, classification.high.length),  
    medium: Math.min(10, classification.medium.length),
    low: Math.min(5, classification.low.length)
  };

  for (const [priority, products] of Object.entries(classification)) {
    const sampleSize = sampleSizes[priority];
    const productsToProcess = products.slice(0, sampleSize);
    
    console.log(`🎯 Procesando ${priority}: ${productsToProcess.length} productos`);
    
    for (const product of productsToProcess) {
      try {
        if (shouldUpdateExisting || !product.isExisting) {
          // Simular procesamiento (en realidad llamaría a add-product)
          console.log(`${product.isExisting ? '🔄' : '✨'} ${product.action}: ${product.name?.slice(0, 30)}... (Score: ${product.priorityScore})`);
          
          if (product.isExisting) {
            results.processing.existing_updated++;
          } else {
            results.processing.new_added++;
          }
        } else {
          results.processing.skipped++;
        }
      } catch (error) {
        results.processing.errors++;
        console.error(`Error procesando ${product.kinguinId}:`, error.message);
      }
    }
  }

  return results;
}

function generateSyncRecommendations(analysis) {
  const recommendations = [];
  
  if (analysis.ultra > 0) {
    recommendations.push(`🚀 Priorizar ${analysis.ultra} productos ULTRA - actualizar cada 15 minutos`);
  }
  
  if (analysis.high > 0) {
    recommendations.push(`🔥 Monitorear ${analysis.high} productos HIGH - actualizar cada 30 minutos`);
  }
  
  if (analysis.medium > analysis.high) {
    recommendations.push(`📊 Gran catálogo MEDIUM (${analysis.medium}) - sincronizar cada 2 horas`);
  }
  
  if (analysis.low > analysis.total * 0.5) {
    recommendations.push(`📋 Muchos productos LOW (${analysis.low}) - considerar sync diario o semanal`);
  }

  return recommendations;
}