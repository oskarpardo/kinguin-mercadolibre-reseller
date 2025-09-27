// Trigger para forzar redeploy de Vercel
// Se ejecuta cuando GitHub Actions hace el primer run

export default function handler(req, res) {
  res.status(200).json({ 
    message: 'Sistema ultra optimizado activo',
    timestamp: new Date().toISOString(),
    status: 'ready'
  });
}