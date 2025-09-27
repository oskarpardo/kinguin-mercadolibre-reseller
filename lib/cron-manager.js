// Configuración de cronjobs para la sincronización automática de productos
import { createClient } from '@supabase/supabase-js';

// Importaciones condicionales para compatibilidad con Vercel
let cron;
let nodeFetch;

// Configuración de variables de entorno
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

// Inicializar cliente de Supabase
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Cargar módulos solo en entorno servidor y no durante la compilación
if (typeof window === 'undefined') {
  try {
    // Importación dinámica para evitar errores durante la compilación
    import('node-cron').then(module => {
      cron = module.default;
    }).catch(err => {
      console.warn('No se pudo cargar node-cron:', err.message);
    });
    
    import('node-fetch').then(module => {
      nodeFetch = module.default;
    }).catch(err => {
      console.warn('No se pudo cargar node-fetch:', err.message);
    });
  } catch (error) {
    console.warn('Error al importar módulos de servidor:', error);
  }
}

// Función para registrar actividad en la base de datos
async function logActivity(message, type = 'info', jobId = null) {
  try {
    await supabase.from('activity_logs').insert({
      message,
      type,
      job_id: jobId,
      source: 'cronjob'
    });
  } catch (error) {
    console.error('Error al registrar actividad:', error);
  }
}

// Función para actualizar productos con stock
async function updateProductsWithStock() {
  try {
    console.log('Iniciando actualización de productos con stock...');
    await logActivity('Iniciando actualización automática de productos con stock', 'info');
    
    // Usar fetch del navegador o node-fetch según el entorno
    const fetchFunc = typeof window !== 'undefined' ? fetch : nodeFetch;
    const response = await fetchFunc(`${API_BASE_URL}/api/sync-prices-stock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        updateOnlyWithStock: true,
        updateMl: true,
        limit: 100,
        source: 'cronjob'
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Error ${response.status}: ${errorData}`);
    }
    
    const data = await response.json();
    
    if (data.success) {
      console.log(`Actualización de productos con stock iniciada. Job ID: ${data.jobId}`);
      await logActivity(`Actualización automática de productos con stock iniciada. Job ID: ${data.jobId}`, 'success', data.jobId);
      return data.jobId;
    } else {
      throw new Error(data.error || 'Error desconocido');
    }
  } catch (error) {
    console.error('Error al actualizar productos con stock:', error);
    await logActivity(`Error en actualización automática de productos con stock: ${error.message}`, 'error');
    return null;
  }
}

// Función para actualizar todos los productos
async function updateAllProducts() {
  try {
    console.log('Iniciando actualización de todos los productos...');
    await logActivity('Iniciando actualización automática de todos los productos', 'info');
    
    // Usar fetch del navegador o node-fetch según el entorno
    const fetchFunc = typeof window !== 'undefined' ? fetch : nodeFetch;
    const response = await fetchFunc(`${API_BASE_URL}/api/sync-prices-stock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        updateOnlyWithStock: false,
        updateMl: true,
        limit: 200,
        source: 'cronjob'
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Error ${response.status}: ${errorData}`);
    }
    
    const data = await response.json();
    
    if (data.success) {
      console.log(`Actualización de todos los productos iniciada. Job ID: ${data.jobId}`);
      await logActivity(`Actualización automática de todos los productos iniciada. Job ID: ${data.jobId}`, 'success', data.jobId);
      return data.jobId;
    } else {
      throw new Error(data.error || 'Error desconocido');
    }
  } catch (error) {
    console.error('Error al actualizar todos los productos:', error);
    await logActivity(`Error en actualización automática de todos los productos: ${error.message}`, 'error');
    return null;
  }
}

