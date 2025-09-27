/**
 * Script para actualizar el tipo de cambio EUR/CLP de forma programada
 * Puede ejecutarse manualmente o programarse con un cron job
 */
const axios = require('axios');
require('dotenv').config();

async function updateExchangeRate() {
  try {
    console.log('🔄 Actualizando tipo de cambio EUR/CLP...');
    
    // URL de la API de tipo de cambio (usar la misma que usa la aplicación)
    const host = process.env.VERCEL_URL || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const url = `${protocol}://${host}/api/exchange-rate?source=scheduler_script`;
    
    const { data } = await axios.get(url);
    
    if (data.fallback) {
      console.log(`⚠️ Se obtuvo un valor de fallback: ${data.rate}`);
      console.log(`   Origen del fallback: ${data.fallbackSource || 'desconocido'}`);
      if (data.errors) {
        console.log('   Errores:');
        console.log(data.errors);
      }
    } else {
      console.log(`✅ Tipo de cambio actualizado: ${data.rate}`);
      console.log(`   Fuentes utilizadas: ${data.sources.join(', ')}`);
    }
    
    console.log(`📅 Fecha: ${data.date}`);
    
  } catch (error) {
    console.error('❌ Error al actualizar tipo de cambio:', error.response?.data || error.message);
    process.exit(1);
  }
}

updateExchangeRate();