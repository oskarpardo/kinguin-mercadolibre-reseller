// API de prueba para demostrar el sistema de priorización
// Usa datos simulados para mostrar cómo funciona la clasificación

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET method allowed' });
  }

  try {
    console.log('🎯 Demostrando clasificación inteligente con datos de muestra...');
    const startTime = Date.now();

    // Datos de muestra que simulan la respuesta de Kinguin API
    const sampleProducts = [
      // Ultra Priority - Top sellers
      { kinguinId: 12345, name: 'Cyberpunk 2077', popularity: 98, releaseDate: '2024-09-15', price: { amount: 59.99 }, hasDiscount: true, discountPercentage: 30, activePreorder: false },
      { kinguinId: 12346, name: 'GTA VI', popularity: 95, releaseDate: '2024-09-20', price: { amount: 69.99 }, hasDiscount: false, discountPercentage: 0, activePreorder: true },
      { kinguinId: 12347, name: 'Call of Duty MW3', popularity: 92, releaseDate: '2024-09-10', price: { amount: 59.99 }, hasDiscount: true, discountPercentage: 25, activePreorder: false },
      
      // High Priority - Good sellers  
      { kinguinId: 12348, name: 'Assassins Creed Mirage', popularity: 85, releaseDate: '2024-08-15', price: { amount: 49.99 }, hasDiscount: true, discountPercentage: 20, activePreorder: false },
      { kinguinId: 12349, name: 'Spider-Man 2', popularity: 82, releaseDate: '2024-08-20', price: { amount: 59.99 }, hasDiscount: false, discountPercentage: 0, activePreorder: false },
      { kinguinId: 12350, name: 'FIFA 24', popularity: 80, releaseDate: '2024-07-01', price: { amount: 39.99 }, hasDiscount: true, discountPercentage: 15, activePreorder: false },
      
      // Medium Priority - Decent sellers
      { kinguinId: 12351, name: 'Starfield Expansion', popularity: 65, releaseDate: '2024-06-15', price: { amount: 29.99 }, hasDiscount: false, discountPercentage: 0, activePreorder: false },
      { kinguinId: 12352, name: 'Baldurs Gate 3 DLC', popularity: 62, releaseDate: '2024-05-20', price: { amount: 24.99 }, hasDiscount: true, discountPercentage: 10, activePreorder: false },
      { kinguinId: 12353, name: 'Elden Ring GOTY', popularity: 60, releaseDate: '2024-04-10', price: { amount: 49.99 }, hasDiscount: false, discountPercentage: 0, activePreorder: false },
      
      // Low Priority - Niche products
      { kinguinId: 12354, name: 'Indie Game X', popularity: 35, releaseDate: '2024-03-01', price: { amount: 19.99 }, hasDiscount: false, discountPercentage: 0, activePreorder: false },
      { kinguinId: 12355, name: 'Racing Simulator Pro', popularity: 28, releaseDate: '2024-02-15', price: { amount: 39.99 }, hasDiscount: true, discountPercentage: 5, activePreorder: false },
      { kinguinId: 12356, name: 'Strategy Game Beta', popularity: 15, releaseDate: '2024-01-20', price: { amount: 14.99 }, hasDiscount: false, discountPercentage: 0, activePreorder: false },
    ];

    // Simular el análisis que haríamos con datos reales
    const productsWithScores = sampleProducts.map(product => {
      let score = 0;
      
      // Score por popularidad (0-100 -> 0-1000 pts)
      score += product.popularity * 10;
      
      // Score por novedad (últimos 30 días = +500 pts)
      const daysSinceRelease = Math.floor((new Date() - new Date(product.releaseDate)) / (1000 * 60 * 60 * 24));
      if (daysSinceRelease <= 30) {
        score += 500 - (daysSinceRelease * 10);
      }
      
      // Score por preorder (+800 pts)
      if (product.activePreorder) {
        score += 800;
      }
      
      // Score por descuento (proporcional al descuento)
      if (product.hasDiscount) {
        score += product.discountPercentage * 5;
      }
      
      return {
        ...product,
        priorityScore: Math.round(score),
        daysSinceRelease,
        categories: [
          ...(product.popularity > 90 ? ['top_sellers'] : []),
          ...(daysSinceRelease <= 30 ? ['new_releases'] : []),
          ...(product.activePreorder ? ['preorders'] : []),
          ...(product.hasDiscount ? ['discounted'] : [])
        ]
      };
    });

    // Ordenar por score
    productsWithScores.sort((a, b) => b.priorityScore - a.priorityScore);

    // Clasificar por prioridad
    const totalProducts = productsWithScores.length;
    const classification = {
      ultra: productsWithScores.slice(0, Math.ceil(totalProducts * 0.25)),    // Top 25% para demo
      high: productsWithScores.slice(Math.ceil(totalProducts * 0.25), Math.ceil(totalProducts * 0.50)),  // 25-50%
      medium: productsWithScores.slice(Math.ceil(totalProducts * 0.50), Math.ceil(totalProducts * 0.75)), // 50-75%
      low: productsWithScores.slice(Math.ceil(totalProducts * 0.75))          // 75%+
    };

    // Estadísticas por categoría
    const categoryStats = {};
    ['top_sellers', 'new_releases', 'preorders', 'discounted'].forEach(cat => {
      const inCategory = productsWithScores.filter(p => p.categories.includes(cat));
      categoryStats[cat] = {
        total: inCategory.length,
        avg_score: inCategory.length > 0 ? Math.round(inCategory.reduce((sum, p) => sum + p.priorityScore, 0) / inCategory.length) : 0,
        in_ultra: inCategory.filter(p => classification.ultra.includes(p)).length,
        in_high: inCategory.filter(p => classification.high.includes(p)).length
      };
    });

    const executionTime = Math.round((Date.now() - startTime) / 1000);

    const response = {
      success: true,
      demo: true,
      message: "🎯 Demostración del sistema de clasificación inteligente",
      analysis: {
        total_products_analyzed: totalProducts,
        execution_time_seconds: executionTime,
        priorities: {
          ultra: {
            count: classification.ultra.length,
            percentage: Math.round((classification.ultra.length / totalProducts) * 100),
            avg_score: classification.ultra.length > 0 ? Math.round(classification.ultra.reduce((sum, p) => sum + p.priorityScore, 0) / classification.ultra.length) : 0,
            description: "💎 Ultra High Priority - Top sellers + New releases + Preorders",
            sync_frequency: "Every 15 minutes"
          },
          high: {
            count: classification.high.length,
            percentage: Math.round((classification.high.length / totalProducts) * 100),
            avg_score: classification.high.length > 0 ? Math.round(classification.high.reduce((sum, p) => sum + p.priorityScore, 0) / classification.high.length) : 0,
            description: "🔥 High Priority - Popular + Recent + Discounted",
            sync_frequency: "Every 30 minutes"
          },
          medium: {
            count: classification.medium.length,
            percentage: Math.round((classification.medium.length / totalProducts) * 100),
            avg_score: classification.medium.length > 0 ? Math.round(classification.medium.reduce((sum, p) => sum + p.priorityScore, 0) / classification.medium.length) : 0,
            description: "📊 Medium Priority - Good sellers + Decent prices",
            sync_frequency: "Every 2 hours"
          },
          low: {
            count: classification.low.length,
            percentage: Math.round((classification.low.length / totalProducts) * 100),
            avg_score: classification.low.length > 0 ? Math.round(classification.low.reduce((sum, p) => sum + p.priorityScore, 0) / classification.low.length) : 0,
            description: "📋 Low Priority - Long tail products",
            sync_frequency: "Daily"
          }
        },
        category_breakdown: categoryStats
      },
      examples: {
        ultra_priority: classification.ultra.map(p => ({
          id: p.kinguinId,
          name: p.name,
          score: p.priorityScore,
          popularity: p.popularity,
          categories: p.categories,
          price: p.price.amount,
          days_since_release: p.daysSinceRelease,
          reasoning: `Score: ${p.priorityScore} (Popularity: ${p.popularity*10} + Novedad: ${p.daysSinceRelease <= 30 ? 500-(p.daysSinceRelease*10) : 0} + Preorder: ${p.activePreorder ? 800 : 0} + Descuento: ${p.hasDiscount ? p.discountPercentage*5 : 0})`
        })),
        high_priority: classification.high.map(p => ({
          id: p.kinguinId,
          name: p.name,
          score: p.priorityScore,
          popularity: p.popularity,
          categories: p.categories,
          price: p.price.amount,
          reasoning: `Score: ${p.priorityScore} (Popularity: ${p.popularity*10} + Novedad: ${p.daysSinceRelease <= 30 ? 500-(p.daysSinceRelease*10) : 0} + Descuento: ${p.hasDiscount ? p.discountPercentage*5 : 0})`
        })),
        medium_priority: classification.medium.map(p => ({
          id: p.kinguinId,
          name: p.name,
          score: p.priorityScore,
          popularity: p.popularity,
          categories: p.categories,
          price: p.price.amount,
          reasoning: `Score: ${p.priorityScore} (Popularity: ${p.popularity*10} + Novedad: ${p.daysSinceRelease <= 30 ? 500-(p.daysSinceRelease*10) : 0})`
        })),
        low_priority: classification.low.map(p => ({
          id: p.kinguinId,
          name: p.name,
          score: p.priorityScore,
          popularity: p.popularity,
          categories: p.categories,
          price: p.price.amount,
          reasoning: `Score: ${p.priorityScore} (Solo popularidad: ${p.popularity*10})`
        }))
      },
      scoring_algorithm: {
        popularity: "0-100 popularity * 10 = 0-1000 points",
        newness: "Last 30 days = 500 - (days * 10) points",
        preorder: "Active preorder = +800 points",
        discount: "Discount percentage * 5 points",
        formula: "Score = (Popularity × 10) + (Newness bonus) + (Preorder bonus) + (Discount bonus)"
      }
    };

    console.log(`🎯 Demo completada: ${totalProducts} productos clasificados`);
    console.log(`💎 Ultra: ${classification.ultra.length} | 🔥 High: ${classification.high.length} | 📊 Medium: ${classification.medium.length} | 📋 Low: ${classification.low.length}`);

    res.status(200).json(response);

  } catch (error) {
    console.error('🎯 Error en demo:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}