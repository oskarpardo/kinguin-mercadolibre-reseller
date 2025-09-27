import { useState, useEffect } from 'react';

// Componente para optimizar la velocidad de procesamiento
export default function SpeedOptimizer() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  
  // Estados para los controles de configuración
  const [concurrency, setConcurrency] = useState(15);
  const [batchInterval, setBatchInterval] = useState(100);
  const [maxRetries, setMaxRetries] = useState(5);
  const [baseDelay, setBaseDelay] = useState(500);
  const [requestTimeout, setRequestTimeout] = useState(30000);
  
  // Cargar configuración actual al iniciar
  useEffect(() => {
    fetchCurrentConfig();
  }, []);
  
  // Función para cargar la configuración actual
  const fetchCurrentConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/optimize-speed');
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      
      // Actualizar estados con la configuración obtenida
      setConcurrency(data.concurrency || 15);
      setBatchInterval(data.batch_interval_ms || 100);
      setMaxRetries(data.max_retries || 5);
      setBaseDelay(data.base_delay_ms || 500);
      setRequestTimeout(data.request_timeout_ms || 30000);
    } catch (err) {
      console.error('Error al cargar configuración:', err);
      setError(`Error al cargar configuración: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };
  
  // Función para guardar la configuración
  const saveConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);
      
      const config = {
        concurrency,
        batch_interval_ms: batchInterval,
        max_retries: maxRetries,
        base_delay_ms: baseDelay,
        request_timeout_ms: requestTimeout
      };
      
      const response = await fetch('/api/optimize-speed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });
      
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      setSuccess(true);
      setTimeout(() => setSuccess(false), 5000);
    } catch (err) {
      console.error('Error al guardar configuración:', err);
      setError(`Error al guardar configuración: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };
  
  // Función para restaurar valores predeterminados
  const resetDefaults = () => {
    setConcurrency(15);
    setBatchInterval(100);
    setMaxRetries(5);
    setBaseDelay(500);
    setRequestTimeout(30000);
  };
  
  // Manejadores para los inputs de rango
  const handleConcurrencyChange = (e) => setConcurrency(Number(e.target.value));
  const handleBatchIntervalChange = (e) => setBatchInterval(Number(e.target.value));
  const handleMaxRetriesChange = (e) => setMaxRetries(Number(e.target.value));
  const handleBaseDelayChange = (e) => setBaseDelay(Number(e.target.value));
  const handleRequestTimeoutChange = (e) => setRequestTimeout(Number(e.target.value));
  
  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Cargando configuración...</p>
      </div>
    );
  }
  
  return (
    <div className="speed-optimizer">
      <div className="optimizer-header">
        <h3>⚡ Optimizador de Velocidad</h3>
        <p className="description">
          Ajusta estos parámetros para optimizar la velocidad de procesamiento y manejo de errores.
        </p>
      </div>
      
      {error && (
        <div className="alert error">
          <span className="alert-icon">❌</span>
          {error}
        </div>
      )}
      
      {success && (
        <div className="alert success">
          <span className="alert-icon">✅</span>
          Configuración guardada correctamente
        </div>
      )}
      
      <div className="control-group">
        <label>
          <span className="label-text">Concurrencia: {concurrency} productos en paralelo</span>
          <input 
            type="range" 
            min="1" 
            max="30" 
            step="1" 
            value={concurrency} 
            onChange={handleConcurrencyChange}
          />
          <div className="range-marks">
            <span>1</span>
            <span>15</span>
            <span>30</span>
          </div>
        </label>
        <p className="help-text">Mayor concurrencia = más rápido, pero puede generar errores 429.</p>
      </div>
      
      <div className="control-group">
        <label>
          <span className="label-text">Intervalo entre solicitudes: {batchInterval} ms</span>
          <input 
            type="range" 
            min="50" 
            max="1000" 
            step="50" 
            value={batchInterval} 
            onChange={handleBatchIntervalChange}
          />
          <div className="range-marks">
            <span>50ms</span>
            <span>500ms</span>
            <span>1s</span>
          </div>
        </label>
        <p className="help-text">Mayor intervalo = más lento, pero más estable.</p>
      </div>
      
      <div className="control-group">
        <label>
          <span className="label-text">Máximo de reintentos: {maxRetries}</span>
          <input 
            type="range" 
            min="1" 
            max="10" 
            step="1" 
            value={maxRetries} 
            onChange={handleMaxRetriesChange}
          />
          <div className="range-marks">
            <span>1</span>
            <span>5</span>
            <span>10</span>
          </div>
        </label>
      </div>
      
      <div className="control-group">
        <label>
          <span className="label-text">Retraso base (ms): {baseDelay}</span>
          <input 
            type="range" 
            min="100" 
            max="2000" 
            step="100" 
            value={baseDelay} 
            onChange={handleBaseDelayChange}
          />
          <div className="range-marks">
            <span>100ms</span>
            <span>1s</span>
            <span>2s</span>
          </div>
        </label>
        <p className="help-text">Tiempo base entre reintentos (aumenta exponencialmente).</p>
      </div>
      
      <div className="control-group">
        <label>
          <span className="label-text">Timeout de solicitudes (ms): {requestTimeout}</span>
          <input 
            type="range" 
            min="5000" 
            max="60000" 
            step="5000" 
            value={requestTimeout} 
            onChange={handleRequestTimeoutChange}
          />
          <div className="range-marks">
            <span>5s</span>
            <span>30s</span>
            <span>60s</span>
          </div>
        </label>
      </div>
      
      <div className="actions">
        <button 
          className="btn-outline" 
          onClick={resetDefaults}
          disabled={saving}
        >
          Restaurar Valores
        </button>
        
        <button 
          className="btn-primary" 
          onClick={saveConfig}
          disabled={saving}
        >
          {saving ? 'Guardando...' : 'Guardar Configuración'}
        </button>
      </div>
      
      <style jsx>{`
        .speed-optimizer {
          background-color: #1E293B;
          color: #E2E8F0;
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        
        .optimizer-header {
          margin-bottom: 20px;
        }
        
        .optimizer-header h3 {
          font-size: 20px;
          font-weight: bold;
          margin: 0 0 8px 0;
        }
        
        .description {
          color: #94A3B8;
          font-size: 14px;
          margin: 0;
        }
        
        .alert {
          margin: 20px 0;
          padding: 12px;
          border-radius: 8px;
          display: flex;
          align-items: center;
        }
        
        .alert-icon {
          margin-right: 8px;
        }
        
        .error {
          background-color: rgba(239, 68, 68, 0.2);
          border-left: 4px solid #EF4444;
          color: #FCA5A5;
        }
        
        .success {
          background-color: rgba(16, 185, 129, 0.2);
          border-left: 4px solid #10B981;
          color: #6EE7B7;
        }
        
        .control-group {
          margin-bottom: 24px;
        }
        
        .label-text {
          display: block;
          font-weight: 500;
          margin-bottom: 8px;
        }
        
        input[type="range"] {
          width: 100%;
          background-color: #2D3748;
          height: 10px;
          border-radius: 5px;
          appearance: none;
        }
        
        input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background-color: #3B82F6;
          cursor: pointer;
        }
        
        .range-marks {
          display: flex;
          justify-content: space-between;
          margin-top: 4px;
          font-size: 12px;
          color: #94A3B8;
        }
        
        .help-text {
          font-size: 12px;
          color: #94A3B8;
          margin-top: 6px;
        }
        
        .actions {
          display: flex;
          justify-content: space-between;
          margin-top: 32px;
        }
        
        .btn-outline, .btn-primary {
          padding: 10px 20px;
          border-radius: 8px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }
        
        .btn-outline {
          background-color: transparent;
          border: 1px solid #6B7280;
          color: #E2E8F0;
        }
        
        .btn-outline:hover:not(:disabled) {
          border-color: #9CA3AF;
          color: white;
        }
        
        .btn-primary {
          background-color: #3B82F6;
          color: white;
        }
        
        .btn-primary:hover:not(:disabled) {
          background-color: #2563EB;
          transform: translateY(-1px);
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        }
        
        .btn-outline:disabled, .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          color: #94A3B8;
        }
        
        .spinner {
          border: 4px solid rgba(59, 130, 246, 0.3);
          border-radius: 50%;
          border-top: 4px solid #3B82F6;
          width: 30px;
          height: 30px;
          animation: spin 1s linear infinite;
          margin-bottom: 10px;
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}