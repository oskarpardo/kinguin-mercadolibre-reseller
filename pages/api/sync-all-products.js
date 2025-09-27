import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import {
  titleFrom,
  computePriceCLP,
  descriptionFrom,
  postPlainDescription,
  regionVerdict as regionVerdictLogic,
  getProductType,
} from "./_logic";

// ---------- Supabase ----------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------- Helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isNumericId(v) {
  return typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v));
}

// Extrae un ID numérico “KPC” del objeto de producto de ESA
function extractNumericKpcId(p) {
  // intenta campos típicos
  const candidates = [
    p?.id,
    p?.kpcProductId,
    p?.kpcId,
    p?.productIdNumeric,
  ].filter(isNumericId);
  return candidates.length ? String(candidates[0]) : null;
}

// ---------- Token ML desde Supabase ----------
async function getMLAccessToken() {
  const { data, error } = await supabase
    .from("tokens")
    .select("value")
    .eq("key", "ML_ACCESS_TOKEN")
    .maybeSingle();
  if (error || !data) throw new Error("No se pudo obtener ML_ACCESS_TOKEN de Supabase");
  return data.value;
}

// ---------- Axios con Reintentos (Exponential Backoff) ----------
async function axiosWithRetry(config, retries = 3, initialDelayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios(config);
    } catch (error) {
      const isNetworkError = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
      const isServerError = error.response && error.response.status >= 500;

      if (isNetworkError || isServerError) {
        if (i === retries - 1) throw error; // Lanza el error en el último intento
        const delay = initialDelayMs * Math.pow(2, i);
        console.warn(`⚠️ Reintentando en ${delay}ms... (Intento ${i + 1}/${retries})`);
        await sleep(delay);
      } else {
        // No reintentar en errores de cliente (4xx)
        throw error;
      }
    }
  }
}

