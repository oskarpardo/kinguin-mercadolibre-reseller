// Webhook para cuando se realiza una venta en ML
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { topic, resource } = req.body;

  if (topic === 'orders_v2') {
    try {
      // Obtener detalles de la orden
      const orderResponse = await axios.get(
        `https://api.mercadolibre.com${resource}`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.ML_ACCESS_TOKEN}`
          }
        }
      );

      const order = orderResponse.data;
      
      // Buscar el producto en Kinguin
      const kinguinProductId = order.order_items[0].item.seller_custom_field;
      
      // Comprar key en Kinguin
      const kinguinOrder = await axios.post(
        'https://gateway.kinguin.net/esa/api/v2/orders',
        {
          products: [{
            productId: kinguinProductId,
            quantity: 1
          }]
        },
        {
          headers: {
            'X-Api-Key': process.env.KINGUIN_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      // Obtener la key
      const keys = kinguinOrder.data.keys;
      
      // Enviar key al comprador por mensaje en ML
      await axios.post(
        `https://api.mercadolibre.com/messages/packs/${order.pack_id}/messages`,
        {
          from: {
            user_id: process.env.ML_USER_ID
          },
          to: {
            user_id: order.buyer.id
          },
          text: `¡Gracias por tu compra! 🎮\n\nAquí está tu código de activación:\n\n🔑 ${keys[0]}\n\nSigue las instrucciones en la descripción del producto para activarlo.\n\n¡Que disfrutes tu juego!`
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.ML_ACCESS_TOKEN}`
          }
        }
      );

      res.status(200).json({ success: true, keySent: true });

    } catch (error) {
      console.error('Webhook Error:', error);
      res.status(500).json({ error: 'Failed to process order' });
    }
  } else {
    res.status(200).json({ received: true });
  }
}
