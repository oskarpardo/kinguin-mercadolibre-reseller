// scripts/init-supabase-tables.js
// Script para inicializar las tablas necesarias en Supabase

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Verificar variables de entorno
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: Faltan las variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Crear cliente de Supabase con la clave de servicio para tener permisos completos
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function initializeTables() {
  console.log('🚀 Iniciando creación de tablas en Supabase...');

  try {
    // 1. Crear tabla de activity_logs
    console.log('📊 Creando tabla activity_logs...');
    const { error: logsError } = await supabase.rpc('create_activity_logs_table', {});
    
    if (logsError) {
      // Si el error es que la tabla ya existe, continuamos
      if (logsError.message.includes('already exists')) {
        console.log('ℹ️ La tabla activity_logs ya existe.');
      } else {
        throw new Error(`Error al crear tabla activity_logs: ${logsError.message}`);
      }
    } else {
      console.log('✅ Tabla activity_logs creada correctamente.');
    }

    // 2. Crear tabla de tokens
    console.log('🔑 Creando tabla tokens...');
    const { error: tokensError } = await supabase.rpc('create_tokens_table', {});
    
    if (tokensError) {
      if (tokensError.message.includes('already exists')) {
        console.log('ℹ️ La tabla tokens ya existe.');
      } else {
        throw new Error(`Error al crear tabla tokens: ${tokensError.message}`);
      }
    } else {
      console.log('✅ Tabla tokens creada correctamente.');
    }

    // 3. Crear tabla de published_products
    console.log('🛍️ Creando tabla published_products...');
    const { error: productsError } = await supabase.rpc('create_published_products_table', {});
    
    if (productsError) {
      if (productsError.message.includes('already exists')) {
        console.log('ℹ️ La tabla published_products ya existe.');
      } else {
        throw new Error(`Error al crear tabla published_products: ${productsError.message}`);
      }
    } else {
      console.log('✅ Tabla published_products creada correctamente.');
    }

    // 4. Crear tabla de jobs
    console.log('⚙️ Creando tabla jobs...');
    const { error: jobsError } = await supabase.rpc('create_jobs_table', {});
    
    if (jobsError) {
      if (jobsError.message.includes('already exists')) {
        console.log('ℹ️ La tabla jobs ya existe.');
      } else {
        throw new Error(`Error al crear tabla jobs: ${jobsError.message}`);
      }
    } else {
      console.log('✅ Tabla jobs creada correctamente.');
    }

    // 5. Crear tabla de system_config
    console.log('⚙️ Creando tabla system_config...');
    const { error: configError } = await supabase.rpc('create_system_config_table', {});
    
    if (configError) {
      if (configError.message.includes('already exists')) {
        console.log('ℹ️ La tabla system_config ya existe.');
      } else {
        throw new Error(`Error al crear tabla system_config: ${configError.message}`);
      }
    } else {
      console.log('✅ Tabla system_config creada correctamente.');
      
      // Inicializar configuración de velocidad por defecto
      const speedConfig = {
        concurrency: 15,
        batch_interval_ms: 100,
        max_retries: 5,
        base_delay_ms: 500,
        request_timeout_ms: 30000
      };
      
      const { error: insertError } = await supabase
        .from('system_config')
        .upsert({
          key: 'processing_speed',
          value: speedConfig,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
      
      if (insertError) {
        console.warn(`⚠️ No se pudo inicializar la configuración de velocidad: ${insertError.message}`);
      } else {
        console.log('✅ Configuración de velocidad inicializada correctamente.');
      }
    }

    console.log('\n✅✅✅ Inicialización de tablas completada con éxito! ✅✅✅');
    
  } catch (error) {
    console.error(`\n❌ ERROR FATAL: ${error.message}`);
    process.exit(1);
  }
}

// Crear funciones SQL necesarias para inicializar las tablas
async function createSqlFunctions() {
  console.log('🔧 Creando funciones SQL para la inicialización de tablas...');
  
  try {
    // Función para crear tabla activity_logs
    await supabase.rpc('create_sql_function_for_activity_logs', {
      sql: `
        CREATE OR REPLACE FUNCTION create_activity_logs_table() 
        RETURNS void AS $$
        BEGIN
          CREATE TABLE IF NOT EXISTS public.activity_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            message TEXT NOT NULL,
            type VARCHAR(50) DEFAULT 'info',
            data JSONB,
            job_id UUID,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            user_id UUID
          );
          
          -- Crear índices para búsqueda más eficiente
          CREATE INDEX IF NOT EXISTS activity_logs_type_idx ON public.activity_logs(type);
          CREATE INDEX IF NOT EXISTS activity_logs_job_id_idx ON public.activity_logs(job_id);
          CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON public.activity_logs(created_at);
          
          -- Comentarios en la tabla
          COMMENT ON TABLE public.activity_logs IS 'Registro de actividades y logs del sistema';
          COMMENT ON COLUMN public.activity_logs.type IS 'Tipo de log: info, warning, error, success';
          
          -- Política RLS (Row Level Security)
          ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
          
          -- Políticas de acceso
          CREATE POLICY "Acceso público para lectura de logs" 
            ON public.activity_logs FOR SELECT 
            USING (true);
            
          CREATE POLICY "Solo servicios autenticados pueden insertar logs" 
            ON public.activity_logs FOR INSERT 
            WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');
        END;
        $$ LANGUAGE plpgsql;
      `
    });

    // Función para crear tabla tokens
    await supabase.rpc('create_sql_function_for_tokens', {
      sql: `
        CREATE OR REPLACE FUNCTION create_tokens_table() 
        RETURNS void AS $$
        BEGIN
          CREATE TABLE IF NOT EXISTS public.tokens (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            key TEXT NOT NULL UNIQUE,
            value TEXT NOT NULL,
            description TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            expires_at TIMESTAMP WITH TIME ZONE
          );
          
          -- Índice para búsqueda rápida por clave
          CREATE UNIQUE INDEX IF NOT EXISTS tokens_key_idx ON public.tokens(key);
          
          -- Comentarios en la tabla
          COMMENT ON TABLE public.tokens IS 'Almacenamiento seguro de tokens de APIs';
          
          -- Política RLS (Row Level Security)
          ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;
          
          -- Políticas de acceso
          CREATE POLICY "Solo servicios pueden leer tokens" 
            ON public.tokens FOR SELECT 
            USING (auth.role() = 'service_role');
            
          CREATE POLICY "Solo servicios pueden modificar tokens" 
            ON public.tokens FOR ALL 
            USING (auth.role() = 'service_role');
        END;
        $$ LANGUAGE plpgsql;
      `
    });

    // Función para crear tabla published_products
    await supabase.rpc('create_sql_function_for_published_products', {
      sql: `
        CREATE OR REPLACE FUNCTION create_published_products_table() 
        RETURNS void AS $$
        BEGIN
          CREATE TABLE IF NOT EXISTS public.published_products (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            kinguin_id TEXT NOT NULL UNIQUE,
            ml_id TEXT NOT NULL,
            title TEXT NOT NULL,
            price NUMERIC NOT NULL,
            euro_price NUMERIC,
            platform TEXT,
            product_type TEXT,
            region TEXT,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
          
          -- Índices para búsqueda eficiente
          CREATE UNIQUE INDEX IF NOT EXISTS published_products_kinguin_id_idx ON public.published_products(kinguin_id);
          CREATE INDEX IF NOT EXISTS published_products_ml_id_idx ON public.published_products(ml_id);
          CREATE INDEX IF NOT EXISTS published_products_status_idx ON public.published_products(status);
          
          -- Comentarios en la tabla
          COMMENT ON TABLE public.published_products IS 'Productos publicados en MercadoLibre';
          
          -- Política RLS (Row Level Security)
          ALTER TABLE public.published_products ENABLE ROW LEVEL SECURITY;
          
          -- Políticas de acceso
          CREATE POLICY "Acceso público para lectura de productos" 
            ON public.published_products FOR SELECT 
            USING (true);
            
          CREATE POLICY "Solo servicios autenticados pueden modificar productos" 
            ON public.published_products FOR ALL 
            USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
        END;
        $$ LANGUAGE plpgsql;
      `
    });

    // Función para crear tabla jobs
    await supabase.rpc('create_sql_function_for_jobs', {
      sql: `
        CREATE OR REPLACE FUNCTION create_jobs_table() 
        RETURNS void AS $$
        BEGIN
          CREATE TABLE IF NOT EXISTS public.jobs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            job_type TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            completed_at TIMESTAMP WITH TIME ZONE,
            data JSONB,
            result JSONB,
            error TEXT,
            progress JSONB
          );
          
          -- Índices para búsqueda eficiente
          CREATE INDEX IF NOT EXISTS jobs_status_idx ON public.jobs(status);
          CREATE INDEX IF NOT EXISTS jobs_job_type_idx ON public.jobs(job_type);
          CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON public.jobs(created_at);
          
          -- Comentarios en la tabla
          COMMENT ON TABLE public.jobs IS 'Trabajos en segundo plano';
          COMMENT ON COLUMN public.jobs.status IS 'Estado del trabajo: pending, processing, completed, failed';
          
          -- Política RLS (Row Level Security)
          ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
          
          -- Políticas de acceso
          CREATE POLICY "Acceso público para lectura de jobs" 
            ON public.jobs FOR SELECT 
            USING (true);
            
          CREATE POLICY "Solo servicios autenticados pueden modificar jobs" 
            ON public.jobs FOR ALL 
            USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
        END;
        $$ LANGUAGE plpgsql;
      `
    });

    // Función para crear tabla system_config
    await supabase.rpc('create_sql_function_for_system_config', {
      sql: `
        CREATE OR REPLACE FUNCTION create_system_config_table() 
        RETURNS void AS $$
        BEGIN
          CREATE TABLE IF NOT EXISTS public.system_config (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            key TEXT NOT NULL UNIQUE,
            value JSONB NOT NULL,
            description TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
          
          -- Índice para búsqueda rápida por clave
          CREATE UNIQUE INDEX IF NOT EXISTS system_config_key_idx ON public.system_config(key);
          
          -- Comentarios en la tabla
          COMMENT ON TABLE public.system_config IS 'Configuraciones del sistema';
          
          -- Política RLS (Row Level Security)
          ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
          
          -- Políticas de acceso
          CREATE POLICY "Acceso público para lectura de configuración" 
            ON public.system_config FOR SELECT 
            USING (true);
            
          CREATE POLICY "Solo servicios autenticados pueden modificar configuración" 
            ON public.system_config FOR ALL 
            USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');
        END;
        $$ LANGUAGE plpgsql;
      `
    });

    console.log('✅ Funciones SQL creadas correctamente.');
    
    // Inicializar las tablas
    await initializeTables();
    
  } catch (error) {
    console.error(`\n❌ ERROR AL CREAR FUNCIONES SQL: ${error.message}`);
    if (error.message.includes('function already exists')) {
      console.log('⚠️ Algunas funciones ya existen. Intentando continuar con la inicialización...');
      await initializeTables();
    } else {
      process.exit(1);
    }
  }
}

// Iniciar el proceso
createSqlFunctions().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});