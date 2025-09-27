export const maxDuration = 300;

import axios from "axios";
import { createClient } from "@supabase/supabase-js"; // Supabase sigue siendo necesario para published_products
import { computePriceCLP, getKinguinProduct } from "./_logic"; // Cambiado de getKinguinProductWithCache

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Evita que el mismo batch se ejecute múltiples veces en paralelo
const runningBatches = global.runningBatches || new Set();
global.runningBatches = runningBatches;

// ---------- Procesar un producto individual ----------
async function processSingleProduct(product, { ML_ACCESS_TOKEN, KINGUIN_API_KEY, isTest }) {
  const { ml_id, kinguin_id } = product;

  try {
    // Obtener datos de Kinguin y Mercado Libre en paralelo (sin caché de Kinguin)
    const [mlItemRes, kinguinProduct] = await Promise.all([
      axios.get(`https://api.mercadolibre.com/items/${ml_id}`, {
        headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}` },
        timeout: 15000,
      }),
      axios.get(`https://gateway.kinguin.net/esa/api/v1/products/${kinguin_id}`, {
        headers: { "X-Api-Key": KINGUIN_API_KEY },
        timeout: 15000,
      }),
    ]);

    if (!kinguinProduct || !kinguinProduct.offers) return { status: "skipped_kinguin_error", ml_id };

    const statusML = mlItemRes.data.status;
    const currentPrice = Number(mlItemRes.data.price);
    const currentQty = Number(mlItemRes.data.available_quantity);

    const cheapest = kinguinProduct.offers
      .filter((o) => Number(o.qty) > 0)
      .sort((a, b) => Number(a.price) - Number(b.price))[0];

    if (!cheapest) {
      if (statusML === "active" && !isTest) {
        await axios.put(
          `https://api.mercadolibre.com/items/${ml_id}`,
          { status: "paused" },
          { headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}` }, timeout: 15000 }
        );
        console.log(`⏸️ Pausado: ${ml_id} (sin ofertas)`);
        return { status: "paused", ml_id };
      }
      return { status: "skipped_no_offers", ml_id };
    }

    if (statusML === "paused" && !isTest) {
      await axios.put(
        `https://api.mercadolibre.com/items/${ml_id}`,
        { status: "active", available_quantity: Number(cheapest.qty) },
        { headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}` }, timeout: 15000 }
      );
      console.log(`▶️ Reactivado: ${ml_id}`);
    }

    const { priceCLP: newPrice, FX_EUR_CLP } = await computePriceCLP(parseFloat(cheapest.price));
    
    // Verificar si se pudo calcular un precio válido
    if (newPrice === null || !FX_EUR_CLP) {
      console.error(`[SyncPrices] No se pudo calcular un precio válido para ${ml_id} (KinguinID: ${kinguin_id})`);
      if (!isTest) {
        await axios.put(
          `https://api.mercadolibre.com/items/${ml_id}`,
          { status: "paused" },
          { headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}` }, timeout: 15000 }
        );
        console.log(`⚠️ Pausado por error de precio: ${ml_id}`);
      }
      return { ml_id, kinguin_id, status: "paused", reason: "invalid_price" };
    }
    
    const newQty = Number(cheapest.qty);
    const needUpdate = currentPrice !== newPrice || currentQty !== newQty;

    if (needUpdate) {
      if (!isTest) {
        await axios.put(
          `https://api.mercadolibre.com/items/${ml_id}`,
          { price: newPrice, available_quantity: newQty },
          { headers: { Authorization: `Bearer ${ML_ACCESS_TOKEN}` }, timeout: 20000 }
        );
      }
      console.log(`🔄 Actualizado: ${ml_id} → $${newPrice} | qty ${newQty}`);
      return { status: "updated", ml_id, newPrice, newQty };
    } else {
      console.log(`✅ Sin cambios: ${ml_id}`);
      return { status: "no_change", ml_id };
    }
  } catch (error) {
    console.error(`❌ Error procesando ${ml_id}:`, error.response?.data || error.message);
    return { status: "error", ml_id, error: error.response?.data || error.message };
  }
}

