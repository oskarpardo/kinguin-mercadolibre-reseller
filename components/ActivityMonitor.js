import { useState, useEffect, useRef, useCallback } from 'react';

const ActivityMonitor = ({ visible = true, jobId = null, maxLogs = 100 }) => {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef(null);
  const logsContainerRef = useRef(null);
  
  // Función para cargar logs
  const fetchLogs = useCallback(async () => {
    if (!visible) return;
    
    try {
      setIsLoading(true);
      const queryParams = new URLSearchParams();
      queryParams.append('limit', maxLogs);
      
      if (jobId) {
        queryParams.append('jobId', jobId);
      }
      
      const response = await fetch(`/api/activity-logs?${queryParams.toString()}`);
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      
      if (data.success && Array.isArray(data.logs)) {
        setLogs(data.logs);
        setError(null);
      } else {
        throw new Error('Formato de respuesta inválido');
      }
    } catch (err) {
      console.error('Error al cargar logs:', err);
      setError(`Error al cargar logs: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [visible, jobId, maxLogs]);
  
  // Iniciar/detener auto-refresh
  useEffect(() => {
    if (visible && autoRefresh) {
      fetchLogs(); // Cargar inmediatamente
      
      intervalRef.current = setInterval(fetchLogs, 5000);
      
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
  }, [visible, autoRefresh, jobId, fetchLogs]);
  
  // Scroll al último log cuando hay nuevos
  useEffect(() => {
    if (logsContainerRef.current && logs.length > 0) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);
  
  // Función para limpiar logs
  const clearLogs = () => {
    setLogs([]);
  };
  
  // Función para formatear la fecha
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString() + '.' + String(date.getMilliseconds()).padStart(3, '0');
  };
  
  // Renderizar diferentes tipos de logs
  const renderLog = (log) => {
    switch (log.type) {
      case 'error':
        return (
          <div className="log-entry log-error" key={log.id}>
            <span className="log-time">{formatDate(log.timestamp)}</span>
            <span className="log-message">❌ {log.message}</span>
          </div>
        );
      case 'warning':
        return (
          <div className="log-entry log-warning" key={log.id}>
            <span className="log-time">{formatDate(log.timestamp)}</span>
            <span className="log-message">⚠️ {log.message}</span>
          </div>
        );
      case 'success':
        return (
          <div className="log-entry log-success" key={log.id}>
            <span className="log-time">{formatDate(log.timestamp)}</span>
            <span className="log-message">✅ {log.message}</span>
          </div>
        );
      case 'info':
      default:
        return (
          <div className="log-entry log-info" key={log.id}>
            <span className="log-time">{formatDate(log.timestamp)}</span>
            <span className="log-message">ℹ️ {log.message}</span>
          </div>
        );
    }
  };
  
  if (!visible) {
    return null;
  }
  
  return (
    <div className="activity-monitor">
      <style jsx>{`
        .activity-monitor {
          margin-top: 25px;
          background: #1a202c;
          border-radius: 12px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
          overflow: hidden;
          border: 2px solid #4a5568;
          animation: fadeIn 0.3s ease;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        .monitor-header {
          padding: 15px 20px;
          background: linear-gradient(135deg, #2d3748 0%, #1a365d 100%);
          color: white;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #4a5568;
        }
        
        .monitor-title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .monitor-controls {
          display: flex;
          gap: 10px;
        }
        
        .monitor-button {
          background: none;
          border: none;
          color: white;
          font-size: 14px;
          cursor: pointer;
          padding: 4px 8px;
          opacity: 0.7;
          transition: all 0.2s;
          border-radius: 4px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        
        .monitor-button:hover {
          opacity: 1;
          background: rgba(255, 255, 255, 0.1);
        }
        
        .monitor-button.active {
          background: rgba(66, 153, 225, 0.3);
          opacity: 1;
        }
        
        .logs-container {
          height: 350px;
          overflow-y: auto;
          padding: 15px;
          font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
          font-size: 13px;
          background: #161b22;
        }
        
        .empty-logs {
          color: #a0aec0;
          text-align: center;
          padding: 40px 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 15px;
        }
        
        .empty-logs span {
          font-size: 40px;
          margin-bottom: 10px;
        }
        
        .empty-logs p {
          margin: 5px 0;
          color: #a0aec0;
        }
        
        .log-entry {
          padding: 8px 10px;
          border-radius: 6px;
          margin-bottom: 6px;
          display: flex;
          align-items: flex-start;
          word-break: break-word;
          animation: fadeInDown 0.3s ease-out;
          border-left: 4px solid transparent;
        }
        
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .log-time {
          color: #a0aec0;
          margin-right: 12px;
          font-weight: 500;
          min-width: 100px;
        }
        
        .log-message {
          flex: 1;
        }
        
        .log-info {
          background: rgba(66, 153, 225, 0.05);
          color: #63b3ed;
          border-left-color: #4299e1;
        }
        
        .log-success {
          background: rgba(72, 187, 120, 0.05);
          color: #48bb78;
          border-left-color: #48bb78;
        }
        
        .log-warning {
          background: rgba(237, 137, 54, 0.05);
          color: #ed8936;
          border-left-color: #ed8936;
        }
        
        .log-error {
          background: rgba(245, 101, 101, 0.05);
          color: #f56565;
          border-left-color: #f56565;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        
        .init-db-button {
          margin-top: 10px;
          background: #2B6CB0;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          font-size: 14px;
          align-self: flex-start;
        }
        
        .init-db-button:hover {
          background: #2C5282;
        }
        
        .monitor-footer {
          padding: 10px 20px;
          background: #2d3748;
          border-top: 1px solid #4a5568;
          display: flex;
          justify-content: space-between;
          color: #a0aec0;
          font-size: 12px;
        }
        
        .status-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .status-indicator.active {
          color: #48bb78;
        }
        
        .status-indicator.error {
          color: #f56565;
        }
        
        .pulse {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background-color: currentColor;
          animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.4; }
          100% { opacity: 1; }
        }
        
        .loading-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(26, 32, 44, 0.7);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 5;
        }
        
        .spinner {
          border: 3px solid rgba(255, 255, 255, 0.1);
          border-radius: 50%;
          border-top: 3px solid white;
          width: 24px;
          height: 24px;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        @media (max-width: 640px) {
          .logs-container {
            height: 250px;
          }
          
          .log-time {
            min-width: 70px;
            font-size: 10px;
          }
        }
      `}</style>
      
      <div className="monitor-header">
        <h3 className="monitor-title">
          <span>📊</span> Monitor de Actividad {jobId && <span>(Job: {jobId})</span>}
        </h3>
        <div className="monitor-controls">
          <button 
            className={`monitor-button ${autoRefresh ? 'active' : ''}`} 
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? '⏸️ Pausar' : '▶️ Auto-actualizar'}
          </button>
          <button className="monitor-button" onClick={fetchLogs}>
            🔄 Actualizar
          </button>
          <button className="monitor-button" onClick={clearLogs}>
            🗑️ Limpiar
          </button>
        </div>
      </div>
      
      <div className="logs-container" ref={logsContainerRef}>
        {logs.length === 0 ? (
          <div className="empty-logs">
            <span>📝</span>
            <p>No hay actividad registrada</p>
            <p>Los logs aparecerán aquí cuando haya actividad en el sistema</p>
          </div>
        ) : (
          logs.map(log => renderLog(log))
        )}
        
        {isLoading && (
          <div className="loading-overlay">
            <div className="spinner"></div>
          </div>
        )}
        
        {error && (
          <div className="log-entry log-error">
            <span className="log-time">{new Date().toLocaleTimeString()}</span>
            <span className="log-message">💥 {error}</span>
            
            {error.includes("Could not find the table") && (
              <button 
                className="init-db-button"
                onClick={async () => {
                  try {
                    setError("Inicializando tablas en la base de datos...");
                    const response = await fetch('/api/init-db', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer oskar123'
                      }
                    });
                    
                    if (response.ok) {
                      setError("Tablas inicializadas. Actualizando logs...");
                      setTimeout(() => fetchLogs(), 2000);
                    } else {
                      const data = await response.json();
                      throw new Error(data.error || 'Error al inicializar tablas');
                    }
                  } catch (err) {
                    setError(`Error al inicializar tablas: ${err.message}`);
                  }
                }}
              >
                🛠️ Inicializar tablas en Supabase
              </button>
            )}
          </div>
        )}
      </div>
      
      <div className="monitor-footer">
        <span>{logs.length} eventos</span>
        <div className={`status-indicator ${error ? 'error' : 'active'}`}>
          <div className="pulse"></div>
          {error ? 'Error de conexión' : autoRefresh ? 'Actualizando en tiempo real' : 'Monitoreo en pausa'}
        </div>
      </div>
    </div>
  );
};

export default ActivityMonitor;