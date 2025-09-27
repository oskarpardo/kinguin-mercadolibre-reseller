import cron from 'node-cron';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Configuración
const CONFIG = {
  // Actualizar todos los productos con stock cada 12 horas
  UPDATE_WITH_STOCK: {
    cronPattern: '0 */12 * * *',  // Cada 12 horas
    endpoint: '/api/sync-prices-stock',
    params: {
      updatePrices: true,
      updateStock: true,
      onlyWithStock: true,
      maxProducts: 5000 // Limitar a 5000 productos por ejecución
    }
  },
  
  // Actualizar todos los productos (incluso sin stock) una vez al día
  UPDATE_ALL_PRODUCTS: {
    cronPattern: '0 3 * * *',     // A las 3 AM todos los días
    endpoint: '/api/sync-prices-stock',
    params: {
      updatePrices: true,
      updateStock: true,
      onlyWithStock: false,
      maxProducts: 10000 // Limitar a 10K productos por ejecución
    }
  }
};

// URL base para API
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

/**
 * Función para ejecutar un trabajo de actualización
 */
async function runSyncJob(jobConfig) {
  try {
    console.log(`[${new Date().toISOString()}] Iniciando trabajo programado: ${jobConfig.endpoint}`);
    
    // Registrar en logs
    const { error: logError } = await supabase
      .from('activity_logs')
      .insert({
        message: `Iniciando actualización programada (cron job)`,
        type: 'info',
        details: jobConfig.params,
        timestamp: new Date().toISOString()
      });
      
    if (logError) {
      console.error(`Error al registrar log:`, logError);
    }
    
    // Hacer la petición a nuestra API
    const response = await axios.post(
      `${API_BASE_URL}${jobConfig.endpoint}`, 
      jobConfig.params,
      { timeout: 30000 }
    );
    
    console.log(`Trabajo programado iniciado con éxito. Job ID: ${response.data.jobId}`);
    
    // Registrar éxito
    await supabase
      .from('activity_logs')
      .insert({
        message: `Trabajo programado iniciado. Job ID: ${response.data.jobId}`,
        type: 'success',
        details: response.data,
        timestamp: new Date().toISOString()
      });
      
    return response.data;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error en trabajo programado:`, error);
    
    // Registrar error
    await supabase
      .from('activity_logs')
      .insert({
        message: `Error al iniciar trabajo programado: ${error.message}`,
        type: 'error',
        details: {
          error: error.message,
          stack: error.stack,
          config: jobConfig
        },
        timestamp: new Date().toISOString()
      });
      
    return { error: error.message };
  }
}

/**
 * Función principal para iniciar todos los trabajos programados
 */
function startCronJobs() {
  console.log(`[${new Date().toISOString()}] Iniciando programador de trabajos...`);
  
  // Programar actualización de productos con stock
  cron.schedule(CONFIG.UPDATE_WITH_STOCK.cronPattern, () => {
    runSyncJob(CONFIG.UPDATE_WITH_STOCK);
  });
  console.log(`Programado: Actualización de productos con stock (${CONFIG.UPDATE_WITH_STOCK.cronPattern})`);
  
  // Programar actualización de todos los productos
  cron.schedule(CONFIG.UPDATE_ALL_PRODUCTS.cronPattern, () => {
    runSyncJob(CONFIG.UPDATE_ALL_PRODUCTS);
  });
  console.log(`Programado: Actualización de todos los productos (${CONFIG.UPDATE_ALL_PRODUCTS.cronPattern})`);
  
  // También ejecutar inmediatamente al iniciar el script
  runSyncJob(CONFIG.UPDATE_WITH_STOCK);
}

// Iniciar los trabajos programados
startCronJobs();