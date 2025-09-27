// pages/api/_offer-utils.js
// Utilidades para manejo de ofertas y stock de Kinguin

/**
 * Verifica si una oferta es válida (tiene precio y stock)
 * Acepta diferentes formatos de respuesta de la API de Kinguin
 * @param {Object} offer - Objeto de oferta de la API de Kinguin
 * @returns {boolean} - true si la oferta es válida
 */
export function isValidOffer(offer) {
  if (!offer || typeof offer !== 'object') return false;
  
  // Verificar que tenga precio > 0
  const hasPrice = typeof offer.price === 'number' && offer.price > 0;
  if (!hasPrice) return false;
  
  // Verificar que tenga stock > 0 (en cualquiera de los campos posibles)
  const hasStock = (
    // Formato principal
    (typeof offer.quantity === 'number' && offer.quantity > 0) ||
    // Formato alternativo
    (typeof offer.qty === 'number' && offer.qty > 0) ||
    // Otro formato posible
    (typeof offer.quantityOffers === 'number' && offer.quantityOffers > 0) ||
    // En algunos casos, la existencia de price implica stock
    (typeof offer.stock === 'boolean' && offer.stock === true)
  );
  
  return hasPrice && hasStock;
}

/**
 * Obtiene las ofertas válidas de un producto
 * @param {Object} productData - Datos del producto de la API de Kinguin
 * @returns {Array} - Array de ofertas válidas
 */
export function getValidOffers(productData) {
  if (!productData || !Array.isArray(productData.offers)) {
    return [];
  }
  
  return productData.offers.filter(isValidOffer);
}

/**
 * Verifica si un producto tiene al menos una oferta válida
 * @param {Object} productData - Datos del producto de la API de Kinguin
 * @returns {boolean} - true si el producto tiene al menos una oferta válida
 */
export function hasValidOffers(productData) {
  const validOffers = getValidOffers(productData);
  return validOffers.length > 0;
}

/**
 * Obtiene la oferta de menor precio de un producto
 * @param {Object} productData - Datos del producto de la API de Kinguin
 * @returns {Object|null} - La oferta de menor precio o null si no hay ofertas válidas
 */
export function getLowestPriceOffer(productData) {
  const validOffers = getValidOffers(productData);
  if (validOffers.length === 0) return null;
  
  return validOffers.sort((a, b) => a.price - b.price)[0];
}

/**
 * Obtiene la cantidad de stock disponible de una oferta
 * @param {Object} offer - Objeto de oferta de la API de Kinguin
 * @returns {number} - Cantidad de stock disponible
 */
export function getOfferQuantity(offer) {
  if (!offer) return 0;
  
  if (typeof offer.quantity === 'number') return offer.quantity;
  if (typeof offer.qty === 'number') return offer.qty;
  if (typeof offer.quantityOffers === 'number') return offer.quantityOffers;
  
  return offer.stock === true ? 1 : 0;
}

/**
 * Obtiene el vendedor de una oferta
 * @param {Object} offer - Objeto de oferta de la API de Kinguin
 * @returns {string} - ID o nombre del vendedor
 */
export function getOfferSeller(offer) {
  if (!offer) return 'Unknown';
  
  return offer.sellerId || offer.merchantName || 'Unknown';
}

/**
 * Obtiene un resumen de las ofertas disponibles
 * @param {Object} productData - Datos del producto de la API de Kinguin
 * @returns {Object} - Resumen de ofertas
 */
export function getOffersSummary(productData) {
  const validOffers = getValidOffers(productData);
  
  if (validOffers.length === 0) {
    return {
      hasOffers: false,
      totalOffers: 0,
      lowestPrice: null,
      totalStock: 0,
      sellers: []
    };
  }
  
  const lowestPriceOffer = getLowestPriceOffer(productData);
  const totalStock = validOffers.reduce((sum, offer) => sum + getOfferQuantity(offer), 0);
  const sellers = [...new Set(validOffers.map(offer => getOfferSeller(offer)))];
  
  return {
    hasOffers: true,
    totalOffers: validOffers.length,
    lowestPrice: lowestPriceOffer ? lowestPriceOffer.price : null,
    totalStock,
    sellers
  };
}