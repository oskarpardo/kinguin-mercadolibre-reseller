// scripts/sync-ml-to-supabase.js
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

// ---------- Supabase ----------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getToken() {
  // Buscar token en tabla tokens
  const { data, error } = await supabase
    .from("tokens")
    .select("value")
    .eq("key", "ML_ACCESS_TOKEN")
    .single();

  if (error) {
    console.warn("⚠️ No se pudo leer token en Supabase:", error.message);
    return process.env.ML_ACCESS_TOKEN || null;
  }
  return data?.value || process.env.ML_ACCESS_TOKEN || null;
}

async function main() {
  console.log("🚀 Iniciando sync Kinguin → MercadoLibre → Supabase");

  const token = await getToken();
  if (!token) {
    console.error("❌ No hay ML_ACCESS_TOKEN disponible");
    process.exit(1);
  }

  // 1️⃣ Obtener todos los kinguin_id desde Supabase
  const { data: products, error: errorProducts } = await supabase
    .from("published_products")
    .select("kinguin_id");

  if (errorProducts) {
    console.error("❌ Error leyendo published_products:", errorProducts.message);
    process.exit(1);
  }

  console.log(`📦 ${products.length} productos encontrados en Supabase`);

  let procesados = 0;
  for (const { kinguin_id } of products) {
    try {
      // 2️⃣ Buscar en ML por seller_custom_field
      const url = `https://api.mercadolibre.com/users/${process.env.ML_USER_ID}/items/search?seller_custom_field=${kinguin_id}`;
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (data.results && data.results.length > 0) {
        const ml_id = data.results[0];
        console.log(`✅ Match KinguinID=${kinguin_id} → ML_ID=${ml_id}`);

        // 3️⃣ Guardar en Supabase
        const { error: upsertError } = await supabase
          .from("published_products")
          .upsert({ kinguin_id, ml_id }, { onConflict: "kinguin_id" });

        if (upsertError) {
          console.error(
            `❌ Error guardando KinguinID=${kinguin_id}:`,
            upsertError.message
          );
        } else {
          procesados++;
        }
      } else {
        console.warn(`⚠️ No encontrado en ML → KinguinID=${kinguin_id}`);
      }
    } catch (err) {
      console.error(
        `❌ Error buscando KinguinID=${kinguin_id}:`,
        err.response?.data || err.message
      );
    }
  }

  console.log(`✅ Sync finalizado. Total procesados: ${procesados}/${products.length}`);
}

main();
