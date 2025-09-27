// Analiza SOLO los productos que ya tienes en tu catálogo (15k productos)
// Aplicar lógica de priorización a productos existentes

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET method allowed' });
  }

  try {
    console.log('📊 Analizando tu catálogo actual de 15k productos...');
    const startTime = Date.now();

    // 1. Obtener productos existentes de Supabase
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    
    const { data: products, error } = await supabase
      .from('tokens')
      .select('*')
      .limit(2000) // Analizar muestra representativa
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(`Error obteniendo productos: ${error.message}`);
    }

    console.log(`📦 Analizando ${products?.length || 0} productos de tu catálogo`);

    if (!products || products.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No hay productos en el catálogo para analizar',
        recommendation: 'Ejecutar sync inicial para agregar productos'
      });
    }

    // 2. Analizar y clasificar productos existentes
    const analyzedProducts = products.map(product => {
      let priorityScore = 0;
      const categories = [];
      const daysSinceUpdate = Math.floor((new Date() - new Date(product.updated_at)) / (1000 * 60 * 60 * 24));
      
      // Score base por estado
      if (product.status === 'active') {
        priorityScore += 500;
        categories.push('active_listing');
      } else if (product.status === 'paused') {
        priorityScore += 200;
        categories.push('paused_listing');
      }

      // Score por urgencia de actualización
      if (daysSinceUpdate > 7) {
        priorityScore += 800; // MUY urgente
        categories.push('urgent_update_needed');
      } else if (daysSinceUpdate > 3) {
        priorityScore += 400; // Urgente
        categories.push('update_needed');
      } else if (daysSinceUpdate > 1) {
        priorityScore += 200; // Moderado
        categories.push('recent_but_stale');
      } else {
        priorityScore += 50; // Reciente
        categories.push('recently_updated');
      }

      // Score por precio (productos caros = más importantes)
      const price = parseFloat(product.price) || 0;
      if (price > 50) {
        priorityScore += 300;
        categories.push('high_value');
      } else if (price > 20) {
        priorityScore += 150;
        categories.push('medium_value');
      } else {
        priorityScore += 75;
        categories.push('low_value');
      }

      // Score por engagement (si tiene visitas/ventas)
      if (product.views && product.views > 100) {
        priorityScore += 400;
        categories.push('high_engagement');
      } else if (product.views && product.views > 10) {
        priorityScore += 200;
        categories.push('medium_engagement');
      }

      return {
        ...product,
        priorityScore,
        categories,
        daysSinceUpdate,
        needsUrgentUpdate: daysSinceUpdate > 7,
        action: daysSinceUpdate > 1 ? 'update_price_stock' : 'monitor'
      };
    });

    // 3. Clasificar por prioridad
    analyzedProducts.sort((a, b) => b.priorityScore - a.priorityScore);
    
    const totalProducts = analyzedProducts.length;
    const classification = {
      ultra: analyzedProducts.slice(0, Math.floor(totalProducts * 0.10)),     // Top 10%
      high: analyzedProducts.slice(Math.floor(totalProducts * 0.10), Math.floor(totalProducts * 0.25)),   // 10-25%
      medium: analyzedProducts.slice(Math.floor(totalProducts * 0.25), Math.floor(totalProducts * 0.60)), // 25-60%
      low: analyzedProducts.slice(Math.floor(totalProducts * 0.60))           // 60%+
    };

    // 4. Estadísticas por categoría
    const categoryStats = {};
    const allCategories = ['urgent_update_needed', 'update_needed', 'recently_updated', 'high_value', 'active_listing', 'high_engagement'];
    
    allCategories.forEach(cat => {
      const inCategory = analyzedProducts.filter(p => p.categories.includes(cat));
      categoryStats[cat] = {
        count: inCategory.length,
        avg_score: inCategory.length > 0 ? Math.round(inCategory.reduce((sum, p) => sum + p.priorityScore, 0) / inCategory.length) : 0,
        percentage: Math.round((inCategory.length / totalProducts) * 100)
      };
    });

    // 5. Recomendaciones específicas
    const urgentCount = analyzedProducts.filter(p => p.needsUrgentUpdate).length;
    const activeCount = analyzedProducts.filter(p => p.status === 'active').length;
    const pausedCount = analyzedProducts.filter(p => p.status === 'paused').length;

    const executionTime = Math.round((Date.now() - startTime) / 1000);

    res.status(200).json({
      success: true,
      type: 'existing_catalog_analysis',
      catalog_overview: {
        total_products: totalProducts,
        active_listings: activeCount,
        paused_listings: pausedCount,
        urgent_updates_needed: urgentCount,
        avg_days_since_update: Math.round(analyzedProducts.reduce((sum, p) => sum + p.daysSinceUpdate, 0) / totalProducts)
      },
      priority_classification: {
        ultra: {
          count: classification.ultra.length,
          percentage: Math.round((classification.ultra.length / totalProducts) * 100),
          avg_score: Math.round(classification.ultra.reduce((sum, p) => sum + p.priorityScore, 0) / classification.ultra.length),
          description: '💎 Críticos - Productos de alto valor con actualizaciones urgentes',
          action: 'Actualizar cada 15 minutos'
        },
        high: {
          count: classification.high.length,
          percentage: Math.round((classification.high.length / totalProducts) * 100),
          avg_score: Math.round(classification.high.reduce((sum, p) => sum + p.priorityScore, 0) / classification.high.length),
          description: '🔥 Importantes - Productos activos que necesitan atención',
          action: 'Actualizar cada 30 minutos'
        },
        medium: {
          count: classification.medium.length,
          percentage: Math.round((classification.medium.length / totalProducts) * 100),
          avg_score: Math.round(classification.medium.reduce((sum, p) => sum + p.priorityScore, 0) / classification.medium.length),
          description: '📊 Regulares - Productos estables con updates periódicos',
          action: 'Actualizar cada 2 horas'
        },
        low: {
          count: classification.low.length,
          percentage: Math.round((classification.low.length / totalProducts) * 100),
          avg_score: classification.low.length > 0 ? Math.round(classification.low.reduce((sum, p) => sum + p.priorityScore, 0) / classification.low.length) : 0,
          description: '📋 Mantenimiento - Productos de baja prioridad',
          action: 'Actualizar diariamente'
        }
      },
      category_breakdown: categoryStats,
      examples: {
        ultra_priority: classification.ultra.slice(0, 3).map(p => ({
          ml_item_id: p.ml_item_id,
          title: p.title?.slice(0, 50),
          price: p.price,
          status: p.status,
          score: p.priorityScore,
          days_since_update: p.daysSinceUpdate,
          categories: p.categories,
          action: p.action
        })),
        high_priority: classification.high.slice(0, 3).map(p => ({
          ml_item_id: p.ml_item_id,
          title: p.title?.slice(0, 50),
          price: p.price,
          status: p.status,
          score: p.priorityScore,
          days_since_update: p.daysSinceUpdate,
          action: p.action
        }))
      },
      recommendations: [
        urgentCount > totalProducts * 0.3 ? 
          `🚨 URGENTE: ${urgentCount} productos (${Math.round(urgentCount/totalProducts*100)}%) necesitan actualización inmediata` :
          `✅ Catálogo en buen estado: solo ${urgentCount} productos necesitan atención urgente`,
        
        activeCount < totalProducts * 0.7 ? 
          `⚠️ Solo ${Math.round(activeCount/totalProducts*100)}% de productos están activos. Revisar productos pausados.` :
          `✅ Gran mayoría de productos activos (${Math.round(activeCount/totalProducts*100)}%)`,
          
        `🎯 Configurar sync automático: ${classification.ultra.length} productos críticos cada 15min, ${classification.high.length} importantes cada 30min`,
        
        `💡 Estimación: Con GitHub Actions puedes mantener todo actualizado automáticamente`
      ],
      execution_time_seconds: executionTime
    });

  } catch (error) {
    console.error('📊 Error analizando catálogo:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}