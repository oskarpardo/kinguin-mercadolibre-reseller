import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Webhook endpoint para recibir notificaciones automáticas de Kinguin
 * Responde con 204 No Content como requiere Kinguin
 */
export default async function handler(req, res) {
  // Solo aceptar POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Use POST.' });
  }

  try {
    // Obtener headers de Kinguin
    const eventName = req.headers['x-event-name'];
    const eventSecret = req.headers['x-event-secret'];
    
    console.log(`🔔 Webhook recibido: ${eventName || 'TEST'}`, {
      headers: req.headers,
      body: req.body
    });

    // Validar secrets conocidos (32 caracteres máximo)
    const validSecrets = [
      'haerin2025productupdate789xyz', // Product Update
      'haerin2025ordercomplete123abc', // Order Complete
      'haerin2025orderstatus456def',   // Order Status
      process.env.KINGUIN_WEBHOOK_SECRET // Variable de entorno
    ].filter(Boolean);

    // Si hay secret, validarlo
    if (eventSecret && validSecrets.length > 0 && !validSecrets.includes(eventSecret)) {
      console.warn(`🚨 Secret inválido: ${eventSecret}`);
      return res.status(401).json({ error: 'Secret inválido' });
    }

    // Guardar webhook en cola para procesamiento posterior
    try {
      await supabase.from('webhook_queue').insert({
        event_type: eventName || 'test',
        kinguin_id: req.body?.kinguinId || 0,
        payload: req.body || {},
        processed: false
      });
    } catch (dbError) {
      console.warn(`⚠️ Error guardando en DB: ${dbError.message}`);
      // No fallar el webhook por errores de DB
    }

    // Log del evento procesado
    if (eventName === 'product.update') {
      console.log(`📦 Producto actualizado: ${req.body?.kinguinId} - Stock: ${req.body?.qty}`);
    } else if (eventName === 'order.status') {
      console.log(`📋 Orden ${req.body?.orderId} cambió a: ${req.body?.status}`);
    } else {
      console.log(`🔍 Evento desconocido o prueba de conexión`);
    }

    // Kinguin requiere respuesta 204 No Content (sin body)
    return res.status(204).end();

  } catch (error) {
    console.error(`💥 Error en webhook:`, error);
    
    // Aún así devolver 204 para evitar reintentos
    return res.status(204).end();
  }
}