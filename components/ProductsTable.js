import { useState, useEffect, useCallback } from 'react';
import ProductDetail from './ProductDetail';

const ProductsTable = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [filter, setFilter] = useState('');
  const [stockFilter, setStockFilter] = useState('all'); // 'all', 'in-stock', 'no-stock'
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  
  const ITEMS_PER_PAGE = 20;
  
  // Fetch products with pagination and filtering
  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Prepare query parameters
      const queryParams = new URLSearchParams({
        page,
        limit: ITEMS_PER_PAGE,
        sortBy,
        sortOrder,
      });
      
      if (filter) queryParams.append('filter', filter);
      if (stockFilter !== 'all') queryParams.append('stock', stockFilter === 'in-stock' ? 'true' : 'false');
      
      const response = await fetch(`/api/products?${queryParams.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setProducts(data.products || []);
        setTotalPages(data.totalPages || 1);
        setTotalProducts(data.total || 0);
      } else {
        throw new Error(data.error || 'Error desconocido');
      }
    } catch (err) {
      console.error('Error al obtener productos:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, filter, stockFilter, sortBy, sortOrder]);
  
  // Initial load and when filters/pagination change
  useEffect(() => {
    fetchProducts();
  }, [page, stockFilter, sortBy, sortOrder, fetchProducts]);
  
  // Handle search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1); // Reset to first page on new search
      fetchProducts();
    }, 500);
    
    return () => clearTimeout(timer);
  }, [filter, fetchProducts]);
  
  // Format currency
  const formatCurrency = (value, currency = 'CLP') => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: currency,
      maximumFractionDigits: 0
    }).format(value);
  };
  
  // Handle sorting
  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };
  
  // Generate sort indicator
  const getSortIndicator = (field) => {
    if (sortBy !== field) return '';
    return sortOrder === 'asc' ? ' ↑' : ' ↓';
  };
  
  // Handle bulk update of products with stock
  const handleUpdateProductsWithStock = async () => {
    if (!confirm('¿Estás seguro de actualizar todos los productos con stock? Esto puede tomar tiempo.')) {
      return;
    }
    
    try {
      const response = await fetch('/api/sync-prices-stock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          updateOnlyWithStock: true,
          updateMl: true,
          limit: 100 // limit to avoid overloading
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        alert(`Actualización iniciada. ${data.message || ''}`);
      } else {
        throw new Error(data.error || 'Error al iniciar actualización');
      }
    } catch (err) {
      console.error('Error:', err);
      alert(`Error: ${err.message}`);
    }
  };
  
  return (
    <div className="products-table-container">
      <div className="table-controls">
        <div className="filters">
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Buscar por nombre o ID..." 
              value={filter} 
              onChange={(e) => setFilter(e.target.value)}
            />
            <button className="search-button">🔍</button>
          </div>
          
          <div className="stock-filter">
            <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
              <option value="all">Todos los productos</option>
              <option value="in-stock">Con stock</option>
              <option value="no-stock">Sin stock</option>
            </select>
          </div>
        </div>
        
        <div className="table-actions">
          <button 
            className="refresh-button" 
            onClick={fetchProducts}
            disabled={loading}
          >
            🔄 Actualizar lista
          </button>
          
          <button 
            className="update-all-button"
            onClick={handleUpdateProductsWithStock}
          >
            📊 Actualizar productos con stock
          </button>
        </div>
      </div>
      
      <div className="products-table-wrapper">
        {loading && products.length === 0 ? (
          <div className="loading-container">Cargando productos...</div>
        ) : error ? (
          <div className="error-container">{error}</div>
        ) : products.length === 0 ? (
          <div className="empty-table">
            <p>No se encontraron productos{filter ? ' que coincidan con tu búsqueda' : ''}.</p>
          </div>
        ) : (
          <table className="products-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('name')}>
                  Nombre{getSortIndicator('name')}
                </th>
                <th onClick={() => handleSort('kinguinId')}>
                  ID Kinguin{getSortIndicator('kinguinId')}
                </th>
                <th onClick={() => handleSort('originalPrice')}>
                  Precio Original{getSortIndicator('originalPrice')}
                </th>
                <th onClick={() => handleSort('sellingPrice')}>
                  Precio de Venta{getSortIndicator('sellingPrice')}
                </th>
                <th onClick={() => handleSort('stock')}>
                  Stock{getSortIndicator('stock')}
                </th>
                <th onClick={() => handleSort('lastUpdated')}>
                  Última Actualización{getSortIndicator('lastUpdated')}
                </th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className={product.stock > 0 ? 'has-stock' : 'no-stock'}>
                  <td className="product-name">{product.name}</td>
                  <td>{product.kinguinId}</td>
                  <td>{formatCurrency(product.originalPrice, 'EUR')}</td>
                  <td>{formatCurrency(product.sellingPrice)}</td>
                  <td className={`stock-cell ${product.stock > 0 ? 'in-stock' : 'out-of-stock'}`}>
                    {product.stock > 0 ? product.stock : 'Sin stock'}
                  </td>
                  <td>
                    {product.lastUpdated ? new Date(product.lastUpdated).toLocaleString() : '-'}
                  </td>
                  <td>
                    <button 
                      className="view-button" 
                      onClick={() => setSelectedProduct(product.kinguinId)}
                    >
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      <div className="pagination">
        <div className="pagination-info">
          Mostrando {products.length} de {totalProducts} productos
        </div>
        
        <div className="pagination-controls">
          <button 
            className="pagination-button" 
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            &lt; Anterior
          </button>
          
          <span className="pagination-current">Página {page} de {totalPages}</span>
          
          <button 
            className="pagination-button" 
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Siguiente &gt;
          </button>
        </div>
      </div>
      
      {selectedProduct && (
        <ProductDetail 
          productId={selectedProduct} 
          onClose={() => setSelectedProduct(null)}
        />
      )}
      
      <style jsx>{`
        .products-table-container {
          background: white;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        
        .table-controls {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        
        .filters {
          display: flex;
          gap: 15px;
        }
        
        .search-bar {
          display: flex;
          position: relative;
        }
        
        .search-bar input {
          width: 300px;
          padding: 10px 15px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          font-size: 14px;
        }
        
        .search-button {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          font-size: 16px;
          color: #718096;
        }
        
        .stock-filter select {
          padding: 10px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          background: white;
          font-size: 14px;
          color: #4a5568;
        }
        
        .table-actions {
          display: flex;
          gap: 10px;
        }
        
        .refresh-button, .update-all-button {
          padding: 10px 16px;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .refresh-button {
          background: #edf2f7;
          color: #4a5568;
        }
        
        .refresh-button:hover {
          background: #e2e8f0;
        }
        
        .refresh-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .update-all-button {
          background: #4299e1;
          color: white;
        }
        
        .update-all-button:hover {
          background: #3182ce;
        }
        
        .products-table-wrapper {
          overflow-x: auto;
          margin-bottom: 20px;
        }
        
        .products-table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .products-table th, .products-table td {
          padding: 12px 15px;
          text-align: left;
          border-bottom: 1px solid #e2e8f0;
        }
        
        .products-table th {
          background: #f7fafc;
          color: #4a5568;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          user-select: none;
        }
        
        .products-table th:hover {
          background: #edf2f7;
        }
        
        .products-table td {
          font-size: 14px;
          color: #4a5568;
        }
        
        .products-table tr:hover {
          background: #f7fafc;
        }
        
        .products-table tr.no-stock {
          background: #fff5f5;
        }
        
        .products-table tr.no-stock:hover {
          background: #fed7d7;
        }
        
        .product-name {
          max-width: 300px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .stock-cell {
          font-weight: 600;
        }
        
        .in-stock {
          color: #38a169;
        }
        
        .out-of-stock {
          color: #e53e3e;
        }
        
        .view-button {
          background: #edf2f7;
          border: none;
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.2s;
        }
        
        .view-button:hover {
          background: #e2e8f0;
        }
        
        .pagination {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 20px;
        }
        
        .pagination-info {
          color: #718096;
          font-size: 14px;
        }
        
        .pagination-controls {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .pagination-button {
          padding: 8px 12px;
          border: 1px solid #e2e8f0;
          border-radius: 4px;
          background: white;
          color: #4a5568;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .pagination-button:hover:not(:disabled) {
          background: #edf2f7;
        }
        
        .pagination-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .pagination-current {
          font-size: 14px;
          color: #4a5568;
        }
        
        .loading-container, .error-container, .empty-table {
          padding: 40px;
          text-align: center;
          color: #718096;
        }
        
        .error-container {
          background: #fed7d7;
          color: #c53030;
          border-radius: 8px;
        }
        
        @media (max-width: 1024px) {
          .table-controls {
            flex-direction: column;
            align-items: flex-start;
            gap: 15px;
          }
          
          .search-bar input {
            width: 100%;
          }
        }
        
        @media (max-width: 768px) {
          .filters {
            flex-direction: column;
            width: 100%;
          }
          
          .search-bar {
            width: 100%;
          }
          
          .search-bar input {
            width: 100%;
          }
          
          .stock-filter select {
            width: 100%;
          }
          
          .table-actions {
            width: 100%;
            flex-direction: column;
          }
          
          .refresh-button, .update-all-button {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
};

export default ProductsTable;