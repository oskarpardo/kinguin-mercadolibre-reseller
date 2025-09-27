#!/usr/bin/env node
/**
 * Script para ejecutar los cronjobs en un proceso independiente
 * 
 * Este script debe configurarse para ejecutarse al inicio del servidor
 * o como un servicio/daemon en el sistema operativo.
 * 
 * Para ejecutar:
 * node cron-server.js
 * 
 * Para ejecutar como proceso en segundo plano:
 * pm2 start cron-server.js --name "kinguin-ml-cronjobs"
 */

require('dotenv').config();
const { startCronJobs } = require('../lib/cron-manager');

console.log(`
┌─────────────────────────────────────────────────┐
│                                                 │
│      KINGUIN-MERCADOLIBRE CRONJOB SERVER        │
│                                                 │
└─────────────────────────────────────────────────┘
`);

console.log(`[${new Date().toISOString()}] Iniciando servidor de cronjobs...`);

// Configurar manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error(`[${new Date().toISOString()}] Error no capturado:`, error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toISOString()}] Promesa rechazada no manejada:`, reason);
});

// Iniciar los cronjobs
startCronJobs()
  .then(() => {
    console.log(`[${new Date().toISOString()}] Servidor de cronjobs iniciado correctamente`);
    console.log('Cronjobs en ejecución. Presiona Ctrl+C para detener.');
  })
  .catch(error => {
    console.error(`[${new Date().toISOString()}] Error al iniciar servidor de cronjobs:`, error);
    process.exit(1);
  });

// Manejar señales para un cierre ordenado
process.on('SIGINT', () => {
  console.log(`[${new Date().toISOString()}] Deteniendo servidor de cronjobs...`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] Deteniendo servidor de cronjobs por señal SIGTERM...`);
  process.exit(0);
});