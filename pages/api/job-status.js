import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido, usa GET" });
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: "Se requiere el parámetro 'id' del trabajo." });
  }

  try {
    const { data, error } = await supabase
      .from("job_logs")
      .select("status, summary, results, total_products")
      .eq("id", id)
      .single();

    if (error) throw error;

    // Asegurarse de que 'results' sea siempre un array para evitar errores en el cliente.
    const responseData = { ...data, results: data.results || [] };

    return res.status(200).json(responseData);
  } catch (error) {
    return res.status(500).json({ error: "Error al consultar el estado del trabajo.", details: error.message });
  }
}