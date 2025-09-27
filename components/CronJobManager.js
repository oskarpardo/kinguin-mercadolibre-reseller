import { useState, useEffect } from 'react';

const CronJobManager = () => {
  const [config, setConfig] = useState({
    update_stock_schedule: '0 */12 * * *',
    update_all_schedule: '0 3 * * *',
    exchange_rate_schedule: '0 */6 * * *',
    active: true,
    description: ''
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [stats, setStats] = useState([]);
  const [history, setHistory] = useState([]);
  const [showHelp, setShowHelp] = useState(false);
  
  // Fetch current configuration
  useEffect(() => {
    fetchConfig();
  }, []);
  
  const fetchConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/cron-config');
      
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setConfig(data.config);
        setStats(data.stats || []);
        setHistory(data.recentExecutions || []);
      } else {
        throw new Error(data.error || 'Error desconocido');
      }
    } catch (err) {
      console.error('Error al obtener configuración de cronjobs:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  // Save configuration
  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage('');
      
      const response = await fetch('/api/cron-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          updateStockSchedule: config.update_stock_schedule,
          updateAllSchedule: config.update_all_schedule,
          exchangeRateSchedule: config.exchange_rate_schedule,
          active: config.active,
          description: config.description || 'Actualización manual',
          userName: 'admin' // Podría venir de un contexto de autenticación
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setSuccessMessage('Configuración guardada correctamente');
        setConfig(data.config);
        
        // Mostrar mensaje de éxito por 3 segundos
        setTimeout(() => {
          setSuccessMessage('');
        }, 3000);
        
        // Refrescar los datos
        await fetchConfig();
      } else {
        throw new Error(data.error || 'Error desconocido');
      }
    } catch (err) {
      console.error('Error al guardar configuración:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  
  // Reset configuration to defaults
  const handleReset = async () => {
    if (!confirm('¿Estás seguro de restablecer la configuración a los valores por defecto?')) {
      return;
    }
    
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage('');
      
      const response = await fetch('/api/cron-config', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userName: 'admin' // Podría venir de un contexto de autenticación
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setSuccessMessage('Configuración restablecida correctamente');
        setConfig(data.config);
        
        // Mostrar mensaje de éxito por 3 segundos
        setTimeout(() => {
          setSuccessMessage('');
        }, 3000);
        
        // Refrescar los datos
        await fetchConfig();
      } else {
        throw new Error(data.error || 'Error desconocido');
      }
    } catch (err) {
      console.error('Error al restablecer configuración:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  
  // Run a cron job manually
  const runCronJob = async (jobType) => {
    try {
      setError(null);
      
      const jobName = 
        jobType === 'update_stock' ? 'actualización de productos con stock' :
        jobType === 'update_all' ? 'actualización de todos los productos' :
        'actualización de tipo de cambio';
        
      if (!confirm(`¿Ejecutar ahora la tarea de ${jobName}?`)) {
        return;
      }
      
      // Mostrar mensaje de ejecución
      setSuccessMessage(`Ejecutando ${jobName}...`);
      
      const response = await fetch('/api/run-cron', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobType
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setSuccessMessage(`Tarea de ${jobName} iniciada correctamente`);
        
        // Mostrar mensaje de éxito por 3 segundos
        setTimeout(() => {
          setSuccessMessage('');
        }, 3000);
        
        // Refrescar historial después de un momento
        setTimeout(() => {
          fetchConfig();
        }, 2000);
      } else {
        throw new Error(data.error || 'Error desconocido');
      }
    } catch (err) {
      console.error('Error al ejecutar cronjob:', err);
      setError(err.message);
      
      // Limpiar mensaje de error después de 5 segundos
      setTimeout(() => {
        setError(null);
      }, 5000);
    }
  };
  
  // Format cron expression to human readable
  const formatCronToHuman = (cronExpression) => {
    // Esta es una simplificación, no cubre todos los casos posibles
    const parts = cronExpression.split(' ');
    
    if (parts.length !== 5) {
      return cronExpression;
    }
    
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    
    // Casos comunes
    if (minute === '0' && hour.includes('*/')) {
      const interval = hour.split('/')[1];
      return `Cada ${interval} horas`;
    }
    
    if (minute === '0' && !isNaN(parseInt(hour))) {
      return `Todos los días a las ${hour}:00`;
    }
    
    if (minute.includes('*/')) {
      const interval = minute.split('/')[1];
      return `Cada ${interval} minutos`;
    }
    
    return cronExpression; // Default: devolver la expresión original
  };
  
  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    
    const date = new Date(dateString);
    return date.toLocaleString();
  };
  
  // Format execution time
  const formatExecutionTime = (seconds) => {
    if (!seconds) return '-';
    
    if (seconds < 60) {
      return `${seconds.toFixed(1)} segundos`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    return `${minutes} min ${remainingSeconds.toFixed(0)} seg`;
  };
  
  // Get status indicator color
  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return '#48bb78';
      case 'failed':
        return '#e53e3e';
      case 'running':
        return '#3182ce';
      default:
        return '#718096';
    }
  };
  
  if (loading) {
    return (
      <div className="cron-manager-loading">
        <div className="loading-spinner"></div>
        <p>Cargando configuración...</p>
        <style jsx>{`
          .cron-manager-loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 300px;
          }
          
          .loading-spinner {
            border: 4px solid rgba(0, 0, 0, 0.1);
            border-left-color: #3182ce;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin-bottom: 20px;
          }
          
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }
  
  return (
    <div className="cron-job-manager">
      <div className="manager-header">
        <h2>Gestor de Tareas Programadas</h2>
        <div className="header-actions">
          <button 
            className="help-button"
            onClick={() => setShowHelp(!showHelp)}
          >
            {showHelp ? 'Ocultar ayuda' : 'Mostrar ayuda'}
          </button>
        </div>
      </div>
      
      {showHelp && (
        <div className="help-section">
          <h3>Formato de expresiones cron</h3>
          <p>
            Las expresiones cron tienen 5 campos en este orden: <code>minuto hora día-del-mes mes día-de-la-semana</code>
          </p>
          <table className="help-table">
            <thead>
              <tr>
                <th>Expresión</th>
                <th>Significado</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>0 */6 * * *</code></td>
                <td>Cada 6 horas (0:00, 6:00, 12:00, 18:00)</td>
              </tr>
              <tr>
                <td><code>0 3 * * *</code></td>
                <td>Todos los días a las 3:00 AM</td>
              </tr>
              <tr>
                <td><code>0 12 * * 1-5</code></td>
                <td>De lunes a viernes a las 12:00 PM</td>
              </tr>
              <tr>
                <td><code>*/15 * * * *</code></td>
                <td>Cada 15 minutos</td>
              </tr>
              <tr>
                <td><code>0 0 1 * *</code></td>
                <td>El primer día de cada mes a las 0:00</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      
      {error && (
        <div className="error-message">
          <p>{error}</p>
        </div>
      )}
      
      {successMessage && (
        <div className="success-message">
          <p>{successMessage}</p>
        </div>
      )}
      
      <div className="config-section">
        <h3>Configuración Actual</h3>
        
        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={config.active}
              onChange={(e) => setConfig({...config, active: e.target.checked})}
            />
            <span>Tareas programadas activas</span>
          </label>
          <p className="input-help">
            {config.active ? 
              '✅ Las tareas programadas se ejecutarán automáticamente' : 
              '❌ Las tareas programadas están desactivadas'}
          </p>
        </div>
        
        <div className="form-group">
          <label>Actualización de productos con stock:</label>
          <input
            type="text"
            value={config.update_stock_schedule}
            onChange={(e) => setConfig({...config, update_stock_schedule: e.target.value})}
            placeholder="0 */12 * * *"
          />
          <p className="input-help">
            {formatCronToHuman(config.update_stock_schedule)}
          </p>
        </div>
        
        <div className="form-group">
          <label>Actualización de todos los productos:</label>
          <input
            type="text"
            value={config.update_all_schedule}
            onChange={(e) => setConfig({...config, update_all_schedule: e.target.value})}
            placeholder="0 3 * * *"
          />
          <p className="input-help">
            {formatCronToHuman(config.update_all_schedule)}
          </p>
        </div>
        
        <div className="form-group">
          <label>Actualización de tipo de cambio:</label>
          <input
            type="text"
            value={config.exchange_rate_schedule}
            onChange={(e) => setConfig({...config, exchange_rate_schedule: e.target.value})}
            placeholder="0 */6 * * *"
          />
          <p className="input-help">
            {formatCronToHuman(config.exchange_rate_schedule)}
          </p>
        </div>
        
        <div className="form-group">
          <label>Descripción:</label>
          <input
            type="text"
            value={config.description || ''}
            onChange={(e) => setConfig({...config, description: e.target.value})}
            placeholder="Descripción opcional"
          />
        </div>
        
        <div className="form-actions">
          <button 
            className="button-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Guardando...' : 'Guardar configuración'}
          </button>
          
          <button 
            className="button-secondary"
            onClick={handleReset}
            disabled={saving}
          >
            Restablecer valores por defecto
          </button>
        </div>
      </div>
      
      <div className="manual-execution-section">
        <h3>Ejecución Manual</h3>
        <p>Ejecuta manualmente las tareas programadas:</p>
        
        <div className="manual-buttons">
          <button 
            className="execution-button"
            onClick={() => runCronJob('update_stock')}
            title="Ejecutar ahora la actualización de productos con stock"
          >
            <span className="button-icon">🔄</span>
            <span>Actualizar productos con stock</span>
          </button>
          
          <button 
            className="execution-button"
            onClick={() => runCronJob('update_all')}
            title="Ejecutar ahora la actualización de todos los productos"
          >
            <span className="button-icon">📦</span>
            <span>Actualizar todos los productos</span>
          </button>
          
          <button 
            className="execution-button"
            onClick={() => runCronJob('exchange_rate')}
            title="Ejecutar ahora la actualización del tipo de cambio"
          >
            <span className="button-icon">💱</span>
            <span>Actualizar tipo de cambio</span>
          </button>
        </div>
      </div>
      
      {stats && stats.length > 0 && (
        <div className="stats-section">
          <h3>Estadísticas</h3>
          <div className="stats-grid">
            {stats.map((statItem) => (
              <div className="stat-card" key={statItem.job_type}>
                <div className="stat-header">
                  <h4>
                    {statItem.job_type === 'update_stock' && '🔄 Actualización de stock'}
                    {statItem.job_type === 'update_all' && '📦 Actualización completa'}
                    {statItem.job_type === 'exchange_rate' && '💱 Tipo de cambio'}
                  </h4>
                </div>
                <div className="stat-body">
                  <div className="stat-row">
                    <span>Total ejecuciones:</span>
                    <span>{statItem.total_executions || 0}</span>
                  </div>
                  <div className="stat-row">
                    <span>Exitosas:</span>
                    <span>{statItem.successful_executions || 0}</span>
                  </div>
                  <div className="stat-row">
                    <span>Fallidas:</span>
                    <span>{statItem.failed_executions || 0}</span>
                  </div>
                  <div className="stat-row">
                    <span>Tiempo promedio:</span>
                    <span>{formatExecutionTime(statItem.avg_execution_time)}</span>
                  </div>
                  <div className="stat-row">
                    <span>Productos afectados:</span>
                    <span>{statItem.total_items_affected || 0}</span>
                  </div>
                  <div className="stat-row">
                    <span>Última ejecución:</span>
                    <span>{formatDate(statItem.last_successful_execution)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {history && history.length > 0 && (
        <div className="history-section">
          <h3>Historial de Ejecuciones</h3>
          <div className="history-table-container">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tarea</th>
                  <th>Estado</th>
                  <th>Duración</th>
                  <th>Productos</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDate(item.start_time)}</td>
                    <td>
                      {item.job_type === 'update_stock' && '🔄 Actualizar stock'}
                      {item.job_type === 'update_all' && '📦 Actualizar todo'}
                      {item.job_type === 'exchange_rate' && '💱 Tipo de cambio'}
                    </td>
                    <td>
                      <span className="status-badge" style={{ backgroundColor: getStatusColor(item.status) }}>
                        {item.status === 'completed' && 'Completado'}
                        {item.status === 'failed' && 'Fallido'}
                        {item.status === 'running' && 'En ejecución'}
                      </span>
                    </td>
                    <td>{formatExecutionTime(item.execution_time_seconds)}</td>
                    <td>{item.affected_items || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="refresh-history">
            <button className="refresh-button" onClick={fetchConfig}>
              🔄 Actualizar historial
            </button>
          </div>
        </div>
      )}
      
      <style jsx>{`
        .cron-job-manager {
          background: white;
          border-radius: 12px;
          padding: 25px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        
        .manager-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 1px solid #e2e8f0;
        }
        
        .manager-header h2 {
          font-size: 24px;
          margin: 0;
          color: #2d3748;
        }
        
        .help-button {
          background: #edf2f7;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          color: #4a5568;
          transition: all 0.2s;
        }
        
        .help-button:hover {
          background: #e2e8f0;
        }
        
        .help-section {
          background: #f7fafc;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 25px;
        }
        
        .help-section h3 {
          font-size: 18px;
          margin-top: 0;
          margin-bottom: 15px;
          color: #2d3748;
        }
        
        .help-section p {
          margin: 0 0 15px 0;
          font-size: 14px;
          color: #4a5568;
        }
        
        .help-section code {
          background: #edf2f7;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: monospace;
          color: #4a5568;
        }
        
        .help-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 15px;
        }
        
        .help-table th, .help-table td {
          padding: 10px 15px;
          text-align: left;
          border: 1px solid #e2e8f0;
          font-size: 14px;
        }
        
        .help-table th {
          background: #edf2f7;
          color: #4a5568;
          font-weight: 600;
        }
        
        .error-message {
          background: #fed7d7;
          color: #c53030;
          padding: 12px 20px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        
        .error-message p {
          margin: 0;
        }
        
        .success-message {
          background: #c6f6d5;
          color: #2f855a;
          padding: 12px 20px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        
        .success-message p {
          margin: 0;
        }
        
        .config-section {
          margin-bottom: 30px;
        }
        
        .config-section h3 {
          font-size: 18px;
          margin-top: 0;
          margin-bottom: 20px;
          color: #2d3748;
        }
        
        .form-group {
          margin-bottom: 20px;
        }
        
        .form-group label {
          display: block;
          font-weight: 500;
          color: #4a5568;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
        }
        
        .form-group label input[type="checkbox"] {
          margin-right: 10px;
        }
        
        .form-group input[type="text"] {
          width: 100%;
          padding: 10px 15px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          font-size: 14px;
          font-family: monospace;
        }
        
        .input-help {
          margin: 5px 0 0;
          font-size: 12px;
          color: #718096;
          font-style: italic;
        }
        
        .form-actions {
          display: flex;
          gap: 15px;
          margin-top: 25px;
        }
        
        .button-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .button-primary:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(102, 126, 234, 0.3);
        }
        
        .button-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .button-secondary {
          background: #edf2f7;
          color: #4a5568;
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .button-secondary:hover:not(:disabled) {
          background: #e2e8f0;
        }
        
        .button-secondary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .manual-execution-section {
          margin-bottom: 30px;
          background: #f7fafc;
          padding: 20px;
          border-radius: 8px;
        }
        
        .manual-execution-section h3 {
          font-size: 18px;
          margin-top: 0;
          margin-bottom: 10px;
          color: #2d3748;
        }
        
        .manual-execution-section p {
          margin: 0 0 20px 0;
          font-size: 14px;
          color: #4a5568;
        }
        
        .manual-buttons {
          display: flex;
          gap: 15px;
          flex-wrap: wrap;
        }
        
        .execution-button {
          flex: 1;
          min-width: 200px;
          padding: 15px;
          border: none;
          border-radius: 8px;
          background: white;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        
        .execution-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
        }
        
        .button-icon {
          font-size: 24px;
          margin-bottom: 5px;
        }
        
        .stats-section {
          margin-bottom: 30px;
        }
        
        .stats-section h3 {
          font-size: 18px;
          margin-top: 0;
          margin-bottom: 20px;
          color: #2d3748;
        }
        
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 20px;
        }
        
        .stat-card {
          background: #f7fafc;
          border-radius: 8px;
          overflow: hidden;
        }
        
        .stat-header {
          background: #edf2f7;
          padding: 15px;
          border-bottom: 1px solid #e2e8f0;
        }
        
        .stat-header h4 {
          margin: 0;
          font-size: 16px;
          color: #2d3748;
        }
        
        .stat-body {
          padding: 15px;
        }
        
        .stat-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid #edf2f7;
        }
        
        .stat-row:last-child {
          border-bottom: none;
        }
        
        .stat-row span:first-child {
          color: #718096;
          font-size: 14px;
        }
        
        .stat-row span:last-child {
          font-weight: 600;
          color: #2d3748;
          font-size: 14px;
        }
        
        .history-section {
          margin-bottom: 10px;
        }
        
        .history-section h3 {
          font-size: 18px;
          margin-top: 0;
          margin-bottom: 20px;
          color: #2d3748;
        }
        
        .history-table-container {
          overflow-x: auto;
        }
        
        .history-table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .history-table th, .history-table td {
          padding: 12px 15px;
          text-align: left;
          border-bottom: 1px solid #e2e8f0;
        }
        
        .history-table th {
          background: #f7fafc;
          color: #4a5568;
          font-weight: 500;
          font-size: 14px;
        }
        
        .history-table td {
          font-size: 14px;
          color: #4a5568;
        }
        
        .status-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          color: white;
          font-weight: 600;
        }
        
        .refresh-history {
          margin-top: 20px;
          display: flex;
          justify-content: flex-end;
        }
        
        .refresh-button {
          background: #edf2f7;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          color: #4a5568;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .refresh-button:hover {
          background: #e2e8f0;
        }
        
        @media (max-width: 768px) {
          .form-actions {
            flex-direction: column;
          }
          
          .manual-buttons {
            flex-direction: column;
          }
          
          .execution-button {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
};

export default CronJobManager;