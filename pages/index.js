import { useState, useEffect, useRef, useCallback } from "react";
import Link from 'next/link';
import ActivityMonitor from "../components/ActivityMonitor";
import SystemMetrics from "../components/SystemMetrics";

// Función para dividir un array en lotes de un tamaño específico
const chunkArray = (array, size) => {
  const chunkedArr = [];
  for (let i = 0; i < array.length; i += size) {
    chunkedArr.push(array.slice(i, i + size));
  }
  return chunkedArr;
};

export default function Home() {
  const [clave, setClave] = useState("");
  const [autorizado, setAutorizado] = useState(false);
  const [input, setInput] = useState("");
  const [resultado, setResultado] = useState([]); // Acumulará todos los resultados
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [jobInfo, setJobInfo] = useState(null);
  const [batchInfo, setBatchInfo] = useState(""); // Para info de lotes
  const [logs, setLogs] = useState([]); // Para almacenar los logs en tiempo real
  const [showLivePanel, setShowLivePanel] = useState(true); // Controla la visibilidad del panel (inicia visible)
  const [showMetrics, setShowMetrics] = useState(true); // Controla la visibilidad de las métricas
  
  const logsPanelRef = useRef(null);
  const pollingIntervalRef = useRef(null);

  const CLAVE_CORRECTA = process.env.NEXT_PUBLIC_PANEL_CLAVE || "oskar123";

  const handleLogin = (e) => {
    e.preventDefault();
    if (clave === CLAVE_CORRECTA) {
      setAutorizado(true);
      setError("");
    } else {
      setError("Clave incorrecta. Intenta nuevamente.");
      setClave("");
    }
  };

  // Función para añadir un log al panel
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, {
      id: Date.now(), // ID único para cada log
      timestamp,
      message,
      type // info, success, error, warning
    }]);
    
    // Mostrar el panel si está oculto
    if (!showLivePanel) {
      setShowLivePanel(true);
    }
    
    // Auto-scroll al último mensaje
    if (logsPanelRef.current) {
      setTimeout(() => {
        logsPanelRef.current.scrollTop = logsPanelRef.current.scrollHeight;
      }, 100);
    }
    
    // También mostrar en la consola para debugging
    console.log(`[${type.toUpperCase()}] ${message}`);
  }, [showLivePanel]);
  
  const startPolling = (jobId) => new Promise(async (resolve, reject) => {
    // Detener cualquier polling anterior
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    // Activar el panel de logs
    setShowLivePanel(true);
    addLog(`Iniciando seguimiento del trabajo #${jobId}`);

    // Esperar un momento para que el job se inicialice completamente
    await new Promise(resolve => setTimeout(resolve, 1000));
    addLog(`🔍 Verificando estado inicial del job...`, 'info');

    // Verificación inicial: asegurarse de que el job existe
    try {
      const initialRes = await fetch(`/api/job-status?id=${jobId}`);
      if (!initialRes.ok) {
        const errorMsg = `❌ Job ${jobId} no encontrado o no inicializado correctamente`;
        addLog(errorMsg, 'error');
        reject(new Error(errorMsg));
        return;
      }
      const initialData = await initialRes.json();
      addLog(`✅ Job encontrado, estado: ${initialData.status}`, 'success');
    } catch (initError) {
      const errorMsg = `❌ Error inicial verificando job ${jobId}: ${initError.message}`;
      addLog(errorMsg, 'error');
      reject(new Error(errorMsg));
      return;
    }

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/job-status?id=${jobId}`);        
        if (!res.ok) {
          // Si el servidor responde con un error (ej. 500), no seguimos intentando para este job.
          const errorMsg = `Error en polling para job ${jobId}: Status ${res.status}`;
          console.error(errorMsg);
          addLog(errorMsg, 'error');
          // No hacemos nada, el intervalo seguirá, pero no se procesará una respuesta inválida.
          return;
        }
        
        const data = await res.json();
        
        // Añadir información de progreso a los logs
        if (data.status === 'in_progress') {
          const newResults = data.results.filter(r => 
            !resultado.some(existingR => existingR.kinguinId === r.kinguinId && existingR.jobId === jobId)
          );
          
          if (newResults.length > 0) {
            const successes = newResults.filter(r => r.status === 'success').length;
            const failures = newResults.filter(r => r.status !== 'success').length;
            
            if (successes > 0) {
              addLog(`✅ ${successes} productos procesados con éxito`, 'success');
            }
            if (failures > 0) {
              addLog(`⚠️ ${failures} productos con errores`, 'warning');
            }
            
            // Mostrar detalles de los productos procesados
            newResults.forEach(r => {
              const icon = r.status === 'success' ? '✅' : '❌';
              const logType = r.status === 'success' ? 'success' : 'error';
              addLog(`${icon} ID: ${r.kinguinId} - ${r.reason || r.status}`, logType);
            });
          }
          
          // Actualizar información de progreso
          const totalProcessed = data.results.length;
          const pendingCount = data.summary?.total ? data.summary.total - totalProcessed : '?';
          addLog(`📊 Progreso: ${totalProcessed} procesados, ${pendingCount} pendientes`, 'info');
        }
        
        // Reemplazar los resultados del job actual, manteniendo los de jobs anteriores
        setResultado(prev => [...prev.filter(r => r.jobId !== jobId), ...data.results.map(r => ({...r, jobId}))]);

        if (data.status === 'completed' || data.status === 'failed') {
          if (data.status === 'completed') {
            addLog(`✅ Trabajo #${jobId} completado con éxito`, 'success');
          } else {
            addLog(`❌ Trabajo #${jobId} falló: ${data.summary?.error || "Sin mensaje de error"}`, 'error');
          }
          
          clearInterval(pollingIntervalRef.current);
          data.status === 'failed' ? reject(new Error(data.summary?.error || "El trabajo falló sin un mensaje específico.")) : resolve();
        }
      } catch (err) {
        // No hacer nada, el intervalo seguirá intentando
        console.error("Error en polling:", err);
        addLog(`⚠️ Error en comunicación: ${err.message}`, 'error');
      }
    }, 1500); // Consultar cada 1.5 segundos para una UI más reactiva
  });

  const handleSubmit = async () => {
    // Limpiar estados previos
    setResultado([]);
    setError("");
    setBatchInfo("");
    setJobInfo(null); // Limpiar info del job anterior
    setLogs([]); // Limpiar logs anteriores
    setShowLivePanel(true); // Mostrar el panel de logs
    
    // Validar input
    if (!input.trim()) {
      setError("Por favor ingresa al menos un ID de producto");
      return;
    }

    const ids = input
      .split(/[^\d]+/) // Separar por cualquier cosa que no sea número
      .filter((id) => id);

    if (ids.length === 0) {
      setError("No se encontraron IDs válidos. Asegúrate de ingresar números.");
      return;
    }

    setCargando(true);
    addLog(`🚀 Iniciando procesamiento para ${ids.length} productos`, 'info');

    const idChunks = chunkArray(ids, 50);
    const totalBatches = idChunks.length;

    for (let i = 0; i < idChunks.length; i++) {
      const batch = idChunks[i];
      const batchNumber = i + 1;

      setBatchInfo(`Procesando lote ${batchNumber} de ${totalBatches}...`);
      addLog(`🔄 Enviando lote ${batchNumber} de ${totalBatches} (${batch.length} productos)`, 'info');

      try {
        const startTime = Date.now();
        addLog(`⏱️ Enviando solicitud HTTP para el lote ${batchNumber}...`, 'info');
        
        // Implementación con reintentos para errores 429 (too many requests)
        const MAX_RETRIES = 5;
        let retryCount = 0;
        let response;
        
        while (retryCount <= MAX_RETRIES) {
          try {
            response = await fetch("/api/add-product", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kinguinIds: batch }),
            });
            
            // Si no es un error 429, continuar normalmente
            if (response.status !== 429) {
              break;
            }
            
            // Si es error 429, calcular tiempo de espera y reintentar
            retryCount++;
            if (retryCount > MAX_RETRIES) {
              break; // Demasiados reintentos, salir del bucle
            }
            
            // Calcular retraso con retroceso exponencial
            const retryAfter = response.headers.get('retry-after');
            let waitTime = Math.min(1000 * Math.pow(2, retryCount), 30000); // Entre 1s y 30s
            
            // Si hay un header retry-after, usarlo
            if (retryAfter) {
              const parsedTime = parseInt(retryAfter, 10);
              if (!isNaN(parsedTime)) {
                waitTime = parsedTime * 1000;
              }
            }
            
            addLog(`⚠️ Error 429 (too many requests). Reintentando en ${Math.round(waitTime/1000)}s... (${retryCount}/${MAX_RETRIES})`, 'warning');
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
          } catch (fetchError) {
            // Errores de red, reintentar
            retryCount++;
            if (retryCount > MAX_RETRIES) {
              throw fetchError; // Demasiados reintentos, lanzar el error
            }
            
            const waitTime = Math.min(1000 * Math.pow(2, retryCount), 15000);
            addLog(`⚠️ Error de red. Reintentando en ${Math.round(waitTime/1000)}s... (${retryCount}/${MAX_RETRIES})`, 'warning');
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }

        const responseTime = ((Date.now() - startTime) / 1000).toFixed(2);
        
        if (response.status !== 202) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData.message || `Error HTTP ${response.status} en el lote ${batchNumber}`;
          addLog(`❌ Error: ${errorMsg} (${responseTime}s)`, 'error');
          throw new Error(errorMsg);
        }

        const data = await response.json();
        addLog(`✅ Lote ${batchNumber} aceptado. ID del trabajo: ${data.jobId} (${responseTime}s)`, 'success');
        setJobInfo({ id: data.jobId, message: data.message });
        
        // Esperar a que el polling termine para este lote.
        // La promesa de startPolling se resolverá cuando el job esté 'completed'
        // o se rechazará si está 'failed'.
        await startPolling(data.jobId);
        addLog(`✓ Lote ${batchNumber} completado`, 'success');
      } catch (err) {
        const errorMsg = `Fallo en el lote ${batchNumber}: ${err.message}. Proceso detenido.`;
        setError(errorMsg);
        addLog(`❌ ${errorMsg}`, 'error');
        setBatchInfo("");
        break; // Detener el bucle si un lote falla
      }
    }

    setCargando(false);
    // Mensaje final que resume el total de productos procesados, no solo los lotes.
    const finalMessage = `¡Proceso completado! Se procesaron un total de ${ids.length} productos.`;
    setBatchInfo(finalMessage);
    addLog(`🎉 ${finalMessage}`, 'success');
    setInput("");
  };

  // Función para obtener el mensaje apropiado para cada resultado
  const obtenerMensajeResultado = (resultado) => {
    return resultado.message || `Estado: ${resultado.status}, Razón: ${resultado.reason}`;
  };

  // Limpiar el intervalo cuando el componente se desmonte
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, []);

  // Añadir un mensaje de bienvenida al panel de logs
  useEffect(() => {
    if (autorizado) {
      // Solo añadir logs cuando el usuario está autenticado
      addLog('✨ ¡Bienvenido al Monitor de Actividad!', 'info');
      addLog('📋 El panel mostrará el estado en tiempo real del procesamiento de productos', 'info');
      addLog('⏱️ El sistema está listo para procesar productos', 'success');
    }
  }, [autorizado, addLog]);

  // Añadir un botón para abrir/cerrar el panel de logs
  const toggleLivePanel = () => {
    setShowLivePanel(prev => {
      if (!prev) {
        // Si estamos activando el panel, agregar un log
        setTimeout(() => addLog('🔄 Panel activado', 'info'), 100);
      }
      return !prev;
    });
  };
  
  // Función para mostrar un mensaje de prueba en el panel
  const testMonitor = () => {
    addLog('🔔 Test del monitor - El panel está funcionando correctamente', 'success');
    addLog('📊 Generando mensaje de prueba...', 'info');
    setTimeout(() => {
      addLog('✅ Monitor confirmado operativo', 'success');
    }, 1000);
  };

  if (!autorizado) {
    return (
      <>
        <style jsx>{`
          .login-container {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
          }
          
          .login-card {
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            width: 100%;
            max-width: 400px;
            animation: slideUp 0.4s ease-out;
          }
          
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          
          .login-title {
            font-size: 28px;
            font-weight: bold;
            margin-bottom: 10px;
            text-align: center;
            color: #2d3748;
          }
          
          .login-subtitle {
            color: #718096;
            text-align: center;
            margin-bottom: 30px;
            font-size: 14px;
          }
          
          .login-form {
            display: flex;
            flex-direction: column;
            gap: 20px;
          }
          
          .input-group {
            position: relative;
          }
          
          .login-input {
            width: 100%;
            padding: 12px 15px 12px 45px;
            border: 2px solid #e2e8f0;
            border-radius: 10px;
            font-size: 16px;
            transition: all 0.3s;
            outline: none;
          }
          
          .login-input:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
          }
          
          .input-icon {
            position: absolute;
            left: 15px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 20px;
          }
          
          .login-button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 14px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
          }
          
          .login-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
          }
          
          .login-button:active {
            transform: translateY(0);
          }
          
          .error-message {
            background: #fed7d7;
            color: #c53030;
            padding: 10px 15px;
            border-radius: 8px;
            font-size: 14px;
            text-align: center;
            animation: shake 0.5s;
          }
          
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-5px); }
            75% { transform: translateX(5px); }
          }
          
          @media (max-width: 480px) {
            .login-card {
              padding: 30px 20px;
            }
          }
        `}</style>
        
        <div className="login-container">
          <div className="login-card">
            <h1 className="login-title">🔐 Panel de Control</h1>
            <p className="login-subtitle">Ingresa tus credenciales para continuar</p>
            
            <form className="login-form" onSubmit={handleLogin}>
              <div className="input-group">
                <span className="input-icon">🔒</span>
                <input
                  type="password"
                  className="login-input"
                  placeholder="Ingresa la clave de acceso"
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  autoFocus
                />
              </div>
              
              {error && <div className="error-message">{error}</div>}
              
              <button type="submit" className="login-button">
                Acceder al Panel
              </button>
            </form>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style jsx>{`
        .container {
          min-height: 100vh;
          background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
          padding: 20px;
        }
        
        .header {
          background: white;
          border-radius: 20px;
          padding: 30px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
          margin-bottom: 30px;
          animation: slideDown 0.4s ease-out;
        }
        
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .title {
          font-size: 32px;
          font-weight: bold;
          color: #2d3748;
          margin-bottom: 10px;
        }
        
        .subtitle {
          color: #718096;
          font-size: 16px;
        }
        
        .main-card {
          background: white;
          border-radius: 20px;
          padding: 30px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
          max-width: 800px;
          margin: 0 auto;
          animation: fadeIn 0.5s ease-out 0.2s both;
        }
        
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .label {
          display: block;
          font-weight: 600;
          color: #4a5568;
          margin-bottom: 10px;
          font-size: 14px;
        }
        
        .textarea {
          width: 100%;
          padding: 15px;
          border: 2px solid #e2e8f0;
          border-radius: 12px;
          font-size: 14px;
          font-family: 'Monaco', 'Courier New', monospace;
          resize: vertical;
          min-height: 120px;
          transition: all 0.3s;
          outline: none;
        }
        
        .textarea:focus {
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        .button-container {
          margin-top: 20px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        
        .button-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 12px 30px;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        
        .button-primary:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }
        
        .button-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .button-secondary {
          background: #f7fafc;
          color: #4a5568;
          border: 2px solid #e2e8f0;
          padding: 12px 30px;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .button-secondary:hover {
          background: #edf2f7;
          border-color: #cbd5e0;
        }
        
        .error-alert {
          background: #fed7d7;
          color: #c53030;
          padding: 15px 20px;
          border-radius: 12px;
          margin-top: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
          animation: slideIn 0.3s ease-out;
        }
        
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        .results-container {
          margin-top: 30px;
          background: white;
          border-radius: 20px;
          padding: 30px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
          animation: expandIn 0.4s ease-out;
        }
        
        @keyframes expandIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        
        .results-title {
          font-size: 20px;
          font-weight: bold;
          color: #2d3748;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .results-stats {
          display: flex;
          gap: 20px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        
        .stat-card {
          background: #f7fafc;
          padding: 10px 20px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .stat-label {
          color: #718096;
          font-size: 14px;
        }
        
        .stat-value {
          font-weight: bold;
          font-size: 18px;
        }
        
        .results-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        
        .result-item {
          padding: 15px 20px;
          border-radius: 10px;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 15px;
          transition: all 0.3s;
          animation: fadeInUp 0.3s ease-out;
        }
        
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .result-item.success {
          background: #c6f6d5;
          border: 2px solid #9ae6b4;
        }
        
        .result-item.error {
          background: #fed7d7;
          border: 2px solid #fc8181;
        }
        
        .result-icon {
          font-size: 24px;
        }
        
        .result-content {
          flex: 1;
        }
        
        .result-id {
          font-weight: bold;
          color: #2d3748;
          font-size: 16px;
        }
        
        .result-message {
          color: #4a5568;
          font-size: 14px;
          margin-top: 4px;
        }
        
        .result-status-badge {
          font-size: 10px;
          font-weight: bold;
          padding: 3px 8px;
          border-radius: 12px;
          color: white;
          margin-left: 10px;
        }

        .result-header {
          display: flex;
          align-items: center;
        }
        
        .spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 3px solid rgba(102, 126, 234, 0.3);
          border-radius: 50%;
          border-top-color: #667eea;
          animation: spin 0.8s linear infinite;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        .help-text {
          color: #718096;
          font-size: 13px;
          margin-top: 8px;
          font-style: italic;
        }
        
        .logout-button {
          position: fixed;
          top: 20px;
          right: 20px;
          background: white;
          color: #e53e3e;
          border: 2px solid #e53e3e;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .logout-button:hover {
          background: #e53e3e;
          color: white;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(229, 62, 62, 0.3);
        }
        
        /* Estilos para el panel de logs en tiempo real */
        .live-panel {
          margin-top: 25px;
          background: #1a202c;
          border-radius: 12px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
          overflow: hidden;
          transition: all 0.5s ease;
          border: 2px solid #4a5568;
        }
        
        .live-panel-visible {
          opacity: 1;
          max-height: 500px;
          margin-bottom: 30px;
          animation: pulseHighlight 2s ease;
        }
        
        @keyframes pulseHighlight {
          0% { box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.4); }
          70% { box-shadow: 0 0 0 15px rgba(102, 126, 234, 0); }
          100% { box-shadow: 0 0 0 0 rgba(102, 126, 234, 0); }
        }
        
        .panel-highlight {
          animation: flashBorder 1s ease-out;
          border-color: #667eea;
          box-shadow: 0 0 20px rgba(102, 126, 234, 0.6);
        }
        
        @keyframes flashBorder {
          0%, 100% { border-color: #667eea; }
          50% { border-color: #4c51bf; }
        }
        
        .live-panel-hidden {
          opacity: 0;
          max-height: 0;
          margin-top: 0;
          margin-bottom: 0;
          padding: 0;
          border-width: 0;
          pointer-events: none;
        }
        
        .live-panel-header {
          padding: 15px 20px;
          background: linear-gradient(135deg, #2d3748 0%, #1a365d 100%);
          color: white;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #4a5568;
        }
        
        .live-panel-header h4 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .panel-controls {
          display: flex;
          gap: 10px;
        }
        
        .panel-control-button,
        .live-panel-close {
          background: none;
          border: none;
          color: white;
          font-size: 16px;
          cursor: pointer;
          padding: 4px 8px;
          opacity: 0.7;
          transition: all 0.2s;
          border-radius: 4px;
        }
        
        .panel-control-button:hover,
        .live-panel-close:hover {
          opacity: 1;
          background: rgba(255, 255, 255, 0.1);
        }
        
        .live-panel-close {
          background: rgba(255, 255, 255, 0.05);
        }
        
        .live-panel-close:hover {
          background: rgba(255, 0, 0, 0.2);
        }
        
        .logs-container {
          height: 350px;
          overflow-y: auto;
          padding: 15px;
          font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
          font-size: 13px;
          background: #161b22;
        }
        
        .no-logs {
          color: #a0aec0;
          text-align: center;
          padding: 40px 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 15px;
        }
        
        .no-logs span {
          font-size: 40px;
          margin-bottom: 10px;
        }
        
        .no-logs p {
          margin: 5px 0;
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
          from {
            opacity: 0;
            transform: translateY(-5px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .log-time {
          color: #a0aec0;
          margin-right: 12px;
          font-weight: 500;
          min-width: 80px;
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
        }
        
        .live-panel-footer {
          padding: 10px 20px;
          background: #2d3748;
          border-top: 1px solid #4a5568;
          display: flex;
          justify-content: space-between;
          color: #a0aec0;
          font-size: 12px;
        }
        
        .panel-status {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #48bb78;
        }

        @media (max-width: 640px) {
          .container {
            padding: 10px;
          }
          
          .header, .main-card, .results-container {
            padding: 20px;
          }
          
          .title {
            font-size: 24px;
          }
          
          .logout-button {
            position: static;
            margin-bottom: 20px;
            width: 100%;
            justify-content: center;
          }
          
          .logs-container {
            height: 200px;
          }
          
          .log-time {
            min-width: 60px;
            font-size: 10px;
          }
        }
      `}</style>
      
      <div className="container">
        <button 
          className="logout-button"
          onClick={() => {
            setAutorizado(false);
            setClave("");
            setInput("");
            setResultado([]);
            setError("");
          }}
        >
          <span>🚪</span> Cerrar Sesión
        </button>
        
        <div className="header">
          <h1 className="title">🛒 Panel de Gestión de Productos</h1>
          <p className="subtitle">Sincroniza productos de Kinguin con Supabase y MercadoLibre</p>
        </div>
        
        <div className="main-card">
          <label className="label">
            📝 IDs de Productos Kinguin
          </label>
          <textarea
            className="textarea"
            placeholder="Ingresa los IDs separados por comas, espacios o saltos de línea&#10;Ejemplo: 12345, 67890&#10;        23456&#10;        78901"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={cargando}
          />
          <p className="help-text">
            💡 Tip: Puedes pegar múltiples IDs en cualquier formato y el sistema los detectará automáticamente
          </p>
          
          <div className="button-container">
            <button 
              className="button-primary"
              onClick={handleSubmit}
              disabled={cargando || !input.trim()}
            >
              {cargando ? (
                <>
                  <span className="spinner"></span>
                  Procesando...
                </>
              ) : (
                <>
                  <span>🚀</span>
                  Agregar Productos
                </>
              )}
            </button>
            
            {input && !cargando && (
              <button 
                className="button-secondary"
                onClick={() => {
                  setInput("");
                  setResultado([]);
                  setError("");
                }}
              >
                Limpiar
              </button>
            )}
            
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <Link 
                href="/product-manager" 
                className="button-secondary"
                style={{
                  background: '#1a365d',
                  color: 'white',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <span>📊</span> Gestor de Productos
              </Link>
              
              <Link 
                href="/cron-jobs" 
                className="button-secondary"
                style={{
                  background: '#2b6cb0',
                  color: 'white',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <span>🕒</span> Tareas Programadas
              </Link>
              
              <button 
                className="button-secondary"
                onClick={() => {
                  setShowLivePanel(true);
                  addLog('🔄 Panel activado manualmente', 'info');
                  // Agregar clase para hacer parpadear el panel
                  const panel = document.querySelector('.live-panel');
                  if (panel) {
                    panel.classList.add('panel-highlight');
                    setTimeout(() => panel.classList.remove('panel-highlight'), 2000);
                  }
                }}
                style={{
                  background: '#4a5568',
                  color: 'white',
                  border: '2px solid #667eea'
                }}
              >
                ⚡ Activar Monitor
              </button>
              
              <button 
                className="button-secondary"
                onClick={testMonitor}
                style={{
                  background: '#805ad5',
                  color: 'white',
                }}
              >
                🧪 Probar Monitor
              </button>
              
              <button 
                className="button-secondary"
                onClick={() => setShowMetrics(!showMetrics)}
                style={{
                  background: showMetrics ? '#38b2ac' : '#718096',
                  color: 'white',
                }}
              >
                📊 {showMetrics ? 'Ocultar Métricas' : 'Mostrar Métricas'}
              </button>
            </div>
          </div>
          
          {error && (
            <div className="error-alert">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {batchInfo && !error && (
            <div className="error-alert" style={{ background: '#d6bcfa', color: '#44337a', marginTop: '20px' }}>
              <span>{cargando ? '⏳' : '✅'}</span>
              <span>{batchInfo}</span>
            </div>
          )}

          {jobInfo && !error && !cargando && (
            <div className="error-alert" style={{ background: '#bee3f8', color: '#2c5282', marginTop: '20px' }}>
              <span>ℹ️</span>
              <span>
                Proceso completado. Puedes iniciar uno nuevo.
              </span>
            </div>
          )}
          
          {/* Panel de logs en tiempo real - Siempre visible cuando showLivePanel=true */}
          {/* Panel de métricas */}
          {showMetrics && <SystemMetrics visible={showMetrics} refreshInterval={15000} />}
          
          {/* Panel de logs de actividad en tiempo real desde base de datos */}
          <ActivityMonitor visible={showLivePanel} jobId={jobInfo?.id} maxLogs={100} />
          
          {/* Panel de logs manual (modo legacy) */}
          <div className={`live-panel ${showLivePanel ? 'live-panel-visible' : 'live-panel-hidden'}`}>
            <div className="live-panel-header">
              <h4>📊 Monitor de actividad en tiempo real (local)</h4>
              <div className="panel-controls">
                <button className="panel-control-button" onClick={() => setLogs([])}>
                  🗑️
                </button>
                <button 
                  className="live-panel-close" 
                  onClick={() => setShowLivePanel(false)}
                >
                  ✖
                </button>
              </div>
            </div>
            <div className="logs-container" ref={logsPanelRef}>
              {logs.length === 0 ? (
                <div className="no-logs">
                  <span>⏳</span> 
                  <p>Esperando actividad...</p>
                  <p className="help-text">Cuando inicies un proceso, los logs aparecerán aquí</p>
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className={`log-entry log-${log.type}`}>
                    <span className="log-time">{log.timestamp}</span>
                    <span className="log-message">{log.message}</span>
                  </div>
                ))
              )}
            </div>
            <div className="live-panel-footer">
              <span className="logs-count">{logs.length} mensajes</span>
              <span className="panel-status">● En vivo</span>
            </div>
          </div>
        </div>
        
        {resultado.length > 0 && (
          <div className="results-container">
            <h3 className="results-title">
              <span>📊</span>
              Resultados del Procesamiento
            </h3>
            
            <div className="results-stats">
              <div className="stat-card">
                <span className="stat-label">Total:</span>
                <span className="stat-value">{resultado.length}</span>
              </div>
              <div className="stat-card" style={{ background: '#c6f6d5' }}>
                <span className="stat-label">Exitosos:</span>
                <span className="stat-value" style={{ color: '#22543d' }}>
                  {resultado.filter(r => r.status === 'success').length}
                </span>
              </div>
              <div className="stat-card" style={{ background: '#fed7d7' }}>
                <span className="stat-label">Errores:</span>
                <span className="stat-value" style={{ color: '#742a2a' }}>
                  {resultado.filter(r => r.status === 'error' || r.status === 'failed').length}
                </span>
              </div>
            </div>
            
            <ul className="results-list">
              {resultado.map((r, i) => {
                const isSuccess = r.status === 'success';
                return ( // Usamos el ID del producto + índice como clave para evitar duplicados si un ID se procesa varias veces
                <li 
                  key={i} 
                  className={`result-item ${isSuccess ? 'success' : 'error'}`}
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <span className="result-icon">
                    {isSuccess ? '✅' : '❌'}
                  </span>
                  <div className="result-content">
                    <div className="result-id">
                      Producto ID: {r.kinguinId}
                    </div>
                    <div className="result-message">
                      {obtenerMensajeResultado(r)}
                    </div>
                  </div>
                </li>
              )})}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}