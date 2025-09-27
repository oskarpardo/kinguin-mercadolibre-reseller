import { createClient } from '@supabase/supabase-js';
import externalCrons from '../../lib/external-crons';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Clave API secreta para proteger los endpoints de cronjobs
const API_KEY = process.env.EXTERNAL_CRON_API_KEY || 'kinguin-ml-cron-key';

export default async function handler(req, res) {
  // Verificar si la solicitud incluye la clave API correcta
  const apiKey = req.query.key || req.headers['x-api-key'];
  
  if (apiKey !== API_KEY) {
    return res.status(403).json({
      success: false,
      error: 'Acceso no autorizado. Se requiere una clave API válida.'
    });
  }
  
  const { id } = req.query;
  
  if (!id) {
    return res.status(400).json({
      success: false,
      error: 'Se requiere el ID del cronjob a ejecutar'
    });
  }
  
  try {
    // Buscar el cronjob por ID en todas las categorías
    let cronJob = null;
    let category = '';
    
    for (const [cat, jobs] of Object.entries(externalCrons)) {
      const job = jobs.find(j => j.id === id);
      if (job) {
        cronJob = job;
        category = cat;
        break;
      }
    }
    
    if (!cronJob) {
      return res.status(404).json({
        success: false,
        error: `No se encontró un cronjob con ID: ${id}`
      });
    }
    
    // Registrar el inicio de la ejecución
    const { data: logData, error: logError } = await supabase
      .from('external_cron_logs')
      .insert({
        cron_id: id,
        cron_name: cronJob.name,
        status: 'running',
        category,
        source: req.query.source || 'api',
        client_ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
      })
      .select();
    
    let logId = null;
    if (logData && logData.length > 0) {
      logId = logData[0].id;
    }
    
    // Construir la URL para ejecutar el cronjob
    let cronUrl = cronJob.url;
    
    // Añadir parámetros adicionales si existen
    if (cronJob.params) {
      const urlObj = new URL(cronUrl, 'http://localhost');
      
      Object.entries(cronJob.params).forEach(([key, value]) => {
        urlObj.searchParams.append(key, value);
      });
      
      // Extraer solo la parte path + search de la URL
      cronUrl = urlObj.pathname + urlObj.search;
    }
    
    // Ejecutar la solicitud interna al endpoint correspondiente
    const jobResult = await executeInternalRequest(
      cronUrl,
      cronJob.method || 'GET'
    );
    
    // Actualizar el registro con el resultado
    if (logId) {
      await supabase
        .from('external_cron_logs')
        .update({
          status: jobResult.success ? 'completed' : 'failed',
          response: JSON.stringify(jobResult),
          completed_at: new Date().toISOString(),
          execution_time_ms: new Date() - new Date(logData[0].created_at)
        })
        .eq('id', logId);
    }
    
    return res.status(200).json({
      success: true,
      message: `Cronjob '${cronJob.name}' ejecutado`,
      result: jobResult
    });
    
  } catch (error) {
    console.error('Error al ejecutar cronjob externo:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Error interno al ejecutar el cronjob',
      details: error.message
    });
  }
}

// Función para ejecutar una solicitud interna a otro endpoint
async function executeInternalRequest(path, method = 'GET') {
  try {
    // Esta función simula una solicitud interna a otro endpoint
    // En un entorno real, deberías importar directamente el handler del endpoint
    // o usar una biblioteca HTTP para hacer la solicitud
    
    const endpointHandler = require(`..${path.split('?')[0]}`).default;
    
    // Crear objetos simulados de solicitud y respuesta
    const mockReq = {
      method,
      query: {}, // Aquí deberías parsear los parámetros de consulta de path
      body: {},
      headers: {
        'x-internal-request': 'true'
      }
    };
    
    // Parsear los parámetros de consulta si existen
    if (path.includes('?')) {
      const queryString = path.split('?')[1];
      const params = new URLSearchParams(queryString);
      
      params.forEach((value, key) => {
        mockReq.query[key] = value;
      });
    }
    
    let responseData = null;
    let responseStatus = 200;
    let responseHeaders = {};
    
    // Crear un objeto de respuesta simulado
    const mockRes = {
      status: (status) => {
        responseStatus = status;
        return mockRes;
      },
      json: (data) => {
        responseData = data;
        return mockRes;
      },
      setHeader: (name, value) => {
        responseHeaders[name] = value;
        return mockRes;
      },
      end: () => {}
    };
    
    // Ejecutar el handler
    await endpointHandler(mockReq, mockRes);
    
    return {
      success: responseStatus >= 200 && responseStatus < 300,
      status: responseStatus,
      data: responseData
    };
  } catch (error) {
    console.error('Error en executeInternalRequest:', error);
    return {
      success: false,
      error: error.message
    };
  }
}