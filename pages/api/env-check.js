// pages/api/env-check.js
export default async function handler(req, res) {
  const mask = v => (v ? `${v.slice(0, 12)}…(${v.length})` : null);
  return res.json({
    NODE_ENV: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV || null, // "production" | "preview" | "development"
    has: {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      KINGUIN_API_KEY: !!process.env.KINGUIN_API_KEY,
      ML_ACCESS_TOKEN: !!process.env.ML_ACCESS_TOKEN,
    },
    // Muestra prefijo enmascarado para confirmar que Vercel carga el token correcto
    preview: {
      ML_ACCESS_TOKEN: mask(process.env.ML_ACCESS_TOKEN || ""),
      KINGUIN_API_KEY: mask(process.env.KINGUIN_API_KEY || ""),
    },
  });
}