// ---------- Disparar el siguiente lote ----------
async function triggerBatch(batchNumber) {
  const base = process.env.SELF_BASE_URL || `https://${process.env.VERCEL_URL}`;
  const url = `${base}/api/sync-prices?batch=${batchNumber}`;
  console.log(`🔗 Disparando lote: ${url}`);
  // No esperamos la respuesta para que la función actual termine rápido
  axios.post(url, {}, { timeout: 5000 }).catch(err => {
    console.error(`💥 Error al disparar el lote #${batchNumber}:`, err.message);
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------- Obtener Token de ML desde Supabase ----------
async function getMLAccessToken() {
  const { data, error } = await supabase
    .from("tokens")
    .select("value")
    .eq("key", "ML_ACCESS_TOKEN")
    .single();
  if (error || !data?.value) throw new Error("No se pudo obtener ML_ACCESS_TOKEN de Supabase");
  return data.value;
}

// ---------- Handler ----------
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Use GET o POST" });
  }

  const batchParam = (req.query.batch ?? req.body?.batch ?? "1").toString();
  const isTest = process.env.MODO_TEST === "true";

  // Si el batch es '1', es el iniciador. Dispara los demás.
  if (batchParam === "1" && req.method === "POST") {
    console.log("🚀 Iniciando proceso de sincronización masiva de precios...");
    const MAX_CONCURRENT_BATCHES = 18;
    for (let i = 1; i <= MAX_CONCURRENT_BATCHES; i++) {
      // Invocamos cada lote con un pequeño delay para no saturar la red
      triggerBatch(i);
      await sleep(200); 
    }
    return res.status(202).json({ message: `Disparados ${MAX_CONCURRENT_BATCHES} lotes en paralelo.` });
  }

  // Evita ejecuciones concurrentes del mismo lote
  if (runningBatches.has(batchParam)) {
    return res.status(429).json({ error: `Lote '${batchParam}' ya en ejecución.` });
  }

  runningBatches.add(batchParam);

  // Respuesta inmediata para el cron job
  res.status(200).json({ ok: true, batch: batchParam, message: "Lote iniciado en segundo plano." });

  // El resto corre en segundo plano
  (async () => {
    const batchNumber = parseInt(batchParam, 10);
    const BATCH_SIZE = 500;
    const MAX_CONCURRENT_BATCHES = 18;
    let currentBatch = batchNumber;

    while (true) {
      console.log(`\n--- 🚀 Iniciando Lote de Precios #${currentBatch} ---`);
      try {
        const [ML_ACCESS_TOKEN, KINGUIN_API_KEY] = await Promise.all([
          getMLAccessToken(),
          Promise.resolve(process.env.KINGUIN_API_KEY)
        ]);
        if (!ML_ACCESS_TOKEN || !KINGUIN_API_KEY) throw new Error("Faltan credenciales (ML_ACCESS_TOKEN o KINGUIN_API_KEY).");

        const { data: products, error } = await supabase
          .from("published_products")
          .select("ml_id, kinguin_id")
          .not("ml_id", "is", null)
          .range((currentBatch - 1) * BATCH_SIZE, currentBatch * BATCH_SIZE - 1);

        if (error || !products?.length) {
          console.log(`🏁 No hay más productos en el lote #${currentBatch}. Fin de la cadena para este worker.`);
          break; // Termina el bucle while
        }

        console.log(`📦 Lote #${currentBatch}: Procesando ${products.length} productos...`);
        const results = await Promise.all(
          products.map((p) => processSingleProduct(p, { ML_ACCESS_TOKEN, KINGUIN_API_KEY, isTest }))
        );
        const summary = results.reduce((acc, res) => { (acc[res.status] = (acc[res.status] || 0) + 1); return acc; }, {});
        console.log(`📊 Resumen del Lote #${currentBatch}:`, summary);

        currentBatch += MAX_CONCURRENT_BATCHES; // Salta al siguiente lote que le corresponde a este "worker"
      } catch (err) {
        console.error(`💥 Error fatal en el Lote #${currentBatch}:`, err?.message || err);
        break; // Detiene el proceso de este worker si hay un error grave
      } finally {
        console.log(`--- ✅ Lote de Precios #${currentBatch - MAX_CONCURRENT_BATCHES} Finalizado ---`);
      }
    }
    runningBatches.delete(batchParam);
  })();
}
