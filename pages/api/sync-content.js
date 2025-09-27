import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import {
  descriptionFrom,
  postPlainDescription,
  getProductType,
  titleFrom,
} from "./_logic";

export const maxDuration = 300; // 5 minutos

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getMLAccessToken() {
  const { data, error } = await supabase
    .from("tokens")
    .select("value")
    .eq("key", "ML_ACCESS_TOKEN")
    .single();
  if (error || !data?.value) throw new Error("No se pudo obtener ML_ACCESS_TOKEN de Supabase");
  return data.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function axiosWithRetry(config, retries = 3, initialDelayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios(config);
    } catch (error) {
      const isNetworkError = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
      const isServerError = error.response && error.response.status >= 500;

      if (isNetworkError || isServerError) {
        if (i === retries - 1) throw error;
        const delay = initialDelayMs * Math.pow(2, i);
        console.warn(`⚠️ Reintentando en ${delay}ms... (Intento ${i + 1}/${retries})`);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
}

async function processSingleProduct(product, { KINGUIN_API_KEY, ML_ACCESS_TOKEN }) {
  const { kinguin_id, ml_id } = product;
  console.log(`\n🔄 Procesando kinguin_id: ${kinguin_id}, ml_id: ${ml_id}`);

  try {
    // 1. Obtener datos de Kinguin y Mercado Libre en paralelo
    const [kinguinRes, mlItemRes, mlDescRes] = await Promise.all([
      axiosWithRetry({ url: `https://gateway.kinguin.net/esa/api/v1/products/${kinguin_id}`,
        headers: { "X-Api-Key": KINGUIN_API_KEY },
      }),
      axiosWithRetry({ url: `https://api.mercadolibre.com/items/${ml_id}` }),
      axiosWithRetry({ url: `https://api.mercadolibre.com/items/${ml_id}/description` }),
    ]);

    const kinguinProduct = kinguinRes.data;
    const mlItem = mlItemRes.data;
    const mlDescription = mlDescRes.data.plain_text;

    // 2. Generar nuevo título y descripción
    const productType = getProductType(kinguinProduct);
    const newTitle = titleFrom(kinguinProduct, productType);
    const newDescription = descriptionFrom(kinguinProduct, productType);

    // 3. Comparar y actualizar si es necesario
    let updatedFields = [];

    // Actualizar título
    if (mlItem.title.trim() !== newTitle.trim()) {
      console.log(`   - Título necesita actualización.`);
      await axiosWithRetry(
        `https://api.mercadolibre.com/items/${ml_id}`,
        { title: newTitle },
        { headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}` } }
      );
      updatedFields.push("title");
      console.log(`   ✅ Título actualizado a: "${newTitle}"`);
    }

    // Actualizar descripción
    if (mlDescription.trim() !== newDescription.trim()) {
      console.log(`   - Descripción necesita actualización.`);
      await postPlainDescription(ml_id, newDescription, ML_ACCESS_TOKEN, kinguinProduct);
      updatedFields.push("description");
      console.log(`   ✅ Descripción actualizada.`);
    }

    if (updatedFields.length > 0) {
      return { status: "updated", kinguin_id, ml_id, fields: updatedFields };
    } else {
      return { status: "no_change", kinguin_id, ml_id };
    }
  } catch (error) {
    console.error(`   ❌ Error procesando ${kinguin_id}:`, error.response?.data || error.message);
    return { status: "error", kinguin_id, ml_id, error: error.response?.data || error.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido, usa POST" });
  }

  const batch = parseInt(req.query.batch || "1", 10);
  const BATCH_SIZE = 20; // Procesar de 20 en 20 para no exceder límites

  console.log(`🚀 Iniciando batch de sincronización de contenido #${batch}`);

  try {
    const ML_ACCESS_TOKEN = await getMLAccessToken();
    const KINGUIN_API_KEY = process.env.KINGUIN_API_KEY;

    if (!KINGUIN_API_KEY) {
      throw new Error("Falta la variable de entorno KINGUIN_API_KEY");
    }

    // Obtener productos de la base de datos para el batch actual
    const { data: products, error: dbError } = await supabase
      .from("published_products")
      .select("kinguin_id, ml_id")
      .not("ml_id", "is", null)
      .order("created_at", { ascending: true })
      .range((batch - 1) * BATCH_SIZE, batch * BATCH_SIZE - 1);

    if (dbError) {
      throw new Error(`Error de base de datos: ${dbError.message}`);
    }

    if (!products || products.length === 0) {
      const message = "✅ No hay más productos para sincronizar en este batch.";
      console.log(message);
      return res.status(200).json({ message, summary: { total: 0 } });
    }

    console.log(`📦 Se procesarán ${products.length} productos en este batch.`);

    // Procesar todos los productos del batch en paralelo
    const results = await Promise.all(
      products.map(p => processSingleProduct(p, { KINGUIN_API_KEY, ML_ACCESS_TOKEN }))
    );

    // Generar un resumen de la operación
    const summary = results.reduce((acc, result) => {
      switch (result.status) {
        case "updated":
          acc.updated++;
          break;
        case "no_change":
          acc.no_change++;
          break;
        case "error":
          acc.errors++;
          break;
      }
      return acc;
    }, {
      total: results.length,
      updated: 0,
      no_change: 0,
      errors: 0,
    });

    console.log("📊 Resumen del Batch:", summary);

    return res.status(200).json({
      message: `✅ Batch #${batch} completado.`,
      summary,
      results,
    });

  } catch (error) {
    console.error("💥 Error fatal en el script sync-content:", error.message);
    return res.status(500).json({
      error: "Error fatal durante la sincronización",
      detail: error.message,
    });
  }
}