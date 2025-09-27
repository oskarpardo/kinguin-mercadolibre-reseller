import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import externalCrons from '../lib/external-crons';

export default function ExternalCronsPage() {
  const [activeTab, setActiveTab] = useState('all');
  const [cronLogs, setCronLogs] = useState([]);
  const [cronStats, setCronStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  
  // Obtener todos los cronjobs disponibles
  const allCrons = Object.entries(externalCrons).flatMap(
    ([category, crons]) => crons.map(cron => ({ ...cron, category }))
  );
  
  // Obtener logs y estadísticas al cargar la página
  useEffect(() => {
    // En un entorno real, deberías obtener esto de la API
    // Aquí simulamos algunos datos para la demostración
    const mockLogs = [];
    const mockStats = [];
    
    allCrons.forEach(cron => {
      // Simular estadísticas
      mockStats.push({
        cron_id: cron.id,
        cron_name: cron.name,
        category: cron.category,
        total_executions: Math.floor(Math.random() * 100),
        successful_executions: Math.floor(Math.random() * 80),
        failed_executions: Math.floor(Math.random() * 20),
        avg_execution_time_ms: Math.floor(Math.random() * 2000 + 500),
        last_execution: new Date(Date.now() - Math.floor(Math.random() * 86400000)).toISOString(),
        last_successful_execution: new Date(Date.now() - Math.floor(Math.random() * 86400000)).toISOString()
      });
      
      // Simular algunos logs recientes
      for (let i = 0; i < Math.floor(Math.random() * 3 + 1); i++) {
        mockLogs.push({
          id: Math.floor(Math.random() * 10000),
          cron_id: cron.id,
          cron_name: cron.name,
          status: Math.random() > 0.2 ? 'completed' : 'failed',
          category: cron.category,
          source: Math.random() > 0.5 ? 'scheduler' : 'manual',
          created_at: new Date(Date.now() - Math.floor(Math.random() * 86400000)).toISOString(),
          execution_time_ms: Math.floor(Math.random() * 2000 + 500)
        });
      }
    });
    
    // Ordenar logs por fecha (más recientes primero)
    mockLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    setCronLogs(mockLogs);
    setCronStats(mockStats);
    setLoading(false);
    
    // Obtener la URL base y la API Key de las variables de entorno
    // (en un entorno real deberías obtener esto de forma segura)
    setApiKey(process.env.NEXT_PUBLIC_EXTERNAL_CRON_API_KEY || 'kinguin-ml-cron-key');
    setBaseUrl(window.location.origin);
  }, [allCrons]);
  
  // Filtrar cronjobs según la pestaña activa
  const filteredCrons = activeTab === 'all' 
    ? allCrons 
    : allCrons.filter(cron => cron.category === activeTab);
  
  // Formatear fecha
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString();
  };
  
  // Formatear tiempo de ejecución
  const formatExecutionTime = (ms) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  };
  
  // Obtener estadísticas para un cronjob específico
  const getStatsForCron = (cronId) => {
    return cronStats.find(stat => stat.cron_id === cronId) || {
      total_executions: 0,
      successful_executions: 0,
      failed_executions: 0,
      avg_execution_time_ms: 0,
      last_execution: null
    };
  };
  
  // Copiar URL al portapapeles
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert('URL copiada al portapapeles');
  };
  
  // Construir URL para el cronjob
  const buildCronUrl = (cron) => {
    return `${baseUrl}/api/cron-runner?id=${cron.id}&key=${apiKey}`;
  };
  
  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Cargando...</p>
      </div>
    );
  }
  
  return (
    <div className="container">
      <Head>
        <title>Cronjobs Externos - Kinguin MercadoLibre Reseller</title>
        <meta name="description" content="Gestión de cronjobs externos para sincronización automática" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      
      <header className="header">
        <div>
          <h1>🔄 Cronjobs Externos</h1>
          <p className="subtitle">Gestiona y configura cronjobs externos para automatizar tareas</p>
        </div>
        <div className="nav-buttons">
          <Link href="/" className="nav-button">🏠 Inicio</Link>
          <Link href="/product-manager" className="nav-button">📊 Gestor de Productos</Link>
        </div>
      </header>
      
      <main className="main">
        <section className="info-card">
          <h2>Configuración de cronjobs externos</h2>
          <p>Para configurar un servicio externo de cronjobs (como cron-job.org, Zapier, Github Actions, etc.), usa las URLs generadas para cada tarea.</p>
          
          <div className="api-key-section">
            <div className="api-key-display">
              <span>API Key: </span>
              <input 
                type="text" 
                value={showApiKey ? apiKey : '••••••••••••••••'} 
                readOnly 
              />
              <button onClick={() => setShowApiKey(!showApiKey)}>
                {showApiKey ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
            <p className="warning-text">
              ⚠️ Esta clave es necesaria para que los servicios externos puedan acceder a los endpoints. Mantenla segura.
            </p>
          </div>
        </section>
        
        <div className="tabs">
          <button 
            className={`tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            Todos
          </button>
          {Object.keys(externalCrons).map(category => (
            <button 
              key={category}
              className={`tab ${activeTab === category ? 'active' : ''}`}
              onClick={() => setActiveTab(category)}
            >
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
          ))}
        </div>
        
        <section className="crons-list">
          {filteredCrons.map((cron) => {
            const stats = getStatsForCron(cron.id);
            const cronUrl = buildCronUrl(cron);
            
            return (
              <div className="cron-card" key={cron.id}>
                <div className="cron-header">
                  <h3>{cron.name}</h3>
                  <span className="category-badge">{cron.category}</span>
                </div>
                
                <p className="cron-description">{cron.description}</p>
                
                <div className="cron-url">
                  <div className="url-label">URL para configuración externa:</div>
                  <div className="url-container">
                    <input 
                      type="text" 
                      value={cronUrl} 
                      readOnly 
                    />
                    <button onClick={() => copyToClipboard(cronUrl)}>Copiar</button>
                  </div>
                </div>
                
                <div className="cron-details">
                  <div className="detail-item">
                    <span className="detail-label">Método:</span>
                    <span className="detail-value">{cron.method || 'GET'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Frecuencia máx. recomendada:</span>
                    <span className="detail-value">{cron.maxFrequency}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Total ejecuciones:</span>
                    <span className="detail-value">{stats.total_executions}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Última ejecución:</span>
                    <span className="detail-value">{formatDate(stats.last_execution)}</span>
                  </div>
                </div>
                
                <div className="cron-stats">
                  <div className="stat-item success">
                    <span className="stat-value">{stats.successful_executions}</span>
                    <span className="stat-label">Exitosas</span>
                  </div>
                  <div className="stat-item failed">
                    <span className="stat-value">{stats.failed_executions}</span>
                    <span className="stat-label">Fallidas</span>
                  </div>
                  <div className="stat-item time">
                    <span className="stat-value">{formatExecutionTime(stats.avg_execution_time_ms)}</span>
                    <span className="stat-label">Tiempo promedio</span>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
        
        <section className="recent-logs">
          <h2>Ejecuciones recientes</h2>
          
          <div className="table-container">
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cronjob</th>
                  <th>Estado</th>
                  <th>Origen</th>
                  <th>Tiempo</th>
                </tr>
              </thead>
              <tbody>
                {cronLogs.map(log => (
                  <tr key={log.id} className={`log-row ${log.status}`}>
                    <td>{formatDate(log.created_at)}</td>
                    <td>{log.cron_name}</td>
                    <td>
                      <span className={`status-badge ${log.status}`}>
                        {log.status === 'completed' ? '✓ Completado' : '✗ Fallido'}
                      </span>
                    </td>
                    <td>{log.source}</td>
                    <td>{formatExecutionTime(log.execution_time_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      
      <style jsx>{`
        .container {
          min-height: 100vh;
          background: #f5f7fa;
        }
        
        .loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
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
        
        .header {
          background: white;
          padding: 20px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 20px;
        }
        
        .header h1 {
          font-size: 24px;
          margin: 0 0 5px 0;
          color: #2d3748;
        }
        
        .subtitle {
          margin: 0;
          color: #718096;
        }
        
        .nav-buttons {
          display: flex;
          gap: 10px;
        }
        
        .nav-button {
          background: #edf2f7;
          color: #4a5568;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 14px;
          text-decoration: none;
          transition: all 0.2s;
        }
        
        .nav-button:hover {
          background: #e2e8f0;
        }
        
        .main {
          max-width: 1200px;
          margin: 30px auto;
          padding: 0 20px;
        }
        
        .info-card {
          background: white;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          margin-bottom: 30px;
        }
        
        .info-card h2 {
          font-size: 18px;
          margin: 0 0 15px 0;
          color: #2d3748;
        }
        
        .info-card p {
          margin: 0 0 20px 0;
          color: #4a5568;
          line-height: 1.5;
        }
        
        .api-key-section {
          background: #f8fafc;
          padding: 15px;
          border-radius: 8px;
          margin-top: 15px;
        }
        
        .api-key-display {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .api-key-display input {
          flex: 1;
          padding: 10px;
          border: 1px solid #e2e8f0;
          border-radius: 4px;
          background: white;
          color: #2d3748;
          font-family: monospace;
        }
        
        .api-key-display button {
          background: #edf2f7;
          border: none;
          padding: 10px 15px;
          border-radius: 4px;
          cursor: pointer;
          color: #4a5568;
          font-size: 14px;
          transition: all 0.2s;
        }
        
        .api-key-display button:hover {
          background: #e2e8f0;
        }
        
        .warning-text {
          margin: 10px 0 0 0;
          color: #c53030;
          font-size: 14px;
        }
        
        .tabs {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        
        .tab {
          background: white;
          border: none;
          padding: 10px 20px;
          border-radius: 8px;
          cursor: pointer;
          color: #4a5568;
          font-size: 14px;
          transition: all 0.2s;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        
        .tab:hover {
          background: #edf2f7;
        }
        
        .tab.active {
          background: #4299e1;
          color: white;
        }
        
        .crons-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .cron-card {
          background: white;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        
        .cron-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
        }
        
        .cron-header h3 {
          font-size: 16px;
          margin: 0;
          color: #2d3748;
        }
        
        .category-badge {
          background: #e2e8f0;
          padding: 5px 10px;
          border-radius: 20px;
          font-size: 12px;
          color: #4a5568;
        }
        
        .cron-description {
          margin: 0 0 15px 0;
          color: #718096;
          font-size: 14px;
        }
        
        .cron-url {
          margin-bottom: 15px;
        }
        
        .url-label {
          font-size: 12px;
          color: #718096;
          margin-bottom: 5px;
        }
        
        .url-container {
          display: flex;
          gap: 10px;
        }
        
        .url-container input {
          flex: 1;
          padding: 10px;
          border: 1px solid #e2e8f0;
          border-radius: 4px;
          background: #f8fafc;
          color: #2d3748;
          font-family: monospace;
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .url-container button {
          background: #edf2f7;
          border: none;
          padding: 8px 12px;
          border-radius: 4px;
          cursor: pointer;
          color: #4a5568;
          font-size: 12px;
        }
        
        .url-container button:hover {
          background: #e2e8f0;
        }
        
        .cron-details {
          margin-bottom: 15px;
          border-top: 1px solid #e2e8f0;
          padding-top: 15px;
        }
        
        .detail-item {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
          font-size: 14px;
        }
        
        .detail-label {
          color: #718096;
        }
        
        .detail-value {
          font-weight: 500;
          color: #2d3748;
        }
        
        .cron-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        
        .stat-item {
          padding: 10px;
          border-radius: 8px;
          text-align: center;
          display: flex;
          flex-direction: column;
        }
        
        .stat-value {
          font-size: 20px;
          font-weight: 600;
          margin-bottom: 5px;
        }
        
        .stat-label {
          font-size: 12px;
        }
        
        .stat-item.success {
          background: #c6f6d5;
        }
        
        .stat-item.success .stat-value {
          color: #2f855a;
        }
        
        .stat-item.failed {
          background: #fed7d7;
        }
        
        .stat-item.failed .stat-value {
          color: #c53030;
        }
        
        .stat-item.time {
          background: #e9d8fd;
        }
        
        .stat-item.time .stat-value {
          color: #6b46c1;
        }
        
        .recent-logs {
          background: white;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        
        .recent-logs h2 {
          font-size: 18px;
          margin: 0 0 20px 0;
          color: #2d3748;
        }
        
        .table-container {
          overflow-x: auto;
        }
        
        .logs-table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .logs-table th,
        .logs-table td {
          padding: 12px 15px;
          text-align: left;
          border-bottom: 1px solid #e2e8f0;
        }
        
        .logs-table th {
          background: #f7fafc;
          color: #4a5568;
          font-size: 14px;
          font-weight: 500;
        }
        
        .logs-table td {
          font-size: 14px;
          color: #4a5568;
        }
        
        .status-badge {
          display: inline-block;
          padding: 5px 10px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
        }
        
        .status-badge.completed {
          background: #c6f6d5;
          color: #2f855a;
        }
        
        .status-badge.failed {
          background: #fed7d7;
          color: #c53030;
        }
        
        @media (max-width: 768px) {
          .header {
            flex-direction: column;
            align-items: flex-start;
          }
          
          .nav-buttons {
            width: 100%;
            flex-wrap: wrap;
          }
          
          .crons-list {
            grid-template-columns: 1fr;
          }
          
          .api-key-display {
            flex-direction: column;
            align-items: flex-start;
          }
          
          .api-key-display input,
          .api-key-display button {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}