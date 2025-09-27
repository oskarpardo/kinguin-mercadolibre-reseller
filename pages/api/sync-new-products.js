import axios from "axios";
import { createClient } from "@supabase/supabase-js";

/* -------------------- Supabase -------------------- */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* -------------------- Función fetch Kinguin -------------------- */
async function fetchKinguinPage(page = 0, size = 50) {
  const url = `https://gateway.kinguin.net/esa/api/v1/products?page=${page}&size=${size}`;
  console.log("🔍 Fetching:", url);

  const { data, status } = await axios.get(url, {
    headers: { "X-Api-Key": process.env.KINGUIN_API_KEY },
    timeout: 20000,
    validateStatus: (s) => s < 500 // deja pasar errores 400-499 para loguear
  });

  if (status >= 400) {
    console.error("⚠️ Kinguin devolvió error:", status, data);
    throw new Error(`Kinguin devolvió ${status} en ${url}`);
  }
  return data;
}

/* -------------------- API handler -------------------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método no permitido, usa POST" });

  try {
    const KINGUIN_API_KEY = process.env.KINGUIN_API_KEY;
    if (!KINGUIN_API_KEY) {
      return res.status(500).json({ error: "Falta KINGUIN_API_KEY" });
    }

    // 1) Traer IDs que ya están en Supabase
    const { data: published, error: pubErr } = await supabase
      .from("published_products")
      .select("kinguin_id");

    if (pubErr) throw pubErr;

    const publishedIds = new Set((published || []).map((p) => p.kinguin_id));
    console.log("📦 Productos ya en DB:", publishedIds.size);

    // 2) Traer página de Kinguin
    const firstPage = await fetchKinguinPage(0, 20);

    if (!firstPage || !Array.isArray(firstPage.results)) {
      throw new Error("Respuesta inesperada de Kinguin");
    }

    // 3) Filtrar nuevos
    const newProducts = firstPage.results.filter(
      (p) => !publishedIds.has(p.productId)
    );

    return res.status(200).json({
      message: "✅ Sync OK",
      total: firstPage.results.length,
      nuevos: newProducts.map((p) => ({
        id: p.productId,
        name: p.name,
        region: p.region,
      })),
    });
  } catch (err) {
    console.error("❌ Sync-new-products Error:", {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data,
    });
    return res.status(500).json({
      error: "Error en sync-new-products",
      detail: err.response?.data || err.message,
    });
  }
}