async function processProduct(product, existingProductMap, { KINGUIN_API_KEY, ML_ACCESS_TOKEN }) {
  const kpcId = extractNumericKpcId(product);
  if (!kpcId) {
    console.log(`[SKIP] ID: ${product?.productId || 'unknown'} - No se pudo extraer un ID numérico.`);
    return { status: "skipped_no_numeric_id", id: product?.productId || product?.id || "unknown" };
  }

  // Detalle para evaluar región y título
  let detail;
  try {
    const d = await axiosWithRetry({
      method: 'get',
      url: `https://gateway.kinguin.net/esa/api/v1/products/${kpcId}`,
      headers: { "X-Api-Key": KINGUIN_API_KEY }
    });
    detail = d.data;
  } catch (e) {
    console.warn("⚠️ No se pudo leer detalle para", kpcId, e.response?.status || e.message);
    return { status: "error_fetching_details", id: kpcId, error: e.response?.data || e.message };
  }

  // Región válida?
  const { allowed: isRegionAllowed, norm: regionName } = regionVerdictLogic(detail.regionalLimitations);
  if (!isRegionAllowed) {
    const existing = existingProductMap.get(String(kpcId));
    // si ya estaba publicado, cerrar + borrar
    if (existing && existing.ml_id) {
      try {
        await axiosWithRetry({
          method: 'put',
          url: `https://api.mercadolibre.com/items/${existing.ml_id}`,
          data: { status: "closed" },
          headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}` }
        });
      } catch (e) {
        console.warn("⚠️ Error cerrando ML", existing.ml_id, e.response?.data || e.message);
      }
      await supabase.from("published_products").delete().eq("kinguin_id", kpcId);
      console.log(`[CLOSED] ID: ${kpcId} - Producto cerrado en ML por región inválida: ${regionName}`);
      return { status: "closed", id: `${existing.ml_id} (kinguin ${kpcId})`, reason: `Región inválida: ${regionName}` };
    }
    console.log(`[SKIP] ID: ${kpcId} - Región no permitida: ${regionName}`);
    return { status: "skipped_invalid_region", id: kpcId, reason: `Región inválida: ${regionName}` };
  }

  const existing = existingProductMap.get(String(kpcId));

  if (existing) {
    // Sincronizar título si cambió
    const productType = getProductType(detail);
    const newTitle = titleFrom(detail, productType);
    const newDescription = descriptionFrom(detail, productType);

    try {
      const [itemRes, descRes] = await Promise.all([
        axiosWithRetry({
          method: 'get',
          url: `https://api.mercadolibre.com/items/${existing.ml_id}`,
          headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}` }
        }),
        axiosWithRetry({
          method: 'get',
          url: `https://api.mercadolibre.com/items/${existing.ml_id}/description`,
          headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}` }
        })
      ]);

      const item = itemRes.data;
      const currentDescription = descRes.data.plain_text || "";
      let updated = false;

      if (String(item.title).trim() !== newTitle.trim()) {
        await axiosWithRetry({
          method: 'put',
          url: `https://api.mercadolibre.com/items/${existing.ml_id}`,
          data: { title: newTitle },
          headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}` }
        });
        console.log(`[TITLE UPDATED] ID: ${kpcId} - Título actualizado en ML.`);
        updated = true;
      }

      if (currentDescription.trim() !== newDescription.trim()) {
        await postPlainDescription(existing.ml_id, newDescription, ML_ACCESS_TOKEN, detail);
        console.log(`[DESC UPDATED] ID: ${kpcId} - Descripción actualizada en ML.`);
        updated = true;
      }

      if (updated) {
        return { status: "content_updated", id: { mlId: existing.ml_id, kinguinId: kpcId } };
      }

    } catch (e) {
      console.warn("⚠️ No se pudo verificar/actualizar título", existing.ml_id, e.response?.data || e.message);
      return { status: "error_updating_title", id: existing.ml_id, error: e.response?.data || e.message };
    }
  } else {
    return { status: "skipped_not_in_db", id: kpcId };
  }
  console.log(`[NO CHANGE] ID: ${kpcId} - El producto ya existe y no requiere cambios.`);
  return { status: "no_changes", id: kpcId };
}

// ---------- API handler ----------
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido, usa POST" });

  const {
    KINGUIN_API_KEY,
    VERCEL_URL,
    ML_USER_ID
  } = process.env;

  if (!KINGUIN_API_KEY || !VERCEL_URL || !ML_USER_ID) {
    return res.status(500).json({ error: "Faltan credenciales (KINGUIN_API_KEY, VERCEL_URL o ML_USER_ID)" });
  }

  try {
    const ML_ACCESS_TOKEN = await getMLAccessToken();

    const summary = {
      published: [], content_updated: [], closed: [], no_changes: [],
      skipped_no_numeric_id: [], skipped_invalid_region: [], skipped_no_stock: [], skipped_not_in_db: [],
      error_fetching_details: [], error_updating_title: []
    };

    let page = 1;
    const size = 50;
    const MAX_PAGES = 50; // seguridad

    while (page <= MAX_PAGES) {
      const url = `https://gateway.kinguin.net/esa/api/v1/products?page=${page}&size=${size}`;
      console.log(`🔎 Fetching products: ${url}`);
      const { data } = await axiosWithRetry({
        method: 'get',
        url,
        headers: { "X-Api-Key": KINGUIN_API_KEY }
      });

      const results = data?.results || data?.items || [];
      if (!results.length) break;

      // --- OPTIMIZACIÓN: 1 consulta a DB por lote ---
      const kinguinIdsOnPage = results.map(p => extractNumericKpcId(p)).filter(Boolean);
      const { data: existingProductsInDB } = await supabase
        .from("published_products")
        .select("kinguin_id, ml_id")
        .in("kinguin_id", kinguinIdsOnPage);
      
      const existingProductMap = new Map(
        (existingProductsInDB || []).map(p => [p.kinguin_id, { ml_id: p.ml_id }])
      );

      // Procesa cada producto en paralelo
      const promises = results.map(p => processProduct(p, existingProductMap, { KINGUIN_API_KEY, ML_ACCESS_TOKEN }));
      const outcomes = await Promise.allSettled(promises);

      outcomes.forEach(outcome => {
        if (outcome.status === 'fulfilled' && outcome.value) {
          const { status, id } = outcome.value;
          if (summary[status]) {
            summary[status].push(id);
          }
        } else if (outcome.status === 'rejected') {
          console.error("💥 Error no controlado en processProduct:", outcome.reason);
        }
      });

      page += 1;
      await sleep(500); // respiro entre páginas
    }

    return res.status(200).json({
      message: "✅ Sync completo",
      summary: Object.keys(summary).reduce((acc, key) => {
        acc[key] = summary[key].length;
        return acc;
      }, {}),
      details: summary
    });
  } catch (err) {
    console.error("❌ Sync Error general:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Error en sync-all-products",
      detail: err.response?.data || err.message
    });
  }
}
