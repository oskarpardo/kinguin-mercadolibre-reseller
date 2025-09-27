export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido, usa POST" });
  }
  
  console.log('[Cache] La funcionalidad de caché está deshabilitada.');
  return res.status(200).json({ message: "La funcionalidad de caché está deshabilitada. No hay caché que limpiar." });
}