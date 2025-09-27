import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import {
  getProductType,
  computePriceCLP,
  regionVerdict as regionVerdictLogic,
  titleFrom,
} from "./_logic";

/* -------------------- Supabase -------------------- */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* -------------------- Región -------------------- */
function regionVerdict(product) {
  // Usa la lógica centralizada
  const { norm, allowed } = regionVerdictLogic(product?.regionalLimitations);
  return { allowed, normalized: norm };
}

/* -------------------- Tokens -------------------- */
async function getMLAccessToken() {
  const { data, error } = await supabase
    .from("tokens")
    .select("value")
    .eq("key", "ML_ACCESS_TOKEN")
    .maybeSingle();
  if (error || !data) throw new Error("No se pudo obtener ML_ACCESS_TOKEN de Supabase");
  return data.value;
}

/* -------------------- Helpers ML -------------------- */
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function mlPut(url, body, token) {
  return await axios.put(url, body, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 });
}

/* -------------------- Procesar un ID -------------------- */
async function updateSingle(kinguinId, ML_ACCESS_TOKEN, KINGUIN_API_KEY) {
  try {
    console.log(`\n🔎 KinguinID=${kinguinId}`);

    // buscar items en ML por seller_custom_field = kinguinId
    const mlSearch = await axios.get(
      `https://api.mercadolibre.com/users/${process.env.ML_USER_ID}/items/search?seller_custom_field=${kinguinId}`,
      { headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}` }, timeout: 10000 }
    );

    if (!mlSearch.data.results?.length) {
      return { kinguinId, status: "skipped", reason: "no_ml_item" };
    }

    // elegir el primer item que NO sea catálogo
    let mlId = null;
    for (const id of mlSearch.data.results) {
      const mlData = await axios.get(`https://api.mercadolibre.com/items/${id}`, {
        headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}` }
      });
      if (!mlData.data.catalog_listing) {
        mlId = id;
        break;
      }
    }

    if (!mlId) {
      return { kinguinId, status: "skipped", reason: "only_catalog_items" };
    }

    // traer producto desde Kinguin
    const kRes = await axios.get(`https://gateway.kinguin.net/esa/api/v1/products/${kinguinId}`, {
      headers: { "X-Api-Key": KINGUIN_API_KEY }, timeout: 15000
    });
    const product = kRes.data;

    const { allowed, normalized } = regionVerdict(product);
    if (!allowed) {
      await mlPut(`https://api.mercadolibre.com/items/${mlId}`, { status: "closed" }, ML_ACCESS_TOKEN);
      return { kinguinId, mlId, status: "removed", reason: `region_invalid: ${normalized || "n/a"}` };
    }

    if (!product?.offers?.length) {
      await mlPut(`https://api.mercadolibre.com/items/${mlId}`, { status: "paused" }, ML_ACCESS_TOKEN);
      return { kinguinId, mlId, status: "paused", reason: "no_offers" };
    }

    const cheapest = product.offers.reduce((a, o) =>
      parseFloat(o.price) < parseFloat(a.price) ? o : a, product.offers[0]);

    if (!cheapest || Number(cheapest.qty) <= 0) {
      await mlPut(`https://api.mercadolibre.com/items/${mlId}`, { status: "paused" }, ML_ACCESS_TOKEN);
      return { kinguinId, mlId, status: "paused", reason: "qty=0" };
    }

    const { priceCLP, FX_EUR_CLP } = await computePriceCLP(parseFloat(cheapest.price));
    
    // Verificar si se pudo calcular un precio válido
    if (priceCLP === null || !FX_EUR_CLP) {
      console.error(`[Update] No se pudo calcular un precio válido para el producto ${kinguinId}`);
      await mlPut(`https://api.mercadolibre.com/items/${mlId}`, { status: "paused" }, ML_ACCESS_TOKEN);
      return { kinguinId, mlId, status: "paused", reason: "invalid_price" };
    }
    
    const qty = Math.max(1, Math.min(9999, Number(cheapest.qty) || 1));

    await mlPut(`https://api.mercadolibre.com/items/${mlId}`, {
      // Detecta el tipo de producto para generar el título más preciso
      title: titleFrom(product, getProductType(product)),
      price: priceCLP,
      available_quantity: qty,
      status: "active",
      seller_custom_field: String(kinguinId)
    }, ML_ACCESS_TOKEN);

    return { kinguinId, mlId, status: "updated", title: product.name, priceCLP, qty };
  } catch (err) {
    return { kinguinId, error: err?.response?.data || err.message };
  }
}

/* -------------------- API handler -------------------- */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const kinguinIds = body?.kinguinIds || (body?.sku ? [body.sku] : []);

    if (!kinguinIds.length) return res.status(400).json({ error: "Debes enviar kinguinIds o sku" });

    const KINGUIN_API_KEY = process.env.KINGUIN_API_KEY;
    const ML_ACCESS_TOKEN = await getMLAccessToken();

    let results = [];
    for (let i = 0; i < kinguinIds.length; i++) {
      const r = await updateSingle(kinguinIds[i], ML_ACCESS_TOKEN, KINGUIN_API_KEY);
      results.push(r);
      if (i + 1 < kinguinIds.length) await sleep(500);
    }

    const summary = results.reduce((acc, it) => {
      const k = it?.status || (it?.error ? "error" : "unknown");
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

    return res.status(200).json({ message: "✅ Update completado", total: results.length, summary, results });
  } catch (err) {
    return res.status(500).json({ error: "Error en update-product", detail: err.message });
  }
}
