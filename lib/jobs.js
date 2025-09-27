import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Crea una nueva entrada de trabajo en la base de datos.
 * @param {string} jobType - El tipo de trabajo (ej. 'add-product').
 * @param {string[]} kinguinIds - Los IDs que se procesarán.
 * @returns {Promise<string>} El ID del trabajo creado.
 */
export async function createJob(jobType, kinguinIds) {
  const { data, error } = await supabase
    .from("job_logs")
    .insert({
      status: "running",
      total_products: kinguinIds.length,
      summary: { type: jobType },
      details: { initial_ids: kinguinIds },
    })
    .select("id")
    .single();

  if (error) throw new Error(`Error al crear el job en Supabase: ${error.message}`);
  return data.id;
}

/**
 * Actualiza el progreso de un trabajo existente.
 * @param {string} jobId - El ID del trabajo a actualizar.
 * @param {object[]} results - Los resultados parciales acumulados.
 */
export async function updateJobProgress(jobId, results) {
  const summary = results.reduce((acc, result) => {
    const key = result.status;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  await supabase.from("job_logs").update({
    results,
    summary,
  }).eq("id", jobId);
}

/**
 * Actualiza un trabajo existente con los resultados finales.
 * @param {string} jobId - El ID del trabajo a actualizar.
 * @param {object} summary - El resumen de los resultados.
 * @param {object[]} results - Los resultados detallados de cada producto.
 */
export async function completeJob(jobId, summary, results) {
  const finalSummary = { ...summary, total: results.length };
  await supabase.from("job_logs")
    .update({
      status: "completed",
      summary: finalSummary,
      results,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export async function failJob(jobId, error) {
  await supabase.from("job_logs")
    .update({ status: "failed", summary: { error: error.message } })
    .eq("id", jobId);
}