// API para obtener análisis de prioridades sin procesar productos
// Útil para debugging y monitoreo

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET method allowed' });
  }

  try {
    console.log('🔍 Analizando prioridades de productos...');
    const startTime = Date.now();

    const { 
      sample_size = 500,
      include_details = 'true' 
    } = req.query;

    // Obtener muestra de productos con múltiples criterios
    const endpoints = [
      {
        url: `https://api.kinguin.net/v1/products?sortBy=popularity&order=desc&limit=${Math.floor(sample_size * 0.4)}`,
        category: 'top_sellers',
        weight: 10
      },
      {
        url: `https://api.kinguin.net/v1/products?sortBy=releaseDate&order=desc&limit=${Math.floor(sample_size * 0.2)}`,
        category: 'new_releases', 
        weight: 8
      },
      {
        url: `https://api.kinguin.net/v1/products?activePreorder=true&limit=${Math.floor(sample_size * 0.1)}`,
        category: 'preorders',
        weight: 9
      },
      {
        url: `https://api.kinguin.net/v1/products?hasDiscount=true&sortBy=discountPercentage&order=desc&limit=${Math.floor(sample_size * 0.3)}`,
        category: 'discounted',
        weight: 7
      }
    ];

    const productAnalysis = new Map();
    let totalProductsFetched = 0;

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint.url, {
          headers: { 'X-Api-Key': process.env.KINGUIN_API_KEY }
        });

        if (response.ok) {
          const data = await response.json();
          const products = data.results || [];
          totalProductsFetched += products.length;

          products.forEach((product, index) => {
            const id = product.kinguinId;
            
            if (!productAnalysis.has(id)) {
              productAnalysis.set(id, {
                kinguinId: id,
                name: product.name,
                price: product.price,
                releaseDate: product.releaseDate,
                platforms: product.platforms,
                priorityScore: 0,
                categories: [],
                metrics: {}
              });
            }

            const existing = productAnalysis.get(id);
            const positionScore = (products.length - index) / products.length * 100;
            const weightedScore = positionScore * endpoint.weight;

            existing.priorityScore += weightedScore;
            existing.categories.push(endpoint.category);
            existing.metrics[endpoint.category] = {
              position: index + 1,
              total: products.length,
              position_percentile: Math.round(positionScore),
              weight: endpoint.weight,
              weighted_score: Math.round(weightedScore)
            };
          });
        }
      } catch (error) {
        console.error(`Error fetching ${endpoint.category}:`, error.message);
      }
    }

    // Convertir a array y calcular percentiles
    const allProducts = Array.from(productAnalysis.values());
    allProducts.sort((a, b) => b.priorityScore - a.priorityScore);

    // Calcular rangos de prioridad
    const totalProducts = allProducts.length;
    const priorities = {
      ultra: {
        threshold: 0.05, // Top 5%
        products: [],
        description: 'Ultra High Priority - Top sellers + New releases + Preorders'
      },
      high: {
        threshold: 0.20, // Top 20%  
        products: [],
        description: 'High Priority - Popular + Recent + Discounted'
      },
      medium: {
        threshold: 0.50, // Top 50%
        products: [],
        description: 'Medium Priority - Good sellers + Decent prices'
      },
      low: {
        threshold: 1.0, // Resto
        products: [],
        description: 'Low Priority - Long tail products'
      }
    };

    // Clasificar productos
    allProducts.forEach((product, index) => {
      const percentile = index / totalProducts;
      
      if (percentile <= 0.05) {
        product.priority = 'ultra';
        priorities.ultra.products.push(product);
      } else if (percentile <= 0.20) {
        product.priority = 'high';
        priorities.high.products.push(product);
      } else if (percentile <= 0.50) {
        product.priority = 'medium';
        priorities.medium.products.push(product);
      } else {
        product.priority = 'low';
        priorities.low.products.push(product);
      }
    });

    // Estadísticas por categoría
    const categoryStats = {};
    ['top_sellers', 'new_releases', 'preorders', 'discounted'].forEach(cat => {
      const inCategory = allProducts.filter(p => p.categories.includes(cat));
      categoryStats[cat] = {
        total: inCategory.length,
        avg_score: Math.round(inCategory.reduce((sum, p) => sum + p.priorityScore, 0) / inCategory.length),
        in_ultra: inCategory.filter(p => p.priority === 'ultra').length,
        in_high: inCategory.filter(p => p.priority === 'high').length
      };
    });

    const executionTime = Math.round((Date.now() - startTime) / 1000);

    const response = {
      success: true,
      analysis: {
        total_products_analyzed: totalProducts,
        total_products_fetched: totalProductsFetched,
        execution_time_seconds: executionTime,
        priorities: {
          ultra: {
            count: priorities.ultra.products.length,
            percentage: Math.round((priorities.ultra.products.length / totalProducts) * 100),
            avg_score: Math.round(priorities.ultra.products.reduce((sum, p) => sum + p.priorityScore, 0) / priorities.ultra.products.length),
            description: priorities.ultra.description
          },
          high: {
            count: priorities.high.products.length,
            percentage: Math.round((priorities.high.products.length / totalProducts) * 100),
            avg_score: Math.round(priorities.high.products.reduce((sum, p) => sum + p.priorityScore, 0) / priorities.high.products.length),
            description: priorities.high.description
          },
          medium: {
            count: priorities.medium.products.length,
            percentage: Math.round((priorities.medium.products.length / totalProducts) * 100),
            avg_score: Math.round(priorities.medium.products.reduce((sum, p) => sum + p.priorityScore, 0) / priorities.medium.products.length),
            description: priorities.medium.description
          },
          low: {
            count: priorities.low.products.length,
            percentage: Math.round((priorities.low.products.length / totalProducts) * 100),
            avg_score: priorities.low.products.length > 0 ? Math.round(priorities.low.products.reduce((sum, p) => sum + p.priorityScore, 0) / priorities.low.products.length) : 0,
            description: priorities.low.description
          }
        },
        category_breakdown: categoryStats
      }
    };

    // Incluir ejemplos si se solicita
    if (include_details === 'true') {
      response.examples = {
        ultra_priority: priorities.ultra.products.slice(0, 3).map(p => ({
          id: p.kinguinId,
          name: p.name?.slice(0, 60),
          score: Math.round(p.priorityScore),
          categories: p.categories,
          price: p.price?.amount,
          metrics: p.metrics
        })),
        high_priority: priorities.high.products.slice(0, 3).map(p => ({
          id: p.kinguinId,
          name: p.name?.slice(0, 60),
          score: Math.round(p.priorityScore),
          categories: p.categories,
          price: p.price?.amount
        })),
        medium_priority: priorities.medium.products.slice(0, 3).map(p => ({
          id: p.kinguinId,
          name: p.name?.slice(0, 60),
          score: Math.round(p.priorityScore),
          categories: p.categories,
          price: p.price?.amount
        }))
      };
    }

    console.log(`🔍 Análisis completado: ${totalProducts} productos clasificados en ${executionTime}s`);

    res.status(200).json(response);

  } catch (error) {
    console.error('🔍 Error en análisis:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}