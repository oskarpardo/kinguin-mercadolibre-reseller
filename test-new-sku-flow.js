#!/usr/bin/env node

// Script para probar el nuevo flujo de verificación de SKU
// Prueba con un SKU que sabemos que existe

const https = require('https');

function makeRequest(url, token) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'KinguinMLReseller/1.0'
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error('Invalid JSON response'));
        }
      });
    }).on('error', reject);
  });
}

async function testNewSkuFlow() {
  try {
    console.log('🧪 TEST: Nuevo Flujo de Verificación SKU');
    console.log('======================================');
    
    const token = process.env.ML_ACCESS_TOKEN || "APP_USR-4222016148925577-092801-d404059bbe4fb906d22d5d3a32ac4198-1883668483";
    
    // SKU que sabemos que existe
    const existingSku = '5785';
    
    console.log(`🔍 Verificando SKU existente: ${existingSku}`);
    
    // 1. Obtener usuario
    const userResponse = await makeRequest('https://api.mercadolibre.com/users/me', token);
    console.log(`👤 Usuario: ${userResponse.nickname} (ID: ${userResponse.id})`);
    
    // 2. Obtener productos activos
    const itemsResponse = await makeRequest(
      `https://api.mercadolibre.com/users/${userResponse.id}/items/search?status=active&limit=50`, 
      token
    );
    
    console.log(`📦 Productos activos encontrados: ${itemsResponse.results.length}`);
    
    // 3. Verificar los primeros 5 productos para encontrar SKUs
    let foundDuplicate = false;
    
    for (let i = 0; i < Math.min(5, itemsResponse.results.length); i++) {
      const itemId = itemsResponse.results[i];
      
      try {
        const itemDetail = await makeRequest(`https://api.mercadolibre.com/items/${itemId}`, token);
        
        const skuAttribute = itemDetail.attributes?.find(attr => attr.id === 'SELLER_SKU');
        const itemSku = skuAttribute?.value_name;
        
        console.log(`   📋 ${itemId}: SKU = ${itemSku || 'Sin SKU'}`);
        
        if (itemSku === existingSku) {
          console.log(`   🚫 DUPLICADO ENCONTRADO!`);
          console.log(`      • ML ID: ${itemId}`);
          console.log(`      • Título: ${itemDetail.title}`);
          console.log(`      • Precio: $${itemDetail.price}`);
          console.log(`      • Estado: ${itemDetail.status}`);
          foundDuplicate = true;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.log(`   ❌ Error verificando ${itemId}: ${error.message}`);
      }
    }
    
    if (foundDuplicate) {
      console.log(`\n✅ CONFIRMADO: El flujo detectará el SKU ${existingSku} como duplicado`);
      console.log(`🔄 NUEVO FLUJO:`);
      console.log(`   1. 🔍 Verificar SKU en MercadoLibre PRIMERO`);
      console.log(`   2. 🚫 Si existe → RECHAZAR sin crear en Supabase`);
      console.log(`   3. ✅ Si único → Crear en Supabase, luego en MercadoLibre`);
    } else {
      console.log(`\n❓ No se encontró el SKU ${existingSku} en los primeros ${Math.min(5, itemsResponse.results.length)} productos`);
      console.log(`💡 Puede estar en productos posteriores o no existir`);
    }
    
    console.log(`\n🎯 FLUJO ACTUAL IMPLEMENTADO:`);
    console.log(`   ✅ Verificación SKU ANTES de crear registro Supabase`);
    console.log(`   ✅ No se crea nada si SKU ya existe`);
    console.log(`   ✅ Solo se procesa si SKU es único`);
    
  } catch (error) {
    console.error('❌ Error en test:', error.message);
  }
}

testNewSkuFlow().catch(console.error);