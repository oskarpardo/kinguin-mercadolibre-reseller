// Endpoint de debugging para identificar el error "Cannot access 'p' before initialization"
// Este archivo usa solo las partes esenciales para identificar donde está el problema

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Función de test que replica las primeras líneas de processSingleProduct
async function debugProcessSingleProduct(kinguinId) {
  console.log(`🔍 DEBUG: Iniciando procesamiento para Kinguin ID: ${kinguinId}`);
  
  try {
    // Test 1: Variables básicas
    const startTime = Date.now();
    let duration;
    let updatedFields = [];
    console.log("✅ Variables básicas inicializadas");

    // Test 2: Reserva atómica (donde creemos que puede estar el problema)
    console.log("🔍 Probando reserva atómica...");
    const reservationResult = await supabase
      .from('published_products')
      .insert({
        kinguin_id: String(kinguinId),
        status: 'processing',
        created_at: new Date().toISOString(),
        job_id: 'debug-test'
      })
      .select()
      .single();

    console.log("✅ Reserva atómica exitosa:", reservationResult);

    // Test 3: Verificar existencia de duplicados
    console.log("🔍 Verificando duplicados...");
    const { data: allDuplicates } = await supabase
      .from('published_products')
      .select('*')
      .eq('kinguin_id', String(kinguinId))
      .order('created_at', { ascending: false });

    console.log("✅ Verificación de duplicados exitosa:", allDuplicates?.length || 0);

    // Test 4: Limpiar después del test
    await supabase
      .from('published_products')
      .delete()
      .eq('kinguin_id', String(kinguinId))
      .eq('job_id', 'debug-test');

    duration = (Date.now() - startTime) / 1000;
    
    return {
      success: true,
      message: "Debug completado exitosamente",
      duration,
      tests: {
        variables: "✅ OK",
        reservation: "✅ OK", 
        duplicates: "✅ OK",
        cleanup: "✅ OK"
      }
    };

  } catch (error) {
    console.error("❌ Error en debug:", error);
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { kinguinId } = req.body;
  
  if (!kinguinId) {
    return res.status(400).json({ error: 'kinguinId is required' });
  }

  try {
    const result = await debugProcessSingleProduct(kinguinId);
    res.status(200).json(result);
  } catch (error) {
    console.error("❌ Error en handler:", error);
    res.status(500).json({ 
      error: error.message,
      stack: error.stack 
    });
  }
}