import { useState, useEffect, useCallback } from 'react';

const PriceHistoryChart = ({ kinguinId = null, mlId = null, days = 30 }) => {
  const [historyData, setHistoryData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  
  const fetchPriceHistory = useCallback(async () => {
    if (!kinguinId && !mlId) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const queryParams = new URLSearchParams();
      
      if (kinguinId) queryParams.append('kinguinId', kinguinId);
      if (mlId) queryParams.append('mlId', mlId);
      queryParams.append('days', days);
      
      const response = await fetch(`/api/price-history?${queryParams.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setHistoryData(data.history || []);
        setStats(data.stats || null);
      } else {
        throw new Error(data.error || 'Error desconocido');
      }
    } catch (err) {
      console.error('Error al obtener historial de precios:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [kinguinId, mlId, days]);
  
  useEffect(() => {
    fetchPriceHistory();
  }, [kinguinId, mlId, days, fetchPriceHistory]);
  
  // Formatear fecha
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };
  
  // Formatear precio
  const formatPrice = (price) => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0
    }).format(price);
  };
  
  // Clasificar cambio de precio
  const getPriceChangeClass = (percentage) => {
    if (percentage > 5) return 'price-increase-significant';
    if (percentage > 0) return 'price-increase-minor';
    if (percentage < -5) return 'price-decrease-significant';
    if (percentage < 0) return 'price-decrease-minor';
    return 'price-no-change';
  };
  
  return (
    <div className="price-history-chart">
      <style jsx>{`
        .price-history-chart {
          background: white;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        
        .history-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        
        .history-title {
          font-size: 18px;
          font-weight: 600;
          color: #2d3748;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .refresh-button {
          background: #edf2f7;
          border: none;
          padding: 6px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 5px;
          color: #4a5568;
          transition: all 0.2s;
        }
        
        .refresh-button:hover {
          background: #e2e8f0;
        }
        
        .spinner {
          border: 2px solid rgba(0, 0, 0, 0.1);
          border-radius: 50%;
          border-top: 2px solid #3182ce;
          width: 16px;
          height: 16px;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .history-stats {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 20px;
          padding: 15px;
          background: #f7fafc;
          border-radius: 8px;
        }
        
        .stat-item {
          flex: 1;
          min-width: 120px;
          background: white;
          padding: 10px;
          border-radius: 6px;
          border: 1px solid #edf2f7;
        }
        
        .stat-label {
          font-size: 12px;
          color: #718096;
          margin: 0;
        }
        
        .stat-value {
          font-size: 16px;
          font-weight: 600;
          margin: 5px 0 0 0;
          color: #2d3748;
        }
        
        .history-table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .history-table th {
          text-align: left;
          padding: 12px 15px;
          background: #f7fafc;
          color: #4a5568;
          font-size: 14px;
          font-weight: 600;
          border-bottom: 2px solid #e2e8f0;
        }
        
        .history-table td {
          padding: 12px 15px;
          border-bottom: 1px solid #e2e8f0;
          color: #4a5568;
          font-size: 14px;
        }
        
        .history-table tr:last-child td {
          border-bottom: none;
        }
        
        .history-table tr:nth-child(even) {
          background: #f7fafc;
        }
        
        .history-table tr:hover {
          background: #edf2f7;
        }
        
        .price-change {
          font-weight: 600;
          padding: 4px 8px;
          border-radius: 12px;
          display: inline-block;
        }
        
        .price-increase-significant {
          background: #fed7d7;
          color: #e53e3e;
        }
        
        .price-increase-minor {
          background: #feebc8;
          color: #dd6b20;
        }
        
        .price-decrease-significant {
          background: #c6f6d5;
          color: #38a169;
        }
        
        .price-decrease-minor {
          background: #e6fffa;
          color: #319795;
        }
        
        .price-no-change {
          background: #e9eaec;
          color: #718096;
        }
        
        .empty-history, .loading-container, .error-container {
          padding: 30px 0;
          text-align: center;
          color: #718096;
        }
        
        .error-container {
          background: #fed7d7;
          color: #c53030;
          padding: 15px;
          border-radius: 8px;
          margin-top: 10px;
          margin-bottom: 10px;
        }
        
        @media (max-width: 640px) {
          .history-stats {
            flex-direction: column;
          }
          
          .stat-item {
            width: 100%;
          }
          
          .history-table {
            display: block;
            overflow-x: auto;
          }
        }
      `}</style>
      
      <div className="history-header">
        <h3 className="history-title">
          <span>📈</span> Historial de Precios
          {kinguinId && <span> - Producto {kinguinId}</span>}
        </h3>
        
        <button className="refresh-button" onClick={fetchPriceHistory} disabled={loading}>
          {loading ? <span className="spinner"></span> : <span>🔄</span>}
          Actualizar
        </button>
      </div>
      
      {loading ? (
        <div className="loading-container">Cargando historial de precios...</div>
      ) : error ? (
        <div className="error-container">{error}</div>
      ) : historyData.length === 0 ? (
        <div className="empty-history">
          <p>No hay historial de cambios de precio para este producto</p>
        </div>
      ) : (
        <>
          {stats && (
            <div className="history-stats">
              <div className="stat-item">
                <p className="stat-label">Cambios totales</p>
                <p className="stat-value">{stats.changeCount}</p>
              </div>
              <div className="stat-item">
                <p className="stat-label">Cambio promedio</p>
                <p className="stat-value">{stats.avgChange.toFixed(2)}%</p>
              </div>
              <div className="stat-item">
                <p className="stat-label">Mayor subida</p>
                <p className="stat-value" style={{ color: '#e53e3e' }}>+{stats.maxIncrease.toFixed(2)}%</p>
              </div>
              <div className="stat-item">
                <p className="stat-label">Mayor bajada</p>
                <p className="stat-value" style={{ color: '#38a169' }}>{stats.maxDecrease.toFixed(2)}%</p>
              </div>
            </div>
          )}
          
          <table className="history-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Precio anterior</th>
                <th>Nuevo precio</th>
                <th>Cambio</th>
                <th>Tasa EUR/CLP</th>
              </tr>
            </thead>
            <tbody>
              {historyData.map((record) => (
                <tr key={record.id}>
                  <td>{formatDate(record.recorded_at)}</td>
                  <td>{formatPrice(record.old_price)}</td>
                  <td>{formatPrice(record.new_price)}</td>
                  <td>
                    <span className={`price-change ${getPriceChangeClass(record.change_percentage)}`}>
                      {record.change_percentage > 0 ? '+' : ''}{record.change_percentage.toFixed(2)}%
                    </span>
                  </td>
                  <td>{record.exchange_rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};

export default PriceHistoryChart;