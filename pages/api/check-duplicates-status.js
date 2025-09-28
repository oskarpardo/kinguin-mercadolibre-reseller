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
    // Obtener todos los productos activos
    const { data: allProducts } = await supabase
      .from("published_products")
      .select("kinguin_id, id, ml_id, status, created_at")
      .neq("status", "closed_duplicate");

    if (!allProducts || allProducts.length === 0) {
      return res.status(200).json({
        total_products: 0,
        duplicate_groups: 0,
        total_duplicated_records: 0,
        sample_duplicates: [],
        summary: {
          unique_products: 0,
          products_with_duplicates: 0,
          extra_duplicate_records: 0
        }
      });
    }

    // Agrupar por kinguin_id manualmente
    const groupedProducts = {};
    allProducts.forEach(product => {
      if (!groupedProducts[product.kinguin_id]) {
        groupedProducts[product.kinguin_id] = [];
      }
      groupedProducts[product.kinguin_id].push(product);
    });

    // Encontrar duplicados (grupos con más de 1 producto)
    const duplicates = [];
    const duplicateDetails = [];
    
    Object.entries(groupedProducts).forEach(([kinguin_id, products]) => {
      if (products.length > 1) {
        duplicates.push({
          kinguin_id,
          count: products.length
        });

        // Agregar detalles para los primeros 10
        if (duplicateDetails.length < 10) {
          duplicateDetails.push({
            kinguin_id,
            count: products.length,
            products: products.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          });
        }
      }
    });

    // Ordenar duplicados por cantidad (más duplicados primero)
    duplicates.sort((a, b) => b.count - a.count);

    return res.status(200).json({
      total_products: allProducts.length,
      unique_kinguin_ids: Object.keys(groupedProducts).length,
      duplicate_groups: duplicates.length,
      total_duplicated_records: duplicates.reduce((sum, d) => sum + d.count, 0),
      sample_duplicates: duplicateDetails,
      summary: {
        unique_products: Object.keys(groupedProducts).length - duplicates.length,
        products_with_duplicates: duplicates.length,
        extra_duplicate_records: duplicates.reduce((sum, d) => sum + (d.count - 1), 0)
      }
    });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: 'Server error', 
      details: error.message 
    });
  }
}