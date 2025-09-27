// components/LogViewer.js
import { useState, useEffect, useRef, useMemo } from 'react';

/**
 * Componente avanzado para monitoreo de actividad del sistema
 * Características:
 * - Visualización cronológica de eventos (más antiguos arriba, más recientes abajo)
 * - Agrupación inteligente de eventos por etapas y productos
 * - Filtrado de logs por tipo, etapa o texto
 * - Estadísticas en tiempo real
 * - Tema oscuro de alto contraste para mejor legibilidad
 * - Resaltado de eventos importantes
 * - Autoscroll inteligente con detección de interacción
 * - Exportación de logs
 */
export default function LogViewer({ jobId }) {
  // Estado principal
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState(null);
  const logsEndRef = useRef(null);
  const intervalRef = useRef(null);
  const containerRef = useRef(null);

  // Estado para filtros y opciones avanzadas
  const [filterText, setFilterText] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [expandedDetails, setExpandedDetails] = useState({});
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [showTimestampFull, setShowTimestampFull] = useState(false);
  const [userScrolled, setUserScrolled] = useState(false);
  const [activeProducts, setActiveProducts] = useState([]);
  const [lastRefreshTime, setLastRefreshTime] = useState(null);

  // Cargar logs iniciales
  useEffect(() => {
    if (jobId) {
      fetchLogs();
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [jobId]);

  // Iniciar actualización automática
  useEffect(() => {
    if (jobId && !paused) {
      intervalRef.current = setInterval(() => {
        fetchLogs(false);
      }, 5000); // Actualizar cada 5 segundos
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [jobId, paused]);

  // Auto-scroll al último log, respetando la interacción del usuario
  useEffect(() => {
    if (autoScrollEnabled && !userScrolled && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScrollEnabled, userScrolled]);
  
  // Aplicar filtros a los logs
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Filtrar por texto
      const textMatch = filterText ? 
        log.message.toLowerCase().includes(filterText.toLowerCase()) : 
        true;
      
      // Filtrar por tipo
      let typeMatch = true;
      if (filterType !== 'all') {
        const match = log.message.match(/\[(.*?)\]/);
        const stage = match?.[1];
        
        // Agrupar por categoría
        if (filterType === 'error' && (stage === 'ERROR' || stage === 'RECHAZADO')) {
          typeMatch = true;
        } else if (filterType === 'success' && (stage === 'APROBADO' || stage === 'CREADO')) {
          typeMatch = true;
        } else if (filterType === 'info' && (stage === 'INFO_KINGUIN' || stage === 'PRECIO' || stage === 'DESCRIPCION')) {
          typeMatch = true;
        } else if (filterType === 'action' && (stage === 'NUEVO' || stage === 'ACTUALIZAR' || stage === 'INICIO')) {
          typeMatch = true;
        } else if (filterType === stage) {
          typeMatch = true;
        } else {
          typeMatch = false;
        }
      }
      
      return textMatch && typeMatch;
    });
  }, [logs, filterText, filterType]);
  
  // Calcular estadísticas de los logs
  const stats = useMemo(() => {
    const total = logs.length;
    const errors = logs.filter(log => {
      const match = log.message.match(/\[(ERROR|RECHAZADO)\]/i);
      return !!match;
    }).length;
    
    const successes = logs.filter(log => {
      const match = log.message.match(/\[(APROBADO|CREADO)\]/i);
      return !!match;
    }).length;
    
    const warnings = logs.filter(log => {
      const match = log.message.match(/\[(SKIP|WARN)\]/i);
      return !!match;
    }).length;
    
    return {
      total,
      errors,
      successes,
      warnings,
      filtered: filteredLogs.length,
      products: activeProducts.length
    };
  }, [logs, filteredLogs, activeProducts]);

  // Detectar scroll manual del usuario
  const handleScroll = () => {
    if (!containerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 10;
    
    // Si el usuario ha hecho scroll manualmente y no está al final
    if (!isAtBottom && !userScrolled) {
      setUserScrolled(true);
    }
    
    // Si volvió al final, permitir autoscroll de nuevo
    if (isAtBottom && userScrolled) {
      setUserScrolled(false);
    }
  };

  // Función mejorada para obtener logs
  const fetchLogs = async (showLoading = true) => {
    if (!jobId) return;
    if (showLoading) setLoading(true);
    
    try {
      const response = await fetch(`/api/activity-logs?jobId=${jobId}`);
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      if (data && data.success) {
        // Ordenar por fecha en orden ASCENDENTE (del más antiguo al más reciente)
        const sortedLogs = data.logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        setLogs(sortedLogs);
        
        // Extraer productos activos
        const products = extractActiveProducts(sortedLogs);
        setActiveProducts(products);
        
        // Registrar hora de última actualización
        setLastRefreshTime(new Date());
      }
      setError(null);
    } catch (err) {
      console.error("Error al cargar logs:", err);
      setError(`Error al cargar logs: ${err.message}`);
    } finally {
      if (showLoading) setLoading(false);
    }
  };
  
  // Extraer productos activos de los logs
  const extractActiveProducts = (logs) => {
    const productMap = {};
    
    logs.forEach(log => {
      // Buscar IDs de producto en el mensaje (Kinguin ID o ML ID)
      const kinguinMatch = log.message.match(/Kinguin(?:\s+)?ID:?\s*(\d+)/i);
      const mlMatch = log.message.match(/ML(?:\s+)?ID:?\s*([A-Z0-9]+)/i);
      
      if (kinguinMatch || mlMatch) {
        const kinguinId = kinguinMatch ? kinguinMatch[1] : null;
        const mlId = mlMatch ? mlMatch[1] : null;
        
        const productKey = kinguinId || mlId;
        if (!productKey) return;
        
        // Extraer título del producto si está disponible
        const titleMatch = log.message.match(/[Tt]ítulo:?\s*"([^"]+)"/i);
        const title = titleMatch ? titleMatch[1] : null;
        
        // Extraer estado si está disponible
        const statusMatch = log.message.match(/\[(APROBADO|RECHAZADO|PENDIENTE|ERROR|CREADO|PUBLICADO|SKIP)\]/i);
        const status = statusMatch ? statusMatch[1] : null;
        
        // Extraer estado de MercadoLibre si está disponible
        const mlStatusMatch = log.message.match(/[Ee]stado(?:\s+en)?\s+ML:\s*"([^"]+)"/i) || 
                            log.message.match(/[Ee]stado(?:\s+en)?\s+MercadoLibre:\s*"([^"]+)"/i);
        const mlStatus = mlStatusMatch ? mlStatusMatch[1] : null;
        
        // Extraer precio CLP si está disponible
        const priceCLPMatch = log.message.match(/[Pp]recio(?:\s+final)?(?:\s+calculado)?:\s*(\d+(?:[\.,]\d+)?)\s*CLP/i);
        const priceCLP = priceCLPMatch ? parseFloat(priceCLPMatch[1].replace(/\./g, '').replace(',', '.')) : null;
        
        // Extraer precio EUR si está disponible
        const priceEURMatch = log.message.match(/[Pp]recio(?:\s+final)?(?:\s+calculado)?:\s*(\d+(?:[\.,]\d+)?)\s*EUR/i) || 
                              log.message.match(/[Pp]recio EUR:\s*(\d+(?:[\.,]\d+)?)/i);
        const priceEUR = priceEURMatch ? parseFloat(priceEURMatch[1].replace(',', '.')) : null;
        
        // Extraer tipo de cambio si está disponible
        const fxMatch = log.message.match(/(?:FX|[Tt]ipo\s+de\s+cambio):\s*(\d+(?:[\.,]\d+)?)/i);
        const exchangeRate = fxMatch ? parseFloat(fxMatch[1].replace(',', '.')) : null;
        
        // Crear o actualizar información del producto
        if (!productMap[productKey]) {
          productMap[productKey] = {
            kinguinId: kinguinId,
            mlId: mlId,
            title: title,
            price: priceCLP,
            eurPrice: priceEUR,
            exchangeRate: exchangeRate,
            lastStatus: status,
            mlStatus: mlStatus,
            lastUpdated: log.timestamp
          };
        } else {
          // Actualizar con la información más reciente
          if (title) productMap[productKey].title = title;
          if (status) productMap[productKey].lastStatus = status;
          if (mlStatus) productMap[productKey].mlStatus = mlStatus;
          if (priceCLP) productMap[productKey].price = priceCLP;
          if (priceEUR) productMap[productKey].eurPrice = priceEUR;
          if (exchangeRate) productMap[productKey].exchangeRate = exchangeRate;
          if (log.timestamp > productMap[productKey].lastUpdated) {
            productMap[productKey].lastUpdated = log.timestamp;
          }
        }
      }
    });
    
    // Convertir a array y ordenar por última actualización
    return Object.values(productMap)
      .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
  };

  // Alternar pausa/reanudar actualizaciones
  const togglePause = () => {
    setPaused(!paused);
  };

  // Limpiar logs
  const clearLogs = () => {
    setLogs([]);
    setActiveProducts([]);
  };
  
  // Exportar logs para análisis
  const exportLogs = () => {
    try {
      const data = JSON.stringify(logs, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `activity-logs-${jobId}-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (err) {
      console.error('Error al exportar logs:', err);
      setError('Error al exportar logs: ' + err.message);
    }
  };
  
  // Buscar en logs
  const handleFilterChange = (e) => {
    setFilterText(e.target.value);
  };
  
  // Cambiar filtro por tipo
  const handleTypeFilterChange = (e) => {
    setFilterType(e.target.value);
  };
  
  // Alternar detalles expandidos
  const toggleDetails = (logId) => {
    setExpandedDetails(prev => ({
      ...prev,
      [logId]: !prev[logId]
    }));
  };

  // Formatear timestamp
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    
    if (showTimestampFull) {
      return date.toLocaleString();
    }
    
    return date.toLocaleTimeString();
  };

  // Determinar icono y clase para el tipo de log
  const getLogTypeInfo = (message) => {
    // Patrones de mensaje
    const patterns = {
      'INICIO': { emoji: '🔄', cssClass: 'stage-inicio', title: 'Inicio de proceso' },
      'INFO_KINGUIN': { emoji: 'ℹ️', cssClass: 'stage-info_kinguin', title: 'Información de Kinguin' },
      'PRECIO': { emoji: '💲', cssClass: 'stage-precio', title: 'Cálculo de precio' },
      'NUEVO': { emoji: '🆕', cssClass: 'stage-nuevo', title: 'Producto nuevo' },
      'ACTUALIZAR': { emoji: '🔄', cssClass: 'stage-actualizar', title: 'Actualización de producto' },
      'CREADO': { emoji: '📝', cssClass: 'stage-creado', title: 'Producto creado' },
      'APROBADO': { emoji: '✅', cssClass: 'stage-aprobado', title: 'Producto aprobado' },
      'PUBLICADO': { emoji: '🚀', cssClass: 'stage-aprobado', title: 'Producto publicado' },
      'DESCRIPCION': { emoji: '📄', cssClass: 'stage-descripcion', title: 'Creación de descripción' },
      'ERROR': { emoji: '❌', cssClass: 'stage-error', title: 'Error' },
      'RECHAZADO': { emoji: '❌', cssClass: 'stage-rechazado', title: 'Producto rechazado' },
      'SKIP': { emoji: '⏭️', cssClass: 'stage-skip', title: 'Proceso omitido' },
      'WARN': { emoji: '⚠️', cssClass: 'stage-warning', title: 'Advertencia' },
      'FX': { emoji: '💱', cssClass: 'stage-fx', title: 'Tipo de cambio' },
      'ML': { emoji: '🛒', cssClass: 'stage-ml', title: 'MercadoLibre' },
      'STOCK': { emoji: '📦', cssClass: 'stage-stock', title: 'Actualización de stock' },
      'SYNC': { emoji: '🔄', cssClass: 'stage-sync', title: 'Sincronización' },
      'OFERTA': { emoji: '🏷️', cssClass: 'stage-oferta', title: 'Oferta' }
    };

    // Buscar el patrón en el mensaje
    const match = message?.match(/\[(.*?)\]/);
    const stage = match?.[1];
    
    if (stage && patterns[stage]) {
      return patterns[stage];
    }
    
    // Si no encuentra un patrón específico, asignar según tipo de log
    return { emoji: '📋', cssClass: 'log-info', title: 'Información' };
  };

  // Determinar la clase CSS según el tipo de log
  const getLogClass = (type, message) => {
    const typeClass = `log-${type || 'info'}`;
    const stageInfo = getLogTypeInfo(message);
    return `${typeClass} ${stageInfo.cssClass}`;
  };
  
  // Resaltar IDs, valores numéricos, precios y estados en los mensajes
  const formatLogMessage = (message) => {
    if (!message) return '';
    
    // Reemplazar con spans coloreados para mejor legibilidad
    return message
      // Etiquetas de fase [INICIO], [PRECIO], etc
      .replace(/\[(.*?)\]/g, '<span class="log-tag">[$1]</span>')
      
      // IDs de productos
      .replace(/(Kinguin ID|KinguinID|ML ID):\s*([A-Z0-9]+)/gi, 
               '$1: <span class="log-id">$2</span>')
      
      // Destacar precios y tipos de cambio
      .replace(/([Pp]recio(?:\s+final)?(?:\s+calculado)?:)\s*(\d+(?:[\.,]\d+)?)\s*(EUR|CLP|€|\$)/gi, 
               '$1 <span class="log-price">$2</span> <span class="log-currency">$3</span>')
      .replace(/(FX|[Tt]ipo\s+(?:de\s+)?cambio):\s*(\d+(?:[\.,]\d+)?)/gi, 
               '$1: <span class="log-exchange-rate">$2</span>')
      
      // Destacar estados de publicación
      .replace(/([Pp]ublicado|[Cc]reado|[Aa]ctualizado|[Aa]probado)(\s+en\s+MercadoLibre)/gi, 
               '<span class="log-success-action">$1$2</span>')
      .replace(/([Pp]ausado|[Rr]echazado|[Nn]o\s+publicado)(\s+en\s+MercadoLibre)?/gi, 
               '<span class="log-error-action">$1$2</span>')
      .replace(/[Ee]stado(?:\s+en)?\s+(ML|MercadoLibre):\s*"([^"]+)"/gi, 
               'Estado en $1: "<span class="log-ml-status-$2">$2</span>"')
      
      // Destacar información de stock
      .replace(/([Ss]tock|[Ii]nventory):\s*(\d+)/gi,
               '$1: <span class="log-stock">$2</span>')
      .replace(/([Ss]in\s+[Ss]tock|[Ss]tock\s+insuficiente|[Nn]o\s+disponible)/gi,
               '<span class="log-stock-error">$1</span>')
      .replace(/([Ee]n\s+[Ss]tock|[Dd]isponible)/gi,
               '<span class="log-stock-available">$1</span>')
      
      // Destacar categorías de errores de ML
      .replace(/[Cc]ategoría(?:\s+de)?\s+error:\s*(\w+)/gi, 
               'Categoría de error: <span class="ml-error-category">$1</span>')
      .replace(/[Cc]ategory:\s*(\w+)_error/gi, 
               'Categoría: <span class="ml-error-category">$1</span>')
      .replace(/Error 400 de MercadoLibre/gi, 
               '<span class="log-error-detail">Error 400 de MercadoLibre</span>')
               
      // Destacar acciones de recuperación
      .replace(/[Aa]cción(?:\s+de)?\s+[Rr]ecuperación:\s*(.+?)(?:\.|$)/gi, 
               'Acción de Recuperación: <span class="ml-error-recovery">$1</span>')
      .replace(/[Rr]ecovery[Aa]ction:\s*(.+?)(?:\.|$)/gi, 
               'Recuperación: <span class="ml-error-recovery">$1</span>')
      .replace(/[Ss]e\s+[Aa]ctualizó\s+(.+?)(?:\s+omitiendo\s+|$)/gi, 
               'Se actualizó <span class="log-success-action">$1</span> omitiendo ')
               
      // Destacar JSON y objetos
      .replace(/(\{(?:[^{}]|\{[^{}]*\})*\})/g, 
               '<span class="log-json">$1</span>')
      
      // Cualquier otro valor numérico y porcentajes
      .replace(/(\d+(?:[\.,]\d+)?)\s+(EUR|CLP|%|€|\$)/gi, 
               '<span class="log-number">$1</span> $2')
      
      // Errores y excepciones
      .replace(/(Error|Exception|Failed|Falló):\s*([^<]+)/gi, 
               '$1: <span class="log-error-detail">$2</span>')
      
      // Títulos de productos
      .replace(/([Tt]ítulo|[Tt]itulo):\s*"([^"]+)"/gi, 
               '$1: "<span class="log-product-title">$2</span>"');
  };
  
  // Extraer detalles JSON si están disponibles
  const extractDetails = (log) => {
    if (!log.details) return null;
    
    try {
      // Si es string, intentar parsear
      const details = typeof log.details === 'string' ? 
        JSON.parse(log.details) : log.details;
      return details;
    } catch (err) {
      // Si no es JSON válido, devolver como texto
      return log.details;
    }
  };

  return (
    <div className="log-viewer-main">
      <div className="log-viewer-header">
        <div className="header-main">
          <h2>Monitor de Actividad 📊</h2>
          {jobId && <div className="job-id-display">Job: {jobId}</div>}
        </div>
        
        {lastRefreshTime && (
          <div className="last-refresh">
            Última actualización: {lastRefreshTime.toLocaleTimeString()}
          </div>
        )}
      </div>
      
      <div className="log-viewer-toolbar">
        <div className="log-controls-primary">
          <button className={`logs-button ${paused ? 'resume' : 'pause'}`} onClick={togglePause}>
            {paused ? '▶️ Reanudar' : '⏸️ Pausar'}
          </button>
          <button className="logs-button refresh" onClick={() => fetchLogs()}>
            🔄 Actualizar
          </button>
          <button className="logs-button clear" onClick={clearLogs}>
            🗑️ Limpiar
          </button>
          <button className="logs-button export" onClick={exportLogs}>
            📤 Exportar
          </button>
        </div>
        
        <div className="log-controls-filters">
          <div className="filter-group">
            <input 
              type="text" 
              placeholder="Buscar en logs..." 
              value={filterText} 
              onChange={handleFilterChange}
              className="search-input"
            />
          </div>
          
          <div className="filter-group">
            <select 
              value={filterType} 
              onChange={handleTypeFilterChange}
              className="type-filter"
            >
              <option value="all">Todos los tipos</option>
              <option value="error">Errores</option>
              <option value="success">Éxitos</option>
              <option value="info">Información</option>
              <option value="action">Acciones</option>
              <optgroup label="Etapas específicas">
                <option value="INICIO">Inicio</option>
                <option value="INFO_KINGUIN">Info Kinguin</option>
                <option value="PRECIO">Precio</option>
                <option value="NUEVO">Nuevo</option>
                <option value="ACTUALIZAR">Actualizar</option>
                <option value="CREADO">Creado</option>
                <option value="APROBADO">Aprobado</option>
                <option value="RECHAZADO">Rechazado</option>
                <option value="ERROR">Error</option>
              </optgroup>
            </select>
          </div>
          
          <div className="display-options">
            <label className="option-label">
              <input 
                type="checkbox" 
                checked={autoScrollEnabled}
                onChange={() => setAutoScrollEnabled(!autoScrollEnabled)} 
              />
              Auto-scroll
            </label>
            
            <label className="option-label">
              <input 
                type="checkbox" 
                checked={showTimestampFull}
                onChange={() => setShowTimestampFull(!showTimestampFull)} 
              />
              Fecha completa
            </label>
          </div>
        </div>
      </div>
      
      {/* Panel de estadísticas */}
      <div className="stats-panel">
        <div className="stat-item">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total</div>
        </div>
        <div className="stat-item success">
          <div className="stat-value">{stats.successes}</div>
          <div className="stat-label">Éxitos</div>
        </div>
        <div className="stat-item warning">
          <div className="stat-value">{stats.warnings}</div>
          <div className="stat-label">Advertencias</div>
        </div>
        <div className="stat-item error">
          <div className="stat-value">{stats.errors}</div>
          <div className="stat-label">Errores</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{stats.products}</div>
          <div className="stat-label">Productos</div>
        </div>
        <div className="stat-item filtered">
          <div className="stat-value">{stats.filtered}</div>
          <div className="stat-label">Filtrados</div>
        </div>
      </div>
      
      {/* Mensajes de estado */}
      {error && <div className="logs-error">{error}</div>}
      {loading && <div className="logs-loading">
        <div className="loading-spinner"></div>
        <span>Cargando logs...</span>
      </div>}
      
      <div className="logs-view-container">
        {/* Panel lateral con productos activos */}
        {activeProducts.length > 0 && (
          <div className="active-products-panel">
            <h3>Productos ({activeProducts.length})</h3>
            <div className="products-list">
              {activeProducts.map((product, index) => (
                <div 
                  key={product.kinguinId || product.mlId || index} 
                  className={`product-item ${product.lastStatus?.toLowerCase()} ${product.mlId ? 'has-ml' : ''}`}
                >
                  <div className="product-title" title={product.title}>
                    {product.title || "Producto sin título"}
                  </div>
                  <div className="product-ids">
                    {product.kinguinId && <span className="id-badge kinguin">KID: {product.kinguinId}</span>}
                    {product.mlId && <span className="id-badge ml">ML: {product.mlId}</span>}
                  </div>
                  <div className="product-details">
                    {product.price && (
                      <span className="product-price">{product.price.toLocaleString()} CLP</span>
                    )}
                    {product.eurPrice && (
                      <span className="product-price-eur">{product.eurPrice} EUR</span>
                    )}
                  </div>
                  <div className="product-status-container">
                    {product.lastStatus && (
                      <div className={`product-status status-${product.lastStatus.toLowerCase()}`}>
                        {product.lastStatus}
                      </div>
                    )}
                    {product.mlId && (
                      <div 
                        className={`product-ml-indicator ${product.mlStatus ? `ml-status-${product.mlStatus.toLowerCase().replace(/\s+/g, '-')}` : ''}`}
                        title={`ID de MercadoLibre: ${product.mlId}${product.mlStatus ? ` (${product.mlStatus})` : ''}`}
                      >
                        ML {product.mlStatus && <span className="ml-status">{product.mlStatus}</span>} <span className="ml-dot"></span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Panel principal de logs */}
        <div 
          className="logs-container" 
          ref={containerRef} 
          onScroll={handleScroll}
        >
          {filteredLogs.length === 0 ? (
            <div className="log-empty">
              {logs.length === 0 ? 
                "No hay logs disponibles" : 
                "No hay resultados para los filtros aplicados"}
            </div>
          ) : (
            filteredLogs.map((log, index) => {
              const logTypeInfo = getLogTypeInfo(log.message);
              const details = extractDetails(log);
              const isExpanded = expandedDetails[log.id || index];
              
              return (
                <div 
                  key={log.id || index} 
                  className={`log-entry ${logTypeInfo.cssClass}`}
                  onClick={() => toggleDetails(log.id || index)}
                >
                  <div className="log-entry-header">
                    <span className="log-timestamp" title={new Date(log.timestamp).toLocaleString()}>
                      {formatTimestamp(log.timestamp)}
                    </span>
                    
                    <span className="log-type-indicator" title={logTypeInfo.title}>
                      {logTypeInfo.emoji}
                    </span>
                    
                    <span 
                      className={`log-content ${details ? 'has-details' : ''}`}
                      dangerouslySetInnerHTML={{ __html: formatLogMessage(log.message) }}
                    />
                    
                    {details && (
                      <span className="log-details-toggle">
                        {isExpanded ? '▼' : '►'}
                      </span>
                    )}
                  </div>
                  
                  {details && isExpanded && (
                    <div className="log-details">
                      <pre>{JSON.stringify(details, null, 2)}</pre>
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
      
      {/* Botón flotante para volver al final */}
      {userScrolled && (
        <button 
          className="scroll-to-bottom" 
          onClick={() => {
            setUserScrolled(false);
            logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          ↓ Ir al final
        </button>
      )}

      <style jsx global>{`
        /* Base styles */
        .log-viewer-main {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          color: #e0e0e0;
          width: 100%;
          margin-bottom: 30px;
        }
        
        .log-viewer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 15px;
        }
        
        .header-main {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .log-viewer-header h2 {
          font-size: 24px;
          margin: 0;
          color: #ffffff;
          font-weight: 600;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }
        
        .job-id-display {
          color: #ffffff;
          background-color: rgba(255, 255, 255, 0.1);
          padding: 5px 10px;
          border-radius: 4px;
          font-size: 0.9em;
          border: 1px solid rgba(255, 255, 255, 0.2);
          font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        }
        
        .last-refresh {
          color: #888;
          font-size: 0.9em;
        }
        
        /* Toolbar */
        .log-viewer-toolbar {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 15px;
          width: 100%;
        }
        
        .log-controls-primary {
          display: flex;
          gap: 8px;
        }
        
        .log-controls-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
        }
        
        .filter-group {
          flex-grow: 1;
          min-width: 180px;
        }
        
        .search-input {
          width: 100%;
          padding: 8px 12px;
          background-color: #1e1e1e;
          border: 1px solid #444;
          border-radius: 4px;
          color: #e0e0e0;
          font-size: 14px;
        }
        
        .search-input:focus {
          outline: none;
          border-color: #6366F1;
          box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
        }
        
        .type-filter {
          width: 100%;
          padding: 8px 12px;
          background-color: #1e1e1e;
          border: 1px solid #444;
          border-radius: 4px;
          color: #e0e0e0;
          font-size: 14px;
          appearance: none;
          background-image: url("data:image/svg+xml;utf8,<svg fill='white' height='24' viewBox='0 0 24 24' width='24' xmlns='http://www.w3.org/2000/svg'><path d='M7 10l5 5 5-5z'/><path d='M0 0h24v24H0z' fill='none'/></svg>");
          background-repeat: no-repeat;
          background-position: right 8px center;
        }
        
        .type-filter:focus {
          outline: none;
          border-color: #6366F1;
        }
        
        .display-options {
          display: flex;
          gap: 15px;
          flex-wrap: wrap;
          align-items: center;
        }
        
        .option-label {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 0.9em;
          color: #ccc;
          cursor: pointer;
        }
        
        .option-label input {
          margin: 0;
        }
        
        /* Stats Panel */
        .stats-panel {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 15px;
        }
        
        .stat-item {
          background-color: #1e1e1e;
          border: 1px solid #333;
          border-radius: 4px;
          padding: 8px 12px;
          min-width: 80px;
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        
        .stat-value {
          font-size: 20px;
          font-weight: bold;
        }
        
        .stat-label {
          font-size: 12px;
          color: #999;
          margin-top: 2px;
        }
        
        .stat-item.success .stat-value {
          color: #4ADE80;
        }
        
        .stat-item.warning .stat-value {
          color: #FACC15;
        }
        
        .stat-item.error .stat-value {
          color: #F87171;
        }
        
        .stat-item.filtered .stat-value {
          color: #8B5CF6;
        }
        
        /* Logs View */
        .logs-view-container {
          display: flex;
          gap: 15px;
          height: 600px;
        }
        
        .active-products-panel {
          width: 280px;
          flex-shrink: 0;
          background-color: #0d0d0d;
          border-radius: 6px;
          border: 1px solid #333;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        
        .active-products-panel h3 {
          margin: 0;
          padding: 12px 15px;
          background-color: #151515;
          font-size: 16px;
          font-weight: 500;
          border-bottom: 1px solid #333;
          color: #ddd;
        }
        
        .products-list {
          overflow-y: auto;
          padding: 10px;
          flex-grow: 1;
        }
        
        .product-item {
          background-color: #1a1a1a;
          border-radius: 4px;
          padding: 10px;
          margin-bottom: 10px;
          transition: background-color 0.2s;
        }
        
        .product-item:hover {
          background-color: #222;
        }
        
        .product-item.has-ml {
          border-left: 3px solid #FCD34D;
          position: relative;
          overflow: hidden;
        }
        
        .product-item.has-ml:before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 3px;
          height: 100%;
          background-color: #FCD34D;
          box-shadow: 0 0 10px 2px rgba(252, 211, 77, 0.5);
        }
        
        .product-title {
          font-weight: 500;
          margin-bottom: 5px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .product-ids {
          display: flex;
          gap: 8px;
          font-size: 0.8em;
          margin-bottom: 5px;
        }
        
        .id-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 6px;
          border-radius: 3px;
          font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        }
        
        .id-badge.kinguin {
          background-color: rgba(139, 92, 246, 0.2);
          color: #C4B5FD;
          border: 1px solid rgba(139, 92, 246, 0.3);
        }
        
        .id-badge.ml {
          background-color: rgba(250, 204, 21, 0.2);
          color: #FDE68A;
          border: 1px solid rgba(250, 204, 21, 0.3);
        }
        
        .product-details {
          display: flex;
          gap: 12px;
          margin-bottom: 5px;
          flex-wrap: wrap;
        }
        
        .product-price {
          color: #22D3EE;
          font-weight: 600;
          font-size: 0.9em;
        }
        
        .product-price-eur {
          color: #F472B6;
          font-size: 0.9em;
        }
        
        .product-status-container {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        
        .product-status {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 0.8em;
          font-weight: 500;
        }
        
        .product-ml-indicator {
          display: flex;
          align-items: center;
          background-color: rgba(252, 211, 77, 0.15);
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.85em;
          font-weight: 500;
          color: #FCD34D;
          border: 1px solid rgba(252, 211, 77, 0.3);
        }
        
        .ml-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background-color: #FCD34D;
          box-shadow: 0 0 5px #FCD34D;
          margin-left: 6px;
          animation: pulse-ml 2s infinite;
        }
        
        .ml-status {
          font-size: 0.8em;
          font-weight: 600;
          margin-left: 3px;
          margin-right: 3px;
        }
        
        .product-ml-indicator.ml-status-active {
          background-color: rgba(16, 185, 129, 0.15);
          color: #34D399;
          border-color: rgba(16, 185, 129, 0.3);
        }
        
        .product-ml-indicator.ml-status-paused {
          background-color: rgba(245, 158, 11, 0.15);
          color: #FBBF24;
          border-color: rgba(245, 158, 11, 0.3);
        }
        
        .product-ml-indicator.ml-status-closed, 
        .product-ml-indicator.ml-status-under-review {
          background-color: rgba(239, 68, 68, 0.15);
          color: #F87171;
          border-color: rgba(239, 68, 68, 0.3);
        }
        
        @keyframes pulse-ml {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }
        
        .status-aprobado {
          background-color: rgba(74, 222, 128, 0.2);
          color: #4ADE80;
        }
        
        .status-rechazado, .status-error {
          background-color: rgba(248, 113, 113, 0.2);
          color: #F87171;
        }
        
        .status-pendiente {
          background-color: rgba(250, 204, 21, 0.2);
          color: #FACC15;
        }
        
        .status-creado {
          background-color: rgba(139, 92, 246, 0.2);
          color: #8B5CF6;
        }
        
        /* Log Container */
        .logs-container {
          background-color: #0a0a0a;
          color: #e0e0e0;
          font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
          padding: 15px;
          border-radius: 6px;
          border: 1px solid #333;
          overflow-y: auto;
          flex-grow: 1;
          font-size: 14px;
          position: relative;
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
        }
        
        .log-entry {
          padding: 6px 8px;
          border-radius: 4px;
          margin-bottom: 4px;
          cursor: pointer;
          transition: background-color 0.15s;
        }
        
        .log-entry:hover {
          background-color: rgba(255, 255, 255, 0.05);
        }
        
        .log-entry-header {
          display: flex;
          align-items: flex-start;
          gap: 8px;
        }
        
        .log-timestamp {
          color: #888;
          flex-shrink: 0;
          font-size: 0.85em;
          padding-top: 2px;
        }
        
        .log-type-indicator {
          flex-shrink: 0;
          font-size: 1em;
        }
        
        .log-content {
          flex-grow: 1;
          word-wrap: break-word;
        }
        
        .log-content.has-details {
          text-decoration: underline dotted rgba(255, 255, 255, 0.3);
          text-underline-offset: 4px;
        }
        
        .log-details-toggle {
          color: #888;
          margin-left: 5px;
          font-size: 0.8em;
          flex-shrink: 0;
        }
        
        .log-details {
          margin-top: 8px;
          margin-left: 24px;
          padding: 10px;
          background-color: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          font-size: 0.9em;
          border-left: 3px solid rgba(255, 255, 255, 0.1);
        }
        
        .log-details pre {
          margin: 0;
          white-space: pre-wrap;
        }
        
        /* Specialized elements in logs */
        .log-tag {
          color: #888;
          font-weight: 500;
        }
        
        .log-id {
          color: #8B5CF6;
          font-weight: 500;
        }
        
        .log-number {
          color: #FACC15;
          font-weight: 500;
        }
        
        .log-price {
          color: #22D3EE;
          font-weight: 700;
          font-size: 1.05em;
        }
        
        .log-currency {
          color: #67E8F9;
          font-weight: 500;
        }
        
        .log-exchange-rate {
          color: #F472B6;
          font-weight: 700;
          font-size: 1.05em;
        }
        
        .log-success-action {
          color: #4ADE80;
          font-weight: 700;
          text-decoration: underline;
          text-decoration-thickness: 2px;
          text-underline-offset: 2px;
        }
        
        .log-error-action {
          color: #FB7185;
          font-weight: 700;
          text-decoration: underline;
          text-decoration-style: wavy;
          text-underline-offset: 2px;
        }
        
        .log-error-detail {
          color: #F87171;
        }
        
        .log-product-title {
          color: #A5B4FC;
          font-style: italic;
        }
        
        /* Errores específicos de MercadoLibre */
        .ml-error-category {
          display: inline-block;
          padding: 2px 6px;
          margin: 2px 0;
          border-radius: 4px;
          background-color: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.3);
          color: #F87171;
          font-weight: 500;
          font-size: 0.9em;
        }
        
        .ml-error-recovery {
          display: inline-block;
          padding: 2px 6px;
          margin: 2px 0;
          border-radius: 4px;
          background-color: rgba(139, 92, 246, 0.1);
          border: 1px solid rgba(139, 92, 246, 0.3);
          color: #C4B5FD;
          font-weight: 500;
          font-size: 0.9em;
        }
        
        /* Estados de MercadoLibre en los logs */
        .log-ml-status-active {
          color: #34D399;
          font-weight: 600;
        }
        
        .log-ml-status-paused {
          color: #FBBF24;
          font-weight: 600;
        }
        
        .log-ml-status-closed,
        .log-ml-status-under-review {
          color: #F87171;
          font-weight: 600;
        }
        
        /* Información de stock en los logs */
        .log-stock {
          color: #60A5FA;
          font-weight: 600;
        }
        
        .log-stock-error {
          color: #F87171;
          font-weight: 600;
          text-decoration: underline;
          text-decoration-style: wavy;
          text-underline-offset: 2px;
        }
        
        .log-stock-available {
          color: #34D399;
          font-weight: 600;
        }
        
        .log-json {
          color: #D8B4FE;
          font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
          font-size: 0.9em;
        }
        
        /* Estilos para información de stock */
        .log-stock {
          color: #22D3EE;
          font-weight: 700;
        }
        
        .log-stock-error {
          color: #FB7185;
          font-weight: 600;
          text-decoration: underline;
          text-decoration-style: wavy;
          text-decoration-color: rgba(251, 113, 133, 0.5);
        }
        
        .log-stock-available {
          color: #4ADE80;
          font-weight: 600;
        }
        
        .log-json {
          color: #A78BFA;
          font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
          font-size: 0.9em;
        }
        
        /* Colores para diferentes tipos de log */
        .log-info {
          color: #8CD1FF; /* Azul claro más brillante */
        }
        
        .log-success {
          color: #A0FF9C; /* Verde claro más brillante */
        }
        
        .log-warning, .stage-warning, .stage-skip {
          color: #FFEA7F; /* Amarillo más brillante */
        }
        
        .log-error {
          color: #FF9B9B; /* Rojo claro más brillante */
        }
        
        /* Colores para diferentes etapas del proceso */
        .stage-inicio {
          color: #A5B4FF; /* Azul indigo claro más brillante */
        }
        
        .stage-info_kinguin {
          color: #80FFFF; /* Azul cyan claro más brillante */
        }
        
        .stage-precio, .stage-fx {
          color: #C2A8FF; /* Morado claro más brillante */
        }
        
        .stage-nuevo, .stage-actualizar {
          color: #FFCF8C; /* Naranja claro más brillante */
        }
        
        .stage-creado, .stage-aprobado {
          color: #C1FF99; /* Verde lima claro más brillante */
        }
        
        .stage-descripcion {
          color: #7FFFED; /* Verde teal claro más brillante */
        }
        
        .stage-error, .stage-rechazado {
          color: #FF93C9; /* Rosa claro más brillante */
        }
        
        .stage-ml {
          color: #FCD34D; /* Amarillo dorado */
        }
        
        .stage-stock {
          color: #34D399; /* Verde esmeralda */
        }
        
        .stage-sync {
          color: #60A5FA; /* Azul cielo */
        }
        
        .stage-oferta {
          color: #F472B6; /* Rosa */
        }
        
        /* Botones de control */
        .logs-button {
          background-color: #222;
          border: 1px solid #444;
          color: #e0e0e0;
          padding: 8px 15px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;
          transition: all 0.2s;
          font-size: 14px;
          font-weight: 500;
        }
        
        .logs-button:hover {
          background-color: #333;
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        
        .logs-button:active {
          transform: translateY(0);
          box-shadow: none;
        }
        
        .logs-button.pause {
          border-color: #9333EA;
        }
        
        .logs-button.resume {
          border-color: #10B981;
        }
        
        .logs-button.clear {
          border-color: #F43F5E;
        }
        
        .logs-button.refresh {
          border-color: #3B82F6;
        }
        
        .logs-button.export {
          border-color: #F59E0B;
        }
        
        /* Estados */
        .logs-error {
          padding: 12px;
          background-color: #310413;
          color: #ff8080;
          margin-bottom: 15px;
          border-radius: 6px;
          border-left: 4px solid #F43F5E;
          font-size: 14px;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
        }
        
        .logs-loading {
          padding: 12px;
          color: #aaa;
          margin-bottom: 15px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .loading-spinner {
          width: 20px;
          height: 20px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          border-top-color: #8B5CF6;
          animation: spinner 0.8s linear infinite;
        }
        
        @keyframes spinner {
          to {
            transform: rotate(360deg);
          }
        }
        
        .log-empty {
          color: #888;
          font-style: italic;
          padding: 40px 20px;
          text-align: center;
          background-color: rgba(0, 0, 0, 0.2);
          border-radius: 6px;
        }
        
        /* Botón flotante para ir al final */
        .scroll-to-bottom {
          position: absolute;
          bottom: 20px;
          right: 20px;
          background-color: rgba(99, 102, 241, 0.8);
          color: white;
          border: none;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          font-size: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
          transition: all 0.2s;
          z-index: 10;
        }
        
        .scroll-to-bottom:hover {
          background-color: rgba(99, 102, 241, 1);
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        }
        
        /* Responsive adjustments */
        @media (max-width: 992px) {
          .logs-view-container {
            flex-direction: column;
            height: auto;
          }
          
          .active-products-panel {
            width: 100%;
            height: 220px;
          }
          
          .logs-container {
            height: 400px;
          }
        }
        
        @media (max-width: 768px) {
          .log-controls-primary {
            flex-wrap: wrap;
          }
          
          .log-viewer-toolbar {
            gap: 15px;
          }
          
          .stat-item {
            min-width: 70px;
          }
          
          .logs-container {
            font-size: 13px;
          }
        }
      `}</style>
    </div>
  );
}