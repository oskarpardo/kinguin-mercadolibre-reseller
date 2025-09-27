import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function SyncDashboard() {
  const [syncHistory, setSyncHistory] = useState([]);
  const [webhookQueue, setWebhookQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadSyncData();
  }, []);

  const loadSyncData = async () => {
    try {
      // Obtener historial de sincronizaciones
      const { data: history } = await supabase
        .from('sync_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      
      // Obtener queue de webhooks
      const { data: queue } = await supabase
        .from('webhook_queue')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      
      setSyncHistory(history || []);
      setWebhookQueue(queue || []);
    } catch (error) {
      console.error('Error cargando datos:', error);
    } finally {
      setLoading(false);
    }
  };

  const runIncrementalSync = async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/sync/incremental', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
      console.log('Sincronización incremental:', data);
      
      // Recargar datos
      await loadSyncData();
      
      alert(`Sincronización incremental completada: ${data.stats?.products_updated || 0} productos actualizados`);
    } catch (error) {
      console.error('Error en sincronización:', error);
      alert('Error en sincronización incremental');
    } finally {
      setSyncing(false);
    }
  };

  const runCompleteSync = async () => {
    if (!confirm('¿Está seguro de ejecutar una sincronización completa? Esto puede tomar mucho tiempo.')) {
      return;
    }
    
    setSyncing(true);
    try {
      const response = await fetch('/api/sync/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceComplete: true })
      });
      
      const data = await response.json();
      console.log('Sincronización completa:', data);
      
      // Recargar datos
      await loadSyncData();
      
      alert(`Sincronización completa iniciada: ${data.stats?.products_updated || 0} productos programados`);
    } catch (error) {
      console.error('Error en sincronización:', error);
      alert('Error en sincronización completa');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <div className="p-6">Cargando...</div>;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Dashboard de Sincronización</h1>
        <div className="space-x-3">
          <button
            onClick={runIncrementalSync}
            disabled={syncing}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
          >
            {syncing ? '⏳' : '⚡'} Sincronización Incremental
          </button>
          <button
            onClick={runCompleteSync}
            disabled={syncing}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:bg-gray-400"
          >
            {syncing ? '⏳' : '🔄'} Sincronización Completa
          </button>
        </div>
      </div>

      {/* Estadísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {syncHistory.length > 0 && (
          <>
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-semibold text-blue-800">Última Sincronización</h3>
              <p className="text-2xl text-blue-600">
                {syncHistory[0].sync_type === 'complete' ? '🔄' : '⚡'}
                {syncHistory[0].sync_type}
              </p>
              <p className="text-sm text-blue-500">
                {new Date(syncHistory[0].created_at).toLocaleString()}
              </p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="font-semibold text-green-800">Productos Actualizados</h3>
              <p className="text-2xl text-green-600">{syncHistory[0].products_updated}</p>
              <p className="text-sm text-green-500">En última sincronización</p>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <h3 className="font-semibold text-purple-800">Tiempo de Ejecución</h3>
              <p className="text-2xl text-purple-600">{syncHistory[0].execution_time_seconds}s</p>
              <p className="text-sm text-purple-500">Última sincronización</p>
            </div>
          </>
        )}
        <div className="bg-orange-50 p-4 rounded-lg">
          <h3 className="font-semibold text-orange-800">Webhooks Pendientes</h3>
          <p className="text-2xl text-orange-600">
            {webhookQueue.filter(w => !w.processed).length}
          </p>
          <p className="text-sm text-orange-500">En cola de procesamiento</p>
        </div>
      </div>

      {/* Historial de Sincronizaciones */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Historial de Sincronizaciones</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-left">Tipo</th>
                <th className="p-3 text-left">Fecha</th>
                <th className="p-3 text-left">Productos</th>
                <th className="p-3 text-left">Tiempo</th>
                <th className="p-3 text-left">Estado</th>
              </tr>
            </thead>
            <tbody>
              {syncHistory.map((sync, index) => (
                <tr key={sync.id} className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs ${
                      sync.sync_type === 'complete' ? 'bg-blue-100 text-blue-800' :
                      sync.sync_type === 'incremental' ? 'bg-green-100 text-green-800' :
                      'bg-purple-100 text-purple-800'
                    }`}>
                      {sync.sync_type === 'complete' ? '🔄 Completa' :
                       sync.sync_type === 'incremental' ? '⚡ Incremental' :
                       '🔔 Webhook'}
                    </span>
                  </td>
                  <td className="p-3 text-sm">
                    {new Date(sync.created_at).toLocaleString()}
                  </td>
                  <td className="p-3">
                    <div className="text-sm">
                      <span className="text-green-600">✅ {sync.products_updated}</span>
                      {sync.products_error > 0 && (
                        <span className="text-red-600 ml-2">❌ {sync.products_error}</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-sm">{sync.execution_time_seconds}s</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs ${
                      sync.products_error > 0 ? 'bg-red-100 text-red-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {sync.products_error > 0 ? 'Con errores' : 'Exitoso'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cola de Webhooks */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Cola de Webhooks</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-left">Evento</th>
                <th className="p-3 text-left">Producto ID</th>
                <th className="p-3 text-left">Fecha</th>
                <th className="p-3 text-left">Estado</th>
                <th className="p-3 text-left">Reintentos</th>
              </tr>
            </thead>
            <tbody>
              {webhookQueue.slice(0, 10).map((webhook, index) => (
                <tr key={webhook.id} className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs ${
                      webhook.event_type === 'product.update' ? 'bg-blue-100 text-blue-800' :
                      'bg-purple-100 text-purple-800'
                    }`}>
                      {webhook.event_type === 'product.update' ? '📦 Producto' : '📋 Orden'}
                    </span>
                  </td>
                  <td className="p-3 text-sm">{webhook.kinguin_id || '-'}</td>
                  <td className="p-3 text-sm">
                    {new Date(webhook.created_at).toLocaleString()}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs ${
                      webhook.processed ? 'bg-green-100 text-green-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {webhook.processed ? '✅ Procesado' : '⏳ Pendiente'}
                    </span>
                  </td>
                  <td className="p-3 text-sm">{webhook.retry_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}