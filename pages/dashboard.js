import Link from 'next/link';
import Head from 'next/head';
import { useState, useEffect } from 'react';
import SpeedOptimizer from '../components/SpeedOptimizer';
import LogViewer from '../components/LogViewer';

export default function Dashboard() {
  const [activeJobId, setActiveJobId] = useState('');
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [fxStatus, setFxStatus] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Función para obtener el ID del job activo desde la URL o localStorage
  useEffect(() => {
    // Comprobar si hay un job_id en la URL
    const params = new URLSearchParams(window.location.search);
    const jobIdFromUrl = params.get('job_id');
    
    if (jobIdFromUrl) {
      setActiveJobId(jobIdFromUrl);
      setShowLogViewer(true);
    } else {
      // Si no está en la URL, intentar obtenerlo del localStorage
      const savedJobId = localStorage.getItem('lastActiveJobId');
      if (savedJobId) {
        setActiveJobId(savedJobId);
      }
    }
  }, []);

  // Guardar el ID de job activo en localStorage cuando cambia
  useEffect(() => {
    if (activeJobId) {
      localStorage.setItem('lastActiveJobId', activeJobId);
    }
  }, [activeJobId]);

  // Manejar cambio en el ID del job
  const handleJobIdChange = (e) => {
    setActiveJobId(e.target.value);
  };

  // Mostrar/ocultar el visor de logs
  const toggleLogViewer = () => {
    setShowLogViewer(!showLogViewer);
  };
  
  // Actualizar solo el tipo de cambio
  const updateExchangeRate = async () => {
    if (isUpdating) return;
    
    try {
      setIsUpdating(true);
      setFxStatus({
        type: 'info',
        message: 'Actualizando tipo de cambio...'
      });
      
      const response = await fetch('/api/exchange-rate?source=dashboard_manual', {
        method: 'GET'
      });
      
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      
      if (data.fallback) {
        setFxStatus({
          type: 'warning',
          message: `Usando tipo de fallback: ${data.rate} (${data.fallbackSource || 'desconocido'})`
        });
      } else {
        setFxStatus({
          type: 'success',
          message: `Tipo de cambio actualizado: ${data.rate} (${data.sources.join(', ')})`
        });
      }
    } catch (error) {
      console.error('Error al actualizar tipo de cambio:', error);
      setFxStatus({
        type: 'error',
        message: `Error: ${error.message}`
      });
    } finally {
      setIsUpdating(false);
    }
  };
  
  // Actualizar todos los precios según el tipo de cambio actual
  const updateAllPrices = async () => {
    if (isUpdating) return;
    
    try {
      setIsUpdating(true);
      setFxStatus({
        type: 'info',
        message: 'Actualizando todos los precios...'
      });
      
      const response = await fetch('/api/update-all-prices', {
        method: 'POST'
      });
      
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      
      setFxStatus({
        type: 'success',
        message: `${data.updatedProducts} productos actualizados con FX: ${data.currentFX}`
      });
    } catch (error) {
      console.error('Error al actualizar precios:', error);
      setFxStatus({
        type: 'error',
        message: `Error: ${error.message}`
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="dashboard-container">
      <Head>
        <title>Dashboard - Kinguin MercadoLibre Reseller</title>
        <meta name="description" content="Panel de control de la integración Kinguin-MercadoLibre" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      
      <div className="success-message">
        <div className="icon-container">
          <div className="success-icon">✓</div>
        </div>
        <h1>Autenticación con MercadoLibre exitosa</h1>
        <p>La conexión se ha establecido correctamente. Ya puedes gestionar tus productos y configuraciones.</p>
      </div>
      
      <div className="actions-container">
        <div className="action-card">
          <div className="action-icon">🏠</div>
          <div className="action-content">
            <h3>Panel Principal</h3>
            <p>Vuelve al panel principal para gestionar tus operaciones</p>
            <Link href="/" className="action-button primary">
              Ir al inicio
            </Link>
          </div>
        </div>
        
        <div className="action-card">
          <div className="action-icon">📊</div>
          <div className="action-content">
            <h3>Gestor de Productos</h3>
            <p>Administra tu catálogo de productos, precios y disponibilidad</p>
            <Link href="/product-manager" className="action-button secondary">
              Gestionar Productos
            </Link>
          </div>
        </div>
        
        <div className="action-card">
          <div className="action-icon">⚡</div>
          <div className="action-content">
            <h3>Optimizar Velocidad</h3>
            <p>Configuración para mejorar la velocidad de procesamiento</p>
            <div className="speed-optimizer-container">
              <SpeedOptimizer />
            </div>
          </div>
        </div>

        {/* Nueva tarjeta para el monitor de actividad */}
        <div className="action-card">
          <div className="action-icon">📋</div>
          <div className="action-content">
            <h3>Monitor de Actividad</h3>
            <p>Visualiza los logs de actividad y monitorea los procesos</p>
            
            <div className="job-id-input">
              <input
                type="text"
                value={activeJobId}
                onChange={handleJobIdChange}
                placeholder="Ingresa ID del Job"
                className="job-id-field"
              />
              <button 
                onClick={toggleLogViewer} 
                className="action-button tertiary"
              >
                {showLogViewer ? 'Ocultar logs' : 'Ver logs'}
              </button>
            </div>
          </div>
        </div>

        {/* Nueva tarjeta para la actualización de tipos de cambio */}
        <div className="action-card">
          <div className="action-icon">💱</div>
          <div className="action-content">
            <h3>Tipo de Cambio</h3>
            <p>Actualiza el tipo de cambio EUR/CLP y los precios de los productos</p>
            
            <div className="fx-actions">
              <button 
                onClick={updateExchangeRate}
                className="action-button fx-button"
              >
                Actualizar FX
              </button>
              <button 
                onClick={updateAllPrices}
                className="action-button fx-button update-prices"
              >
                Actualizar Precios
              </button>
            </div>
            {fxStatus && (
              <div className={`fx-status ${fxStatus.type}`}>
                {fxStatus.message}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Monitor de logs con diseño mejorado */}
      {showLogViewer && activeJobId && (
        <div className="log-viewer-container">
          <LogViewer jobId={activeJobId} />
        </div>
      )}
      
      <style jsx>{`
        .dashboard-container {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 50px 20px;
          background: linear-gradient(135deg, #111827 0%, #1f2937 100%);
          color: white;
        }
        
        .log-viewer-container {
          width: 100%;
          max-width: 1200px;
          margin-top: 40px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 16px;
          padding: 20px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .job-id-input {
          display: flex;
          gap: 10px;
          width: 100%;
          margin-top: 10px;
        }
        
        .job-id-field {
          flex: 1;
          padding: 10px 15px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(0, 0, 0, 0.2);
          color: #fff;
          font-size: 14px;
        }
        
        .job-id-field:focus {
          outline: none;
          border-color: #8B5CF6;
        }
        
        .success-message {
          text-align: center;
          max-width: 600px;
          margin-bottom: 60px;
        }
        
        .icon-container {
          margin-bottom: 25px;
        }
        
        .success-icon {
          background: #10B981;
          color: white;
          width: 80px;
          height: 80px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 40px;
          margin: 0 auto;
          box-shadow: 0 0 0 10px rgba(16, 185, 129, 0.2);
          animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
          }
          70% {
            box-shadow: 0 0 0 15px rgba(16, 185, 129, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
          }
        }
        
        .success-message h1 {
          font-size: 32px;
          margin: 0 0 15px 0;
          background: linear-gradient(135deg, #10B981 0%, #3B82F6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        
        .success-message p {
          color: #9CA3AF;
          font-size: 16px;
          line-height: 1.6;
        }
        
        .actions-container {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 25px;
          width: 100%;
          max-width: 1200px;
        }
        
        .action-card {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          padding: 30px;
          backdrop-filter: blur(5px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          transition: all 0.3s ease;
          display: flex;
          flex-direction: column;
        }
        
        .action-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 15px 30px rgba(0, 0, 0, 0.2);
          border-color: rgba(255, 255, 255, 0.2);
        }
        
        .action-icon {
          font-size: 36px;
          margin-bottom: 20px;
          background: rgba(255, 255, 255, 0.1);
          width: 70px;
          height: 70px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .action-content h3 {
          font-size: 20px;
          margin: 0 0 10px 0;
          color: #F9FAFB;
        }
        
        .action-content p {
          color: #9CA3AF;
          font-size: 14px;
          line-height: 1.6;
          margin: 0 0 20px 0;
          flex-grow: 1;
        }
        
        .action-button {
          display: inline-block;
          padding: 12px 24px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 500;
          font-size: 14px;
          transition: all 0.3s ease;
          text-align: center;
        }
        
        .primary {
          background: #3B82F6;
          color: white;
        }
        
        .primary:hover {
          background: #2563EB;
          box-shadow: 0 5px 15px rgba(59, 130, 246, 0.3);
        }
        
        .secondary {
          background: #10B981;
          color: white;
        }
        
        .secondary:hover {
          background: #059669;
          box-shadow: 0 5px 15px rgba(16, 185, 129, 0.3);
        }
        
        .tertiary {
          background: #8B5CF6;
          color: white;
        }
        
        .tertiary:hover {
          background: #7C3AED;
          box-shadow: 0 5px 15px rgba(139, 92, 246, 0.3);
        }

        .speed-optimizer-container {
          margin-top: 20px;
          width: 100%;
        }
        
        @media (max-width: 768px) {
          .actions-container {
            grid-template-columns: 1fr;
          }
          
          .success-message h1 {
            font-size: 26px;
          }
          
          .success-icon {
            width: 60px;
            height: 60px;
            font-size: 30px;
          }
        }
      `}</style>
    </div>
  );
}
