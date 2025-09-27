// pages/api/refresh-token.js
import axios from "axios";
import { createClient } from "@supabase/supabase-js";

// ---------- Supabase ----------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const {
    VERCEL_API_TOKEN,
    VERCEL_PROJECT_ID,
    VERCEL_TEAM_ID,
    ML_REFRESH_TOKEN,
    ML_APP_ID,
    ML_CLIENT_SECRET,
    ML_USER_ID,
  } = process.env;

  // Validación de envs críticas
  const missing = [
    "VERCEL_API_TOKEN",
    "VERCEL_PROJECT_ID",
    "VERCEL_TEAM_ID",
    "ML_REFRESH_TOKEN",
    "ML_APP_ID",
    "ML_CLIENT_SECRET",
  ].filter((k) => !process.env[k]);

  if (missing.length > 0) {
    return res.status(500).json({
      error: "Faltan variables de entorno",
      missing,
    });
  }

  const headers = {
    Authorization: `Bearer ${VERCEL_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  try {
    // 1️⃣ Pedir nuevo access_token a Mercado Libre
    const tokenRes = await axios.post(
      "https://api.mercadolibre.com/oauth/token",
      null,
      {
        params: {
          grant_type: "refresh_token",
          client_id: ML_APP_ID,
          client_secret: ML_CLIENT_SECRET,
          refresh_token: ML_REFRESH_TOKEN,
        },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    const { access_token, refresh_token, expires_in, user_id } = tokenRes.data;

    // 2️⃣ Variables a actualizar
    const envVarsToUpdate = [
      { key: "ML_ACCESS_TOKEN", value: access_token },
      { key: "ML_REFRESH_TOKEN", value: refresh_token },
      { key: "ML_USER_ID", value: user_id?.toString() || ML_USER_ID || "" },
    ];

    // 3️⃣ Guardar en Supabase (tabla tokens)
    const sbResults = [];
    for (const { key, value } of envVarsToUpdate) {
      if (!value) continue;
      const { error } = await supabase.from("tokens").upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
      if (error) {
        console.error(`❌ Error guardando ${key} en Supabase:`, error.message);
        sbResults.push({ key, status: "error", message: error.message });
      } else {
        sbResults.push({ key, status: "saved_supabase" });
      }
    }

    // 4️⃣ Obtener variables actuales en Vercel
    const { data } = await axios.get(
      `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}`,
      { headers }
    );
    const currentVars = data.envs;

    const vercelResults = [];

    // 5️⃣ Upsert en Vercel
    for (const { key, value } of envVarsToUpdate) {
      if (!value) continue;
      const existingVar = currentVars.find((v) => v.key === key);

      const payload = {
        key,
        value,
        target: ["production", "preview", "development"],
        type: "encrypted",
      };

      try {
        if (existingVar) {
          const r = await axios.patch(
            `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env/${existingVar.id}?teamId=${VERCEL_TEAM_ID}`,
            payload,
            { headers }
          );
          vercelResults.push({ key, status: "updated", id: r.data.id });
        } else {
          const r = await axios.post(
            `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}`,
            payload,
            { headers }
          );
          vercelResults.push({ key, status: "created", id: r.data.id });
        }
      } catch (err) {
        console.error(`❌ Error en Vercel al guardar ${key}:`, err.response?.data || err.message);
        vercelResults.push({
          key,
          status: "error",
          message: err.response?.data || err.message,
        });
      }
    }

    // ✅ Respuesta final
    return res.status(200).json({
      success: true,
      expires_in,
      supabase: sbResults,
      vercel: vercelResults,
    });
  } catch (e) {
    console.error("Refresh error:", e.response?.data || e.message);
    return res.status(500).json({
      error: "Error al refrescar el token",
      message: e.message,
      details: e.response?.data,
    });
  }
}
