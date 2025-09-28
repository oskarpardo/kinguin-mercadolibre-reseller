import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
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