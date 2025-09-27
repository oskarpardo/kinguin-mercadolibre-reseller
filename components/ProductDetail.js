import { useState, useEffect } from 'react';
import Image from 'next/image';
import PriceHistoryChart from './PriceHistoryChart';

const ProductDetail = ({ productId, onClose }) => {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showPriceHistory, setShowPriceHistory] = useState(false);
  
  // Fetch product details
  useEffect(() => {
    const fetchProductDetails = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/get-product?id=${productId}`);
        
        if (!response.ok) {
          throw new Error(`Error ${response.status}: ${await response.text()}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.product) {
          setProduct(data.product);
        } else {
          throw new Error(data.error || 'No se pudo obtener el producto');
        }
      } catch (err) {
        console.error('Error al obtener detalles del producto:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    if (productId) {
      fetchProductDetails();
    }
  }, [productId]);
  
  // Function to update product stock/price
  const handleUpdateProduct = async () => {
    try {
      setLoading(true);
      
      const response = await fetch('/api/sync-prices-stock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          productIds: [productId],
          updateMl: true
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        // Refrescar los datos del producto
        const updatedProductResponse = await fetch(`/api/get-product?id=${productId}`);
        if (updatedProductResponse.ok) {
          const updatedData = await updatedProductResponse.json();
          if (updatedData.success && updatedData.product) {
            setProduct(updatedData.product);
          }
        }
        
        alert('Producto actualizado correctamente');
      } else {
        throw new Error(data.error || 'Error al actualizar el producto');
      }
    } catch (err) {
      console.error('Error al actualizar producto:', err);
      setError(err.message);
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  // Format currency
  const formatCurrency = (value, currency = 'CLP') => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: currency,
      maximumFractionDigits: 0
    }).format(value);
  };
  
  if (loading && !product) {
    return (
      <div className="product-detail-modal">
        <div className="product-detail-content">
          <div className="product-detail-header">
            <h2>Cargando producto...</h2>
            <button className="close-button" onClick={onClose}>×</button>
          </div>
          <div className="loading-spinner"></div>
        </div>
        <style jsx>{modalStyles}</style>
      </div>
    );
  }
  
  if (error && !product) {
    return (
      <div className="product-detail-modal">
        <div className="product-detail-content">
          <div className="product-detail-header">
            <h2>Error</h2>
            <button className="close-button" onClick={onClose}>×</button>
          </div>
          <div className="error-message">
            {error}
          </div>
        </div>
        <style jsx>{modalStyles}</style>
      </div>
    );
  }
  
  if (!product) {
    return null;
  }
  
  return (
    <div className="product-detail-modal">
      <div className="product-detail-content">
        <div className="product-detail-header">
          <h2>{product.name || 'Detalle del producto'}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="product-detail-body">
          <div className="product-info-grid">
            <div className="product-image">
              {product.image && (
                <Image 
                  src={product.image} 
                  alt={product.name}
                  width={300}
                  height={200}
                  style={{objectFit: 'contain'}}
                />
              )}
            </div>
            
            <div className="product-info">
              <div className="info-row">
                <span className="info-label">ID Kinguin:</span>
                <span className="info-value">{product.kinguinId}</span>
              </div>
              
              {product.mlId && (
                <div className="info-row">
                  <span className="info-label">ID MercadoLibre:</span>
                  <span className="info-value">{product.mlId}</span>
                </div>
              )}
              
              <div className="info-row">
                <span className="info-label">Precio Original:</span>
                <span className="info-value">{formatCurrency(product.originalPrice, 'EUR')}</span>
              </div>
              
              <div className="info-row">
                <span className="info-label">Precio de Venta:</span>
                <span className="info-value">{formatCurrency(product.sellingPrice)}</span>
              </div>
              
              <div className="info-row">
                <span className="info-label">Stock:</span>
                <span className={`info-value stock-value ${product.stock > 0 ? 'in-stock' : 'out-of-stock'}`}>
                  {product.stock > 0 ? product.stock : 'Sin stock'}
                </span>
              </div>
              
              {product.lastUpdated && (
                <div className="info-row">
                  <span className="info-label">Última actualización:</span>
                  <span className="info-value">
                    {new Date(product.lastUpdated).toLocaleString()}
                  </span>
                </div>
              )}
              
              <div className="action-buttons">
                <button 
                  className="update-button" 
                  onClick={handleUpdateProduct}
                  disabled={loading}
                >
                  {loading ? 'Actualizando...' : 'Actualizar producto'}
                </button>
                
                <button 
                  className="history-button" 
                  onClick={() => setShowPriceHistory(!showPriceHistory)}
                >
                  {showPriceHistory ? 'Ocultar historial' : 'Ver historial de precios'}
                </button>
              </div>
            </div>
          </div>
          
          {showPriceHistory && (
            <div className="price-history-section">
              <PriceHistoryChart kinguinId={product.kinguinId} days={90} />
            </div>
          )}
        </div>
      </div>
      <style jsx>{modalStyles}</style>
    </div>
  );
};

// Estilos para el componente
const modalStyles = `
  .product-detail-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  
  .product-detail-content {
    background: white;
    width: 90%;
    max-width: 900px;
    max-height: 90vh;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.2);
  }
  
  .product-detail-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 24px;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
  }
  
  .product-detail-header h2 {
    margin: 0;
    font-size: 20px;
    color: #2d3748;
  }
  
  .close-button {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: #718096;
    transition: color 0.2s;
  }
  
  .close-button:hover {
    color: #e53e3e;
  }
  
  .product-detail-body {
    padding: 24px;
    overflow-y: auto;
    max-height: calc(90vh - 70px);
  }
  
  .loading-spinner {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 200px;
  }
  
  .loading-spinner:after {
    content: '';
    width: 50px;
    height: 50px;
    border: 6px solid #e2e8f0;
    border-radius: 50%;
    border-top-color: #4299e1;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  .error-message {
    padding: 16px;
    background: #fed7d7;
    color: #c53030;
    border-radius: 8px;
    margin: 24px 0;
  }
  
  .product-info-grid {
    display: grid;
    grid-template-columns: minmax(200px, 30%) 1fr;
    gap: 24px;
    margin-bottom: 24px;
  }
  
  .product-image {
    border-radius: 8px;
    overflow: hidden;
    background: #f7fafc;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
  }
  
  .product-image img {
    width: 100%;
    height: auto;
    object-fit: contain;
  }
  
  .product-info {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  
  .info-row {
    display: flex;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1px solid #edf2f7;
  }
  
  .info-label {
    color: #718096;
    font-size: 14px;
    font-weight: 500;
  }
  
  .info-value {
    color: #2d3748;
    font-size: 16px;
    font-weight: 600;
  }
  
  .stock-value.in-stock {
    color: #38a169;
  }
  
  .stock-value.out-of-stock {
    color: #e53e3e;
  }
  
  .action-buttons {
    display: flex;
    gap: 12px;
    margin-top: 16px;
  }
  
  .update-button, .history-button {
    padding: 10px 16px;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .update-button {
    background: #4299e1;
    color: white;
  }
  
  .update-button:hover {
    background: #3182ce;
  }
  
  .update-button:disabled {
    background: #a0aec0;
    cursor: not-allowed;
  }
  
  .history-button {
    background: #edf2f7;
    color: #4a5568;
  }
  
  .history-button:hover {
    background: #e2e8f0;
  }
  
  .price-history-section {
    margin-top: 32px;
  }
  
  @media (max-width: 768px) {
    .product-info-grid {
      grid-template-columns: 1fr;
    }
    
    .action-buttons {
      flex-direction: column;
    }
  }
`;

export default ProductDetail;