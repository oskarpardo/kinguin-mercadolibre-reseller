/**
 * Script para crear la tabla exchange_rates en Supabase
 * Ejecutar con: node scripts/create-exchange-rates-table.js
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function createExchangeRatesTable() {
  // Validar variables de entorno
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Error: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY deben estar definidos en .env');
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  console.log('Creando tabla exchange_rates en Supabase...');

  try {
    // Verificar si la tabla ya existe
    const { data: existingTables, error: tableError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_name', 'exchange_rates')
      .eq('table_schema', 'public');

    if (tableError) {
      throw new Error(`Error al verificar si la tabla existe: ${tableError.message}`);
    }

    if (existingTables && existingTables.length > 0) {
      console.log('✅ La tabla exchange_rates ya existe. Puedes usarla directamente.');
      return;
    }

    // Crear la tabla exchange_rates con SQL
    const { error } = await supabase.rpc('exec_sql', {
      sql_string: `
        CREATE TABLE public.exchange_rates (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          rate NUMERIC NOT NULL,
          sources TEXT[],
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          fallback BOOLEAN DEFAULT false
        );
        
        -- Agregar índices para mejorar el rendimiento de consultas
        CREATE INDEX idx_exchange_rates_created_at ON public.exchange_rates(created_at DESC);
        
        -- Establecer permisos para la tabla
        ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
        
        -- Permitir a los servicios de Vercel insertar y consultar
        CREATE POLICY "Permitir inserciones desde servicios" 
          ON public.exchange_rates FOR INSERT 
          WITH CHECK (true);
          
        CREATE POLICY "Permitir consultas anónimas" 
          ON public.exchange_rates FOR SELECT 
          USING (true);
      `
    });

    if (error) {
      throw new Error(`Error al crear la tabla exchange_rates: ${error.message}`);
    }

    console.log('✅ Tabla exchange_rates creada exitosamente!');
    
    // Insertar un valor inicial para tener algo en la tabla
    const { error: insertError } = await supabase
      .from('exchange_rates')
      .insert({
        rate: 1015, // Valor actual a septiembre 2025
        sources: ['initial_setup'],
        created_at: new Date().toISOString(),
        fallback: true
      });
    
    if (insertError) {
      throw new Error(`Error al insertar valor inicial: ${insertError.message}`);
    }
    
    console.log('✅ Valor inicial insertado: EUR/CLP = 1015');
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

createExchangeRatesTable();