import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

// Configurar Supabase - usar la clave anónima disponible en Vercel
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Obtiene el token de ML desde Supabase
 */
async function getTokenFromSupabase(tokenName) {
  const { data, error } = await supabase
    .from('tokens')
    .select('token_value')
    .eq('token_name', tokenName)
    .single();

  if (error) {
    throw new Error(`Error obteniendo ${tokenName}: ${error.message}`);
  }

  return data.token_value;
}

/**
 * API para extraer configuración de publicaciones de MercadoLibre
 * GET /api/extract-ml-config?item_id=MLC83928932
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { item_id } = req.query;

  if (!item_id) {
    return res.status(400).json({ 
      error: 'Falta parámetro item_id',
      ejemplo: '/api/extract-ml-config?item_id=MLC83928932'
    });
  }

  try {
    console.log(`🔍 Extrayendo configuración de: ${item_id}`);
    
    // Verificar variables de entorno
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      return res.status(500).json({ 
        error: 'Variables de entorno de Supabase no configuradas',
        missing: {
          SUPABASE_URL: !process.env.SUPABASE_URL,
          SUPABASE_ANON_KEY: !process.env.SUPABASE_ANON_KEY
        }
      });
    }

    // Obtener token de ML desde Supabase
    let ML_ACCESS_TOKEN;
    try {
      console.log('🔑 Obteniendo token desde Supabase...');
      ML_ACCESS_TOKEN = await getTokenFromSupabase("ML_ACCESS_TOKEN");
      console.log(`✅ Token ML obtenido desde Supabase`);
    } catch (tokenError) {
      console.warn(`⚠️ No se pudo obtener ML_ACCESS_TOKEN desde Supabase: ${tokenError.message}`);
      console.log('🔄 Intentando con variable de entorno...');
      ML_ACCESS_TOKEN = process.env.ML_ACCESS_TOKEN;
      if (ML_ACCESS_TOKEN) {
        console.log('✅ Token obtenido desde variables de entorno');
      }
    }

    if (!ML_ACCESS_TOKEN) {
      return res.status(500).json({ 
        error: 'ML_ACCESS_TOKEN no disponible en Supabase ni en variables de entorno' 
      });
    }

    console.log('📡 Consultando MercadoLibre API...');
    // Obtener información del item con token de autorización
    const response = await axios.get(`https://api.mercadolibre.com/items/${item_id}`, {
      headers: {
        'Authorization': `Bearer ${ML_ACCESS_TOKEN}`
      }
    });
    const item = response.data;
    console.log('✅ Respuesta obtenida de MercadoLibre');

    // Información básica
    const basicInfo = {
      title: item.title,
      category_id: item.category_id,
      listing_type_id: item.listing_type_id,
      condition: item.condition,
      price: item.price,
      currency_id: item.currency_id,
      buying_mode: item.buying_mode,
      available_quantity: item.available_quantity
    };

    // Atributos
    const attributes = item.attributes ? item.attributes.map(attr => ({
      id: attr.id,
      name: attr.name,
      value_id: attr.value_id || null,
      value_name: attr.value_name || null
    })) : [];

    // Configuración de envío
    const shipping = item.shipping ? {
      mode: item.shipping.mode || null,
      free_shipping: item.shipping.free_shipping || false,
      local_pick_up: item.shipping.local_pick_up || false
    } : null;

    // Términos de venta
    const saleTerms = item.sale_terms ? item.sale_terms.map(term => ({
      id: term.id,
      name: term.name,
      value_id: term.value_id || null,
      value_name: term.value_name || null
    })) : [];

    // Generar código para replicar
    const replicateCode = generateReplicateCode(basicInfo, attributes, shipping, saleTerms);

    return res.status(200).json({
      success: true,
      item_id: item_id,
      extracted_config: {
        basic_info: basicInfo,
        attributes: attributes,
        shipping: shipping,
        sale_terms: saleTerms
      },
      replicate_code: replicateCode
    });

  } catch (error) {
    console.error(`❌ Error extrayendo ${item_id}:`, error.message);
    console.error('Stack trace:', error.stack);
    
    let errorMessage = error.message;
    let statusCode = 500;
    
    if (error.response?.status === 403) {
      errorMessage = 'Item privado o no accesible públicamente';
      statusCode = 403;
    } else if (error.response?.status === 404) {
      errorMessage = 'Item no encontrado';
      statusCode = 404;
    } else if (error.response?.status === 401) {
      errorMessage = 'Token de MercadoLibre inválido o expirado';
      statusCode = 401;
    }

    return res.status(statusCode).json({
      success: false,
      error: errorMessage,
      item_id: item_id,
      debug: {
        original_error: error.message,
        ml_status: error.response?.status,
        ml_data: error.response?.data
      }
    });
  }
}

function generateReplicateCode(basicInfo, attributes, shipping, saleTerms) {
  let code = 'const mlItemData = {\n';
  code += `  title: "TU_TITULO_AQUI",\n`;
  code += `  category_id: "${basicInfo.category_id}",\n`;
  code += `  price: TU_PRECIO,\n`;
  code += `  currency_id: "${basicInfo.currency_id}",\n`;
  code += `  available_quantity: ${basicInfo.available_quantity},\n`;
  code += `  buying_mode: "${basicInfo.buying_mode}",\n`;
  code += `  listing_type_id: "${basicInfo.listing_type_id}",\n`;
  code += `  condition: "${basicInfo.condition}",\n`;
  
  if (attributes.length > 0) {
    code += '  attributes: [\n';
    attributes.forEach(attr => {
      if (attr.value_id) {
        code += `    { id: "${attr.id}", value_id: "${attr.value_id}" }, // ${attr.name || attr.id}\n`;
      } else if (attr.value_name) {
        code += `    { id: "${attr.id}", value_name: "${attr.value_name}" }, // ${attr.name || attr.id}\n`;
      }
    });
    code += '  ],\n';
  }

  if (saleTerms.length > 0) {
    code += '  sale_terms: [\n';
    saleTerms.forEach(term => {
      if (term.value_id) {
        code += `    { id: "${term.id}", value_id: "${term.value_id}" },\n`;
      } else if (term.value_name) {
        code += `    { id: "${term.id}", value_name: "${term.value_name}" },\n`;
      }
    });
    code += '  ],\n';
  }

  if (shipping) {
    code += '  shipping: {\n';
    if (shipping.mode) code += `    mode: "${shipping.mode}",\n`;
    code += `    free_shipping: ${shipping.free_shipping},\n`;
    code += `    local_pick_up: ${shipping.local_pick_up},\n`;
    code += '  }\n';
  }

  code += '};';
  return code;
}