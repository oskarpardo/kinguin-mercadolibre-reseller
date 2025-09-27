import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSupabase() {
  try {
    // Una consulta ligera para verificar la conexión y las credenciales.
    const { error } = await supabase.from('tokens').select('key').limit(1);
    if (error) throw error;
    return { status: 'ok', message: 'Connection successful' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

async function checkKinguin() {
  if (process.env.KINGUIN_API_KEY) {
    return { status: 'ok', message: 'API Key is configured' };
  } else {
    return { status: 'error', message: 'KINGUIN_API_KEY is not set' };
  }
}

async function checkMercadoLibre() {
  try {
    const { data, error } = await supabase
      .from("tokens")
      .select("value")
      .eq("key", "ML_ACCESS_TOKEN")
      .single();
    if (error || !data?.value) {
        throw new Error("ML_ACCESS_TOKEN not found in Supabase");
    }
    return { status: 'ok', message: 'ML_ACCESS_TOKEN is accessible' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

export default async function handler(req, res) {
  const checks = {
    supabase: await checkSupabase(),
    kinguin: await checkKinguin(),
    mercadoLibre: await checkMercadoLibre(),
  };

  const isHealthy = Object.values(checks).every(check => check.status === 'ok');

  if (isHealthy) {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      checks,
    });
  } else {
    console.error("🚨 Health Check fallido:", checks);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      checks,
    });
  }
}