// Función para actualizar tipos de cambio
async function updateExchangeRate() {
  try {
    console.log('Actualizando tipo de cambio...');
    await logActivity('Iniciando actualización automática del tipo de cambio', 'info');
    
    // Usar fetch del navegador o node-fetch según el entorno
    const fetchFunc = typeof window !== 'undefined' ? fetch : nodeFetch;
    const response = await fetchFunc(`${API_BASE_URL}/api/exchange-rate`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Error ${response.status}: ${errorData}`);
    }
    
    const data = await response.json();
    
    if (data.success) {
      console.log(`Tipo de cambio actualizado: ${data.rate} CLP/EUR`);
      await logActivity(`Tipo de cambio actualizado automáticamente: ${data.rate} CLP/EUR`, 'success');
      return data.rate;
    } else {
      throw new Error(data.error || 'Error desconocido');
    }
  } catch (error) {
    console.error('Error al actualizar tipo de cambio:', error);
    await logActivity(`Error en actualización automática del tipo de cambio: ${error.message}`, 'error');
    return null;
  }
}

// Función para leer la configuración de los cronjobs
async function getScheduleConfig() {
  try {
    const { data, error } = await supabase
      .from('cron_config')
      .select('*')
      .eq('active', true)
      .single();
      
    if (error) throw error;
    
    return data || {
      update_stock_schedule: '0 */12 * * *',  // Por defecto cada 12 horas
      update_all_schedule: '0 3 * * *',       // Por defecto a las 3 AM
      exchange_rate_schedule: '0 */6 * * *',  // Por defecto cada 6 horas
      active: true
    };
  } catch (error) {
    console.error('Error al obtener configuración de cronjobs:', error);
    
    // Devolver configuración por defecto
    return {
      update_stock_schedule: '0 */12 * * *',  // Por defecto cada 12 horas
      update_all_schedule: '0 3 * * *',       // Por defecto a las 3 AM
      exchange_rate_schedule: '0 */6 * * *',  // Por defecto cada 6 horas
      active: true
    };
  }
}

// Función para iniciar los cronjobs
async function startCronJobs() {
  try {
    // Verificar que estamos en el servidor y que cron está disponible
    if (typeof window !== 'undefined' || !cron) {
      console.warn('startCronJobs: solo disponible en entorno servidor con node-cron instalado');
      return;
    }
    
    // Obtener configuración
    const config = await getScheduleConfig();
    
    if (!config.active) {
      console.log('Cronjobs desactivados según configuración');
      return;
    }
    
    // Cronjob para actualizar productos con stock
    cron.schedule(config.update_stock_schedule, async () => {
      console.log(`[${new Date().toISOString()}] Ejecutando actualización programada de productos con stock`);
      await updateProductsWithStock();
    });
    
    // Cronjob para actualizar todos los productos
    cron.schedule(config.update_all_schedule, async () => {
      console.log(`[${new Date().toISOString()}] Ejecutando actualización programada de todos los productos`);
      await updateAllProducts();
    });
    
    // Cronjob para actualizar tipo de cambio
    cron.schedule(config.exchange_rate_schedule, async () => {
      console.log(`[${new Date().toISOString()}] Ejecutando actualización programada del tipo de cambio`);
      await updateExchangeRate();
    });
    
    console.log('Cronjobs iniciados con éxito');
    await logActivity('Sistema de cronjobs iniciado con éxito', 'success');
  } catch (error) {
    console.error('Error al iniciar cronjobs:', error);
    await logActivity(`Error al iniciar sistema de cronjobs: ${error.message}`, 'error');
  }
}

// Exportar funciones para usar en otros archivos
export {
  startCronJobs,
  updateProductsWithStock,
  updateAllProducts,
  updateExchangeRate,
  getScheduleConfig
};

// En entorno servidor, podemos verificar si el archivo se ejecuta directamente
// pero en el navegador/compilación esto causaría problemas
if (typeof window === 'undefined') {
  // Verificación segura para Node.js
  try {
    const isMainModule = require.main === module;
    if (isMainModule) {
      startCronJobs()
        .then(() => console.log('Sistema de cronjobs iniciado'))
        .catch(err => console.error('Error al iniciar el sistema de cronjobs:', err));
    }
  } catch (error) {
    // No hacer nada si estamos en un entorno que no soporta require.main
  }
}