import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

  // Verificación especial para duplicados
  if (req.query.check === 'duplicates') {
    try {
      console.log('🔍 Iniciando análisis de duplicados...');
      
      // 1. Contar total de productos
      const { count: totalCount, error: countError } = await supabase
        .from('published_products')
        .select('*', { count: 'exact', head: true });

      if (countError) throw countError;

      console.log(`📊 Total productos: ${totalCount}`);

      // 2. Obtener todos los kinguin_id
      const { data: allProducts, error: fetchError } = await supabase
        .from('published_products')
        .select('kinguin_id, ml_id, created_at, title')
        .order('kinguin_id');

      if (fetchError) throw fetchError;

      // 3. Analizar duplicados
      const kinguinIdGroups = new Map();
      
      allProducts.forEach(product => {
        const kinguinId = String(product.kinguin_id);
        
        if (!kinguinIdGroups.has(kinguinId)) {
          kinguinIdGroups.set(kinguinId, []);
        }
        
        kinguinIdGroups.get(kinguinId).push({
          ml_id: product.ml_id,
          created_at: product.created_at,
          title: product.title?.slice(0, 50)
        });
      });

      // 4. Encontrar grupos duplicados
      const duplicateGroups = [];
      for (const [kinguinId, products] of kinguinIdGroups.entries()) {
        if (products.length > 1) {
          duplicateGroups.push({
            kinguin_id: kinguinId,
            count: products.length,
            products: products
          });
        }
      }

      const totalDuplicatedRecords = duplicateGroups.reduce((sum, group) => sum + group.count, 0);
      const uniqueProducts = kinguinIdGroups.size;
      const duplicateWaste = totalDuplicatedRecords - uniqueProducts;

      console.log(`🔍 Duplicados encontrados: ${duplicateGroups.length} grupos`);
      console.log(`📈 Registros duplicados: ${duplicateWaste}`);

      return res.status(200).json({
        success: true,
        analysis_type: 'duplicate_check',
        timestamp: new Date().toISOString(),
        stats: {
          total_products_in_db: totalCount,
          unique_kinguin_ids: uniqueProducts,
          duplicate_groups_found: duplicateGroups.length,
          total_duplicate_records: duplicateWaste,
          efficiency_percentage: ((uniqueProducts / totalCount) * 100).toFixed(2) + '%',
          waste_percentage: ((duplicateWaste / totalCount) * 100).toFixed(2) + '%'
        },
        duplicates_sample: duplicateGroups.slice(0, 10),
        recommendations: duplicateGroups.length > 0 ? [
          'Hay productos duplicados que deben ser limpiados',
          'Los duplicados reducen la eficiencia del catálogo',
          'Considera ejecutar el cleanup automático'
        ] : [
          'No se encontraron duplicados',
          'El catálogo está optimizado'
        ]
      });

    } catch (error) {
      console.error('❌ Error en análisis de duplicados:', error);
      return res.status(500).json({
        success: false,
        error: error.message,
        analysis_type: 'duplicate_check'
      });
    }
  }

  try {
    const {
      page = 1,
      limit = 20,
      filter = '',
      stock,
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;
    
    const pageNumber = parseInt(page, 10);
    const limitNumber = parseInt(limit, 10);
    
    // Validar parámetros
    if (isNaN(pageNumber) || isNaN(limitNumber) || pageNumber < 1 || limitNumber < 1) {
      return res.status(400).json({
        success: false,
        error: 'Parámetros de paginación inválidos'
      });
    }
    
    // Calcular offset para paginación
    const offset = (pageNumber - 1) * limitNumber;
    
    // Construir query base
    let query = supabase
      .from('published_products')
      .select('*', { count: 'exact' });
      
    // Aplicar filtros
    if (filter) {
      // Filtrar por nombre o ID
      query = query.or(`title.ilike.%${filter}%,kinguin_id.eq.${filter},ml_id.eq.${filter}`);
    }
    
    // Filtrar por stock
    if (stock === 'true') {
      query = query.gt('stock', 0);
    } else if (stock === 'false') {
      query = query.eq('stock', 0);
    }
    
    // Validar campo de ordenación
    const allowedSortFields = [
      'title', 'kinguin_id', 'price_clp', 
      'price_clp', 'stock', 'created_at'
    ];
    
    // Mapear los nombres de campos de la UI a los nombres de la DB
    const fieldMapping = {
      'name': 'title',
      'kinguinId': 'kinguin_id',
      'originalPrice': 'price_clp',
      'sellingPrice': 'price_clp',
      'lastUpdated': 'created_at'
    };
    
    // Convertir el nombre del campo de ordenación si está en el mapeo
    const dbSortField = fieldMapping[sortBy] || sortBy;
    const actualSortBy = allowedSortFields.includes(dbSortField) ? dbSortField : 'title';
    const actualSortOrder = sortOrder === 'desc' ? 'desc' : 'asc';
    
    console.log(`Ordenando por ${actualSortBy} en orden ${actualSortOrder}`);
    
    // Aplicar ordenación y paginación
    const { data, error, count } = await query
      .order(actualSortBy, { ascending: actualSortOrder === 'asc' })
      .range(offset, offset + limitNumber - 1);
      
    if (error) {
      console.error('Error al consultar productos:', error);
      return res.status(500).json({
        success: false,
        error: 'Error al obtener los productos'
      });
    }
    
    // Transformar los datos para que coincidan con lo esperado por el frontend
    const transformedProducts = data.map(item => ({
      id: item.id,
      name: item.title,
      kinguinId: item.kinguin_id,
      mlId: item.ml_id,
      originalPrice: item.price_clp,
      sellingPrice: item.price_clp,
      stock: item.stock || 0,
      lastUpdated: item.created_at
    }));
    
    // Calcular total de páginas
    const totalPages = Math.ceil(count / limitNumber);
    
    return res.status(200).json({
      success: true,
      products: transformedProducts,
      page: pageNumber,
      limit: limitNumber,
      total: count,
      totalPages
    });
  } catch (error) {
    console.error('Error en el endpoint de productos:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
}