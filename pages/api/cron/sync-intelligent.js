// Sistema inteligente de clasificación de productos por prioridad
// Analiza métricas reales para determinar importancia

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET method allowed' });
  }

  try {
    console.log('🧠 Iniciando análisis inteligente de prioridades...');
    const startTime = Date.now();

    // 1. Obtener productos con múltiples métricas
    const analyzeProducts = await fetchProductsWithMetrics();
    
    // 2. Clasificar por algoritmo inteligente
    const classifiedProducts = classifyProductsByPriority(analyzeProducts);
    
    // 3. Procesar según prioridad determinada
    const results = await processClassifiedProducts(classifiedProducts);
    
    res.status(200).json({
      success: true,
      type: 'intelligent_priority',
      analysis: results.analysis,
      processed: results.processed,
      execution_time_seconds: Math.round((Date.now() - startTime) / 1000)
    });

  } catch (error) {
    console.error('🧠 Error en análisis inteligente:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

async function fetchProductsWithMetrics() {
  console.log('📊 Obteniendo productos con métricas múltiples...');
  
  const endpoints = [
    // Top sellers - alta popularidad
    {
      url: 'https://api.kinguin.net/v1/products?sortBy=popularity&order=desc&limit=1000',
      weight: 10, // Máximo peso para popularidad
      category: 'top_sellers'
    },
    // Nuevos lanzamientos - potencial alto
    {
      url: 'https://api.kinguin.net/v1/products?sortBy=releaseDate&order=desc&limit=500',
      weight: 8, // Alto peso para novedad
      category: 'new_releases'
    },
    // Pre-orders activos - demanda anticipada
    {
      url: 'https://api.kinguin.net/v1/products?activePreorder=true&limit=300',
      weight: 9, // Muy alto peso para pre-orders
      category: 'preorders'
    },
    // Productos con descuento - atractivos para ventas
    {
      url: 'https://api.kinguin.net/v1/products?hasDiscount=true&sortBy=discountPercentage&order=desc&limit=400',
      weight: 7, // Buen peso para ofertas
      category: 'discounted'
    },
    // Productos baratos - volumen alto
    {
      url: 'https://api.kinguin.net/v1/products?sortBy=price&order=asc&limit=600',
      weight: 5, // Peso medio para productos baratos
      category: 'budget'
    },
    // Productos caros - margen alto
    {
      url: 'https://api.kinguin.net/v1/products?sortBy=price&order=desc&limit=200',
      weight: 6, // Peso medio-alto para productos premium
      category: 'premium'
    }
  ];

  const productMetrics = new Map();

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        headers: { 'X-Api-Key': process.env.KINGUIN_API_KEY }
      });

      if (response.ok) {
        const data = await response.json();
        const products = data.results || [];

        products.forEach((product, index) => {
          const productId = product.kinguinId;
          
          if (!productMetrics.has(productId)) {
            productMetrics.set(productId, {
              ...product,
              priorityScore: 0,
              categories: [],
              positions: [],
              totalWeight: 0
            });
          }

          const existingProduct = productMetrics.get(productId);
          
          // Calcular score basado en posición y peso
          const positionScore = Math.max(1, (products.length - index) / products.length * 100);
          const weightedScore = positionScore * endpoint.weight;
          
          existingProduct.priorityScore += weightedScore;
          existingProduct.totalWeight += endpoint.weight;
          existingProduct.categories.push(endpoint.category);
          existingProduct.positions.push({
            category: endpoint.category,
            position: index + 1,
            total: products.length,
            score: positionScore
          });
        });
      }
    } catch (error) {
      console.error(`Error fetching ${endpoint.category}:`, error.message);
    }
  }

  return Array.from(productMetrics.values());
}

function classifyProductsByPriority(products) {
  console.log('🎯 Clasificando productos por prioridad inteligente...');
  
  // Normalizar scores
  products.forEach(product => {
    product.normalizedScore = product.priorityScore / Math.max(product.totalWeight, 1);
  });

  // Ordenar por score normalizado
  products.sort((a, b) => b.normalizedScore - a.normalizedScore);

  const totalProducts = products.length;
  const classification = {
    ultra: products.slice(0, Math.floor(totalProducts * 0.05)),    // Top 5%
    high: products.slice(Math.floor(totalProducts * 0.05), Math.floor(totalProducts * 0.20)),  // 5-20%
    medium: products.slice(Math.floor(totalProducts * 0.20), Math.floor(totalProducts * 0.50)), // 20-50%
    low: products.slice(Math.floor(totalProducts * 0.50))          // 50%+
  };

  console.log(`🎯 Clasificación inteligente:
    💎 ULTRA (Top 5%): ${classification.ultra.length} productos
    🔥 HIGH (Top 20%): ${classification.high.length} productos  
    📊 MEDIUM (Top 50%): ${classification.medium.length} productos
    📋 LOW (Resto): ${classification.low.length} productos`);

  return classification;
}

async function processClassifiedProducts(classification) {
  console.log('⚡ Procesando productos clasificados...');
  
  const results = {
    analysis: {
      ultra: await processProductGroup(classification.ultra, 'ultra', 50, 10000),
      high: await processProductGroup(classification.high, 'high', 30, 15000),
      medium: await processProductGroup(classification.medium, 'medium', 20, 20000),
      low: await processProductGroup(classification.low, 'low', 10, 30000)
    },
    processed: 0
  };

  // Contar total procesado
  Object.values(results.analysis).forEach(group => {
    results.processed += group.processed;
  });

  return results;
}

async function processProductGroup(products, priority, chunkSize, timeout) {
  if (!products.length) return { processed: 0, priority, details: [] };

  console.log(`🎯 Procesando grupo ${priority}: ${products.length} productos`);
  
  let processed = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // Procesar en chunks según prioridad
  for (let i = 0; i < Math.min(products.length, 100); i += chunkSize) {
    const chunk = products.slice(i, i + chunkSize);
    
    const promises = chunk.map(async (product) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const addResponse = await fetch(`${process.env.VERCEL_URL || 'https://kinguin-ml-reseller.vercel.app'}/api/add-product`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            productId: product.kinguinId,
            priority,
            intelligentScore: product.normalizedScore,
            categories: product.categories
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const result = await addResponse.json();
        
        if (addResponse.ok) {
          processed++;
          if (result.action === 'created') created++;
          else if (result.action === 'updated') updated++;
          else skipped++;
          return 'success';
        } else {
          errors++;
          return 'error';
        }
      } catch (error) {
        errors++;
        return 'error';
      }
    });

    await Promise.allSettled(promises);
    
    // Pausa adaptativa según prioridad
    if (priority !== 'ultra' && i + chunkSize < products.length) {
      const pauseTime = priority === 'high' ? 50 : priority === 'medium' ? 100 : 200;
      await new Promise(resolve => setTimeout(resolve, pauseTime));
    }
  }

  const topProducts = products.slice(0, 5).map(p => ({
    kinguinId: p.kinguinId,
    name: p.name?.slice(0, 50) + '...',
    score: Math.round(p.normalizedScore),
    categories: p.categories,
    price: p.price?.amount
  }));

  console.log(`✅ ${priority.toUpperCase()}: ${processed} procesados (${created} creados, ${updated} actualizados)`);

  return {
    processed,
    created,
    updated,
    skipped,
    errors,
    priority,
    top_products: topProducts,
    avg_score: Math.round(products.reduce((sum, p) => sum + p.normalizedScore, 0) / products.length)
  };
}