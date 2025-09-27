import { createClient } from '@supabase/supabase-js';
import { updateProductsWithStock, updateAllProducts, updateExchangeRate } from '../../lib/cron-manager';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

  try {
    const { jobType } = req.body;
    
    if (!jobType) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere especificar el tipo de trabajo (jobType)'
      });
    }
    
    let jobId = null;
    let result = null;
    
    // Registrar inicio de la ejecución manual
    await supabase.from('activity_logs').insert({
      message: `Ejecución manual de cronjob: ${jobType}`,
      type: 'info',
      source: 'api'
    });
    
    // Ejecutar el trabajo correspondiente
    switch (jobType) {
      case 'update_stock':
        jobId = await updateProductsWithStock();
        result = { jobId };
        break;
        
      case 'update_all':
        jobId = await updateAllProducts();
        result = { jobId };
        break;
        
      case 'exchange_rate':
        const rate = await updateExchangeRate();
        result = { rate };
        break;
        
      default:
        return res.status(400).json({
          success: false,
          error: `Tipo de trabajo inválido: ${jobType}`
        });
    }
    
    return res.status(200).json({
      success: true,
      jobType,
      result,
      message: `Trabajo ${jobType} iniciado correctamente`
    });
  } catch (error) {
    console.error('Error al ejecutar cronjob manualmente:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Error al ejecutar cronjob'
    });
  }
}