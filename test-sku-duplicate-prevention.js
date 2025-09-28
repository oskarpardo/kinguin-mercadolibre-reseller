#!/usr/bin/env node

// Script para probar la nueva verificación de SKU duplicado
// Simula el proceso de agregar un producto que ya existe

const axios = require('axios');

async function testSkuDuplicateVerification() {
  try {
    console.log('🧪 TEST: Verificación de SKU Duplicado');
    console.log('====================================');
    
    // Usar un producto que sabemos que ya existe
    const existingKinguinId = '5785'; // El del producto MLC3172629344 que verificamos antes
    
    console.log(`📦 Probando con Kinguin ID existente: ${existingKinguinId}`);
    
    // Hacer una llamada al endpoint add-product
    const response = await axios.post('http://localhost:3000/api/add-product', {
      kinguinIds: [existingKinguinId]
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('📤 Respuesta del servidor:');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.jobId) {
      console.log(`\n🔍 Job ID generado: ${response.data.jobId}`);
      console.log('💡 Puedes monitorear el progreso en:');
      console.log(`   http://localhost:3000/api/job-status?jobId=${response.data.jobId}`);
      
      // Esperar un poco y verificar el estado
      console.log('\n⏳ Esperando 10 segundos para verificar el estado...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      const statusResponse = await axios.get(`http://localhost:3000/api/job-status?jobId=${response.data.jobId}`);
      
      console.log('\n📊 Estado del job:');
      console.log(JSON.stringify(statusResponse.data, null, 2));
      
      // Verificar si detectó duplicado
      const results = statusResponse.data.results || [];
      const hasSkippedDuplicate = results.some(r => r.reason === 'sku_duplicate_in_mercadolibre');
      
      if (hasSkippedDuplicate) {
        console.log('\n✅ ÉXITO: El sistema detectó correctamente el SKU duplicado!');
        console.log('🚫 El producto fue rechazado como esperado');
      } else {
        console.log('\n❓ RESULTADO: Verificar manualmente los logs para confirmar el comportamiento');
      }
    }
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.log('❌ Error: El servidor no está ejecutándose');
      console.log('💡 Ejecuta: npm run dev');
      console.log('💡 Luego vuelve a ejecutar este test');
    } else {
      console.error('❌ Error en el test:', error.message);
      
      if (error.response) {
        console.log('📤 Respuesta del servidor:');
        console.log(JSON.stringify(error.response.data, null, 2));
      }
    }
  }
}

console.log('🔧 IMPORTANTE: Este test requiere que el servidor esté ejecutándose');
console.log('💡 Si no está ejecutándose, ejecuta: npm run dev');
console.log('');

testSkuDuplicateVerification().catch(console.error);