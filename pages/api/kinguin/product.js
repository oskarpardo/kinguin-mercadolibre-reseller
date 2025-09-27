import axios from 'axios';

const KINGUIN_API_KEY = process.env.KINGUIN_API_KEY || '5231bbfbf65aa83efa6636965268e5f9';
const KINGUIN_BASE_URL = 'https://gateway.kinguin.net/esa/api/v2';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { productId } = req.query;

  if (!productId) {
    return res.status(400).json({ error: 'Product ID required' });
  }

  try {
    // Obtener producto de Kinguin
    const response = await axios.get(`${KINGUIN_BASE_URL}/products/${productId}`, {
      headers: {
        'X-Api-Key': KINGUIN_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    const product = response.data;

    // Obtener el precio más bajo
    const offersResponse = await axios.get(`${KINGUIN_BASE_URL}/products/${productId}/offers`, {
      headers: {
        'X-Api-Key': KINGUIN_API_KEY,
        'Content-Type': 'application/json'
      },
      params: {
        limit: 1,
        sort: 'price,asc'
      }
    });

    const lowestPrice = offersResponse.data.results[0]?.price || product.price;

    res.status(200).json({
      productId: product.id,
      name: product.name,
      platform: product.platform || 'Steam',
      type: product.type || 'key',
      lowestOfferPriceEUR: lowestPrice,
      coverImage: product.coverImage,
      description: product.description,
      genre: product.genre,
      regionId: product.regionId,
      merchantName: offersResponse.data.results[0]?.merchantName
    });

  } catch (error) {
    console.error('Kinguin API Error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to fetch product from Kinguin',
      details: error.response?.data || error.message 
    });
  }
}
