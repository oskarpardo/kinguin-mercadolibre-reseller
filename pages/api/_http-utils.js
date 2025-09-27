// Utilidades para manejo HTTP optimizado

import axios from "axios";

/**
 * Función mejorada para hacer solicitudes HTTP con reintentos inteligentes.
 * Maneja específicamente errores 429 (too_many_requests) y otros errores comunes.
 * 
 * @param {object|string} config - Configuración de Axios o URL directa
 * @param {object|null} data - Datos a enviar (para métodos POST/PUT)
 * @param {object|null} options - Opciones adicionales
 * @param {number} options.retries - Número máximo de reintentos (default: 5)
 * @param {number} options.baseDelay - Retraso base en ms (default: 500)
 * @param {number} options.maxDelay - Retraso máximo en ms (default: 15000)
 * @param {function} options.onRetry - Callback al reintentar
 * @param {object} options.headers - Cabeceras HTTP a incluir
 * @returns {Promise<object>} - Respuesta de Axios
 */
export async function axiosWithSmartRetry(config, data = null, options = {}) {
  const {
    retries = 5,
    baseDelay = 500,
    maxDelay = 15000,
    onRetry = null,
    headers = {},
    ...axiosOptions
  } = options;

  // Normalizar configuración
  let axiosConfig = typeof config === 'string' ? { url: config } : { ...config };
  
  // Preparar datos si existen
  if (data) {
    axiosConfig.data = data;
    axiosConfig.method = axiosConfig.method || 'post';
  }
  
  // Agregar headers
  axiosConfig.headers = { ...axiosConfig.headers, ...headers };
  
  // Aplicar opciones adicionales de Axios
  Object.assign(axiosConfig, axiosOptions);

  let lastError = null;
  let attemptCount = 0;

  while (attemptCount < retries) {
    try {
      attemptCount++;
      return await axios(axiosConfig);
    } catch (error) {
      lastError = error;
      
      // No reintentar si es error de autenticación o método no permitido
      if (error.response && [401, 403, 405].includes(error.response.status)) {
        throw error;
      }
      
      // Verificar si es 429 (too_many_requests) u otro error recuperable
      const isRateLimitError = error.response && error.response.status === 429;
      const isServerError = error.response && error.response.status >= 500;
      const isNetworkError = error.code === 'ECONNRESET' || 
                            error.code === 'ETIMEDOUT' ||
                            error.code === 'ECONNABORTED' ||
                            error.message.includes('timeout');
      
      // Si no es un error recuperable y no estamos en el último intento, lanzar error
      if (!isRateLimitError && !isServerError && !isNetworkError) {
        throw error;
      }
      
      // Si es el último intento, lanzar el error
      if (attemptCount >= retries) {
        throw error;
      }
      
      // Calcular retraso con retroceso exponencial y jitter
      let delay = Math.min(
        baseDelay * Math.pow(2, attemptCount - 1) * (0.8 + Math.random() * 0.4), 
        maxDelay
      );
      
      // Para errores 429, usar el header Retry-After si está disponible
      if (isRateLimitError && error.response.headers['retry-after']) {
        const retryAfter = parseInt(error.response.headers['retry-after'], 10);
        if (!isNaN(retryAfter)) {
          delay = retryAfter * 1000;
        } else if (error.response.headers['retry-after'].includes(':')) {
          // Si es una fecha, calcular la diferencia
          const retryDate = new Date(error.response.headers['retry-after']);
          if (!isNaN(retryDate.getTime())) {
            delay = Math.max(0, retryDate.getTime() - Date.now());
          }
        }
      }
      
      // Callback para notificar el reintento
      if (onRetry && typeof onRetry === 'function') {
        onRetry({
          attempt: attemptCount,
          maxAttempts: retries,
          delay,
          error,
          isRateLimitError,
          isServerError,
          isNetworkError
        });
      } else {
        // Log por defecto
        console.warn(
          `⚠️ Reintento #${attemptCount}/${retries} en ${Math.round(delay)}ms - ${
            isRateLimitError 
              ? 'Error 429 (too many requests)' 
              : isServerError 
                ? `Error ${error.response?.status || 'del servidor'}` 
                : 'Error de red'
          }: ${error.message}`
        );
      }
      
      // Esperar antes de reintentar
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // Este punto no debería alcanzarse, pero por seguridad lanzamos el último error
  throw lastError;
}

/**
 * Ejecuta múltiples solicitudes HTTP en paralelo pero con límite de concurrencia.
 * Ideal para manejar grandes cantidades de solicitudes sin sobrecargar APIs.
 *
 * @param {Array<function>} requestFunctions - Funciones que devuelven promesas
 * @param {object} options - Opciones de configuración
 * @param {number} options.concurrency - Número máximo de solicitudes concurrentes (default: 5)
 * @param {number} options.intervalMs - Intervalo mínimo entre solicitudes en ms (default: 200)
 * @param {function} options.onProgress - Callback de progreso (recibe índice y resultado)
 * @returns {Promise<Array>} - Resultados en el mismo orden que las funciones de entrada
 */
export async function batchRequests(requestFunctions, options = {}) {
  const {
    concurrency = 5,
    intervalMs = 200,
    onProgress = null
  } = options;

  const results = new Array(requestFunctions.length);
  let completedCount = 0;
  let nextIndex = 0;
  let lastRequestTime = 0;

  // Función para procesar una solicitud
  async function processRequest() {
    // Verificar si hay más solicitudes por procesar
    if (nextIndex >= requestFunctions.length) {
      return;
    }
    
    const currentIndex = nextIndex++;
    const requestFn = requestFunctions[currentIndex];
    
    // Controlar el intervalo entre solicitudes
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < intervalMs) {
      await new Promise(resolve => setTimeout(resolve, intervalMs - timeSinceLastRequest));
    }
    
    try {
      lastRequestTime = Date.now();
      const result = await requestFn();
      results[currentIndex] = { success: true, data: result };
      
      if (onProgress) {
        onProgress(currentIndex, { success: true, data: result, completed: ++completedCount, total: requestFunctions.length });
      }
    } catch (error) {
      results[currentIndex] = { success: false, error };
      
      if (onProgress) {
        onProgress(currentIndex, { success: false, error, completed: ++completedCount, total: requestFunctions.length });
      }
    }
    
    // Procesar la siguiente solicitud
    return processRequest();
  }
  
  // Iniciar solicitudes concurrentes
  const workers = Array.from({ length: Math.min(concurrency, requestFunctions.length) }, 
    () => processRequest());
  
  // Esperar a que todas las solicitudes se completen
  await Promise.all(workers);
  
  return results;
}

/**
 * Realiza múltiples solicitudes HTTP en paralelo pero con límite de concurrencia.
 * Versión simplificada de batchRequests que toma un array de configuraciones de Axios.
 *
 * @param {Array<object|string>} requests - Array de configuraciones de Axios o URLs
 * @param {object} options - Opciones (ver batchRequests)
 * @returns {Promise<Array>} - Resultados en el mismo orden que las solicitudes
 */
export async function batchAxiosRequests(requests, options = {}) {
  const requestFunctions = requests.map(req => {
    return () => axiosWithSmartRetry(req, null, {
      onRetry: options.logRetries ? undefined : () => {} // Silenciar logs de reintento por defecto
    });
  });
  
  return batchRequests(requestFunctions, options);
}

/**
 * Verifica si un error de Axios es debido a límite de tasa (429)
 */
export function isRateLimitError(error) {
  return error && error.response && error.response.status === 429;
}

/**
 * Implementación de backoff exponencial para reintentos
 */
export function calculateBackoffDelay(attempt, baseDelay = 500, maxDelay = 15000, jitter = true) {
  let delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  
  // Añadir jitter para evitar efecto thundering herd
  if (jitter) {
    delay = delay * (0.8 + Math.random() * 0.4);
  }
  
  return Math.floor(delay);
}

/**
 * Parsea y devuelve el valor del header Retry-After
 */
export function parseRetryAfterHeader(headers) {
  if (!headers || !headers['retry-after']) {
    return null;
  }
  
  const retryAfter = headers['retry-after'];
  
  // Si es un número, son segundos
  if (!isNaN(parseInt(retryAfter, 10))) {
    return parseInt(retryAfter, 10) * 1000;
  }
  
  // Si es una fecha, calcular diferencia
  try {
    const retryDate = new Date(retryAfter);
    if (!isNaN(retryDate.getTime())) {
      return Math.max(0, retryDate.getTime() - Date.now());
    }
  } catch (e) {}
  
  return null;
}