// pages/api/get-product.js
import axios from "axios";

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Aceptar tanto GET como POST
    let productId;
    
    if (req.method === "GET") {
      productId = req.query.id;
    } else if (req.method === "POST") {
      productId = req.body.kinguinId || req.body.id;
    } else {
      return res.status(405).json({ success: false, error: "Método no permitido" });
    }
    
    if (!productId) {
      return res.status(400).json({ success: false, error: "Se requiere el ID del producto" });
    }

    // Primero, intenta obtener los datos de la base de datos
    const { data: dbProduct, error: dbError } = await supabase
      .from("published_products")
      .select("*")
      .eq("kinguin_id", productId)
      .single();

    if (dbError && dbError.code !== 'PGRST116') { // PGRST116 es "no se encontraron registros"
      console.error("Error al obtener producto de Supabase:", dbError);
      return res.status(500).json({
        success: false,
        error: "Error al consultar la base de datos"
      });
    }

    // Si encontramos el producto en la base de datos
    if (dbProduct) {
      // Transformar los datos para que coincidan con lo esperado por el frontend
      const transformedProduct = {
        id: dbProduct.id,
        name: dbProduct.title,
        kinguinId: dbProduct.kinguin_id,
        mlId: dbProduct.ml_id,
        originalPrice: dbProduct.price_clp,
        sellingPrice: dbProduct.price_clp,
        stock: dbProduct.stock || 0,
        lastUpdated: dbProduct.created_at
      };
      
      return res.status(200).json({
        success: true,
        product: transformedProduct
      });
    }

    // Si no lo encontramos en DB, intentamos obtenerlo de la API de Kinguin
    const kinguinApiKey = process.env.KINGUIN_API_KEY;
    if (!kinguinApiKey) {
      return res.status(500).json({ 
        success: false, 
        error: "Falta KINGUIN_API_KEY en entorno" 
      });
    }

    try {
      // Llamar a la API de Kinguin
      const productResp = await axios.get(
        `https://gateway.kinguin.net/esa/api/v1/products/${productId}`,
        { headers: { "X-Api-Key": kinguinApiKey } }
      );

      // Transformar la respuesta al formato esperado
      const kinguinProduct = productResp.data;
      const transformedProduct = {
        name: kinguinProduct.name,
        kinguinId: productId,
        originalPrice: kinguinProduct.price?.gross || 0,
        sellingPrice: kinguinProduct.price?.gross || 0,
        stock: kinguinProduct.offers?.length > 0 ? 
               kinguinProduct.offers[0].quantity || 0 : 0,
        image: kinguinProduct.coverImage || kinguinProduct.images?.[0],
        description: kinguinProduct.description
      };

      return res.status(200).json({
        success: true,
        product: transformedProduct,
        source: 'kinguin_api'
      });
    } catch (err) {
      if (err.response?.status === 404) {
        return res.status(404).json({ 
          success: false, 
          error: `El producto con ID ${productId} no existe` 
        });
      }
      
      console.error("Error al obtener producto de Kinguin API:", 
        err.response?.status, 
        err.response?.data || err.message
      );
      
      return res.status(500).json({
        success: false,
        error: "Error al obtener producto de Kinguin",
        detail: err.response?.data || err.message
      });
    }
  } catch (err) {
    console.error("Error general en get-product:", err);
    res.status(500).json({
      success: false,
      error: "Error interno del servidor",
      detail: err.message
    });
  }
}
