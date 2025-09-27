-- Tabla para historial de sincronizaciones
CREATE TABLE IF NOT EXISTS sync_history (
  id SERIAL PRIMARY KEY,
  sync_type VARCHAR(50) NOT NULL, -- 'complete', 'incremental', 'webhook'
  last_update TIMESTAMP WITH TIME ZONE NOT NULL,
  products_updated INTEGER DEFAULT 0,
  products_created INTEGER DEFAULT 0,
  products_skipped INTEGER DEFAULT 0,
  products_error INTEGER DEFAULT 0,
  execution_time_seconds INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB
);

-- Tabla para queue de webhooks
CREATE TABLE IF NOT EXISTS webhook_queue (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL, -- 'product.update', 'order.status'
  kinguin_id INTEGER NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_sync_history_type_date ON sync_history(sync_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_queue_processed ON webhook_queue(processed, created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_queue_kinguin_id ON webhook_queue(kinguin_id);

-- Comentarios
COMMENT ON TABLE sync_history IS 'Historial de sincronizaciones con Kinguin API';
COMMENT ON TABLE webhook_queue IS 'Cola de webhooks de Kinguin para procesamiento asíncrono';