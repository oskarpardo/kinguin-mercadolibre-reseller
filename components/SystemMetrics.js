import { useState, useEffect, useCallback } from 'react';

const SystemMetrics = ({ visible = true, refreshInterval = 5000 }) => {
  const [metrics, setMetrics] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Cargar métricas del sistema
  const fetchMetrics = useCallback(async () => {
    if (!visible) return;
    
    try {
      setIsLoading(true);
      const response = await fetch('/api/system-metrics');
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      if (data.success && data.metrics) {
        setMetrics(data.metrics);
        setError(null);
      } else {
        throw new Error('Formato de respuesta inválido');
      }
    } catch (err) {
      console.error('Error al cargar métricas:', err);
      setError(`Error al cargar métricas: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [visible]);
  
  // Cargar métricas y configurar intervalo de actualización
  useEffect(() => {
    if (visible) {
      fetchMetrics();
      
      const interval = setInterval(fetchMetrics, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [visible, refreshInterval, fetchMetrics]);
  
  if (!visible) {
    return null;
  }
  
  // Formatear fechas
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    
    const date = new Date(dateString);
    return date.toLocaleString();
  };
  
  // Calcular tiempo transcurrido
  const getElapsedTime = (dateString) => {
    if (!dateString) return 'N/A';
    
    const start = new Date(dateString);
    const now = new Date();
    const diffMs = now - start;
    
    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else {
      return `${minutes}m`;
    }
  };
  
  return (
    <div className="metrics-panel">
      <style jsx>{`
        .metrics-panel {
          background: white;
          border-radius: 12px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
          margin-bottom: 25px;
          animation: fadeIn 0.3s ease;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        .metrics-header {
          padding: 20px;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .metrics-title {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: #2d3748;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .button-group {
          display: flex;
          gap: 10px;
        }
        
        .refresh-button, .clean-button {
          background: #edf2f7;
          border: none;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 5px;
          color: #4a5568;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .refresh-button:hover, .clean-button:hover {
          background: #e2e8f0;
        }
        
        .clean-button {
          background: #fff5f5;
          color: #e53e3e;
        }
        
        .clean-button:hover {
          background: #fed7d7;
        }
        
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          padding: 20px;
        }
        
        .metric-card {
          background: #f7fafc;
          border-radius: 8px;
          padding: 15px;
          border: 1px solid #e2e8f0;
        }
        
        .metric-card-title {
          font-size: 14px;
          color: #718096;
          margin: 0 0 10px 0;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        
        .metric-value {
          font-size: 24px;
          font-weight: 700;
          color: #2d3748;
          margin: 0;
        }
        
        .metric-subtitle {
          font-size: 13px;
          color: #a0aec0;
          margin: 5px 0 0 0;
        }
        
        .sub-metrics {
          display: flex;
          gap: 15px;
          margin-top: 15px;
        }
        
        .sub-metric {
          flex: 1;
          background: white;
          padding: 10px;
          border-radius: 6px;
          border: 1px solid #edf2f7;
        }
        
        .sub-metric-title {
          font-size: 12px;
          color: #718096;
          margin: 0;
        }
        
        .sub-metric-value {
          font-size: 18px;
          font-weight: 600;
          color: #2d3748;
          margin: 5px 0 0 0;
        }
        
        .active-jobs {
          margin-top: 20px;
        }
        
        .active-jobs-title {
          font-size: 14px;
          color: #718096;
          margin: 0 0 10px 0;
        }
        
        .job-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        
        .job-item {
          background: white;
          border-radius: 6px;
          padding: 12px;
          border: 1px solid #edf2f7;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .job-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        
        .job-id {
          font-size: 14px;
          font-weight: 600;
          color: #2d3748;
        }
        
        .job-details {
          font-size: 12px;
          color: #718096;
        }
        
        .job-status {
          font-size: 12px;
          font-weight: 600;
          padding: 4px 8px;
          border-radius: 12px;
        }
        
        .status-running {
          background: #ebf8ff;
          color: #3182ce;
        }
        
        .status-completed {
          background: #e6fffa;
          color: #38b2ac;
        }
        
        .status-failed {
          background: #fed7d7;
          color: #e53e3e;
        }
        
        .loading-container {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 40px;
          color: #a0aec0;
          flex-direction: column;
          gap: 15px;
        }
        
        .spinner {
          border: 3px solid #e2e8f0;
          border-radius: 50%;
          border-top: 3px solid #667eea;
          width: 24px;
          height: 24px;
          animation: spin 1s linear infinite;
        }
        
        .error-container {
          background: #fed7d7;
          color: #c53030;
          padding: 15px;
          border-radius: 8px;
          margin: 20px;
          text-align: center;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        @media (max-width: 768px) {
          .metrics-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
      
      <div className="metrics-header">
        <h3 className="metrics-title">
          <span>📊</span> Métricas del Sistema
        </h3>
        <div className="button-group">
          <button className="refresh-button" onClick={fetchMetrics} disabled={isLoading}>
            {isLoading ? <span className="spinner"></span> : <span>🔄</span>}
            Actualizar
          </button>
          <button 
            className="clean-button" 
            onClick={async () => {
              try {
                const response = await fetch('/api/clean-stalled-jobs', {
                  method: 'POST',
                });
                if (response.ok) {
                  await fetchMetrics();
                  alert('Trabajos estancados actualizados correctamente');
                } else {
                  alert('Error al limpiar trabajos estancados');
                }
              } catch (err) {
                console.error('Error:', err);
                alert(`Error: ${err.message}`);
              }
            }}
          >
            <span>🧹</span>
            Limpiar trabajos estancados
          </button>
        </div>
      </div>
      
      {error && (
        <div className="error-container">
          {error}
        </div>
      )}
      
      {isLoading && !metrics ? (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Cargando métricas...</p>
        </div>
      ) : metrics ? (
        <div className="metrics-grid">
          {/* Métrica de productos */}
          <div className="metric-card">
            <h4 className="metric-card-title">
              <span>🛒</span> Productos Publicados
            </h4>
            <p className="metric-value">{metrics.products?.total || 0}</p>
            <p className="metric-subtitle">Total de productos en MercadoLibre</p>
            
            <div className="sub-metrics">
              <div className="sub-metric">
                <p className="sub-metric-title">Hoy</p>
                <p className="sub-metric-value">{metrics.products?.today || 0}</p>
              </div>
              <div className="sub-metric">
                <p className="sub-metric-title">Esta Semana</p>
                <p className="sub-metric-value">{metrics.products?.this_week || 0}</p>
              </div>
            </div>
          </div>
          
          {/* Métrica de trabajos */}
          <div className="metric-card">
            <h4 className="metric-card-title">
              <span>⚙️</span> Procesos Activos
            </h4>
            <p className="metric-value">{metrics.jobs?.active || 0}</p>
            <p className="metric-subtitle">Trabajos en ejecución</p>
            
            {metrics.jobs?.active > 0 && (
              <div className="active-jobs">
                <h5 className="active-jobs-title">Trabajos en curso:</h5>
                <div className="job-list">
                  {metrics.jobs.recent
                    .filter(job => job.status === 'running')
                    .map(job => (
                      <div className="job-item" key={job.id}>
                        <div className="job-info">
                          <span className="job-id">Job #{job.id}</span>
                          <span className="job-details">
                            {job.total_products} productos | Iniciado: {formatDate(job.created_at)}
                          </span>
                        </div>
                        <span className="job-status status-running">En curso</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
          
          {/* Historial de trabajos recientes */}
          <div className="metric-card">
            <h4 className="metric-card-title">
              <span>📋</span> Trabajos Recientes
            </h4>
            {metrics.jobs?.recent && metrics.jobs.recent.length > 0 ? (
              <div className="job-list">
                {metrics.jobs.recent
                  .filter(job => job.status !== 'running')
                  .slice(0, 5)
                  .map(job => (
                    <div className="job-item" key={job.id}>
                      <div className="job-info">
                        <span className="job-id">Job #{job.id}</span>
                        <span className="job-details">
                          {job.total_products} productos | {formatDate(job.created_at)}
                        </span>
                      </div>
                      <span className={`job-status status-${job.status}`}>
                        {job.status === 'completed' ? 'Completado' : 
                         job.status === 'failed' ? 'Fallido' : job.status}
                      </span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="metric-subtitle">No hay trabajos recientes</p>
            )}
          </div>
          
          {/* Estado del sistema */}
          <div className="metric-card">
            <h4 className="metric-card-title">
              <span>🖥️</span> Estado del Sistema
            </h4>
            <div className="sub-metrics">
              <div className="sub-metric">
                <p className="sub-metric-title">Estado</p>
                <p className="sub-metric-value" style={{ color: metrics.system?.status === 'online' ? '#38b2ac' : '#e53e3e' }}>
                  {metrics.system?.status === 'online' ? 'En Línea' : 'Desconectado'}
                </p>
              </div>
              <div className="sub-metric">
                <p className="sub-metric-title">Última Actualización</p>
                <p className="sub-metric-value">
                  {getElapsedTime(metrics.system?.lastUpdate)} atrás
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SystemMetrics;