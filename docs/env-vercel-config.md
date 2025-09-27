# Configuración de Variables de Entorno en Vercel

Este proyecto está configurado para ejecutarse en Vercel y utiliza las variables de entorno configuradas allí.

## Tipo de Cambio EUR a CLP

El sistema usa múltiples APIs para obtener el tipo de cambio EUR a CLP en tiempo real:
- Exchange Rate Host
- Exchange Rate API
- Currency Freaks
- Currency API
- ExchangeRate-API

**IMPORTANTE**: El sistema requiere un valor de tipo de cambio real y actualizado para funcionar correctamente. No utiliza valores hardcodeados en ningún caso. Si no se puede obtener un tipo de cambio real de ninguna de las fuentes:

1. Intentará usar un valor de la base de datos si existe uno de las últimas 24 horas
2. Si no hay un valor reciente en la base de datos, el sistema mostrará un error y no permitirá actualizar precios ni publicar productos

Esta medida garantiza que todos los precios reflejen el valor real del Euro en el momento exacto de la publicación o corrección.

## Variables de Entorno Requeridas

Las siguientes variables ya están configuradas en Vercel:

- `KINGUIN_API_KEY`: Clave para la API de Kinguin
- `ML_ACCESS_TOKEN`: Token de acceso para MercadoLibre
- `ML_USER_ID`: ID de usuario en MercadoLibre
- `SUPABASE_URL`: URL de tu proyecto Supabase
- `SUPABASE_SERVICE_ROLE_KEY`: Clave de servicio para Supabase
- `ML_APP_ID`: ID de la aplicación de MercadoLibre
- `ML_CLIENT_SECRET`: Secreto del cliente de MercadoLibre
- `VERCEL_URL`: URL de la aplicación en Vercel

## Verificación de Configuración

Si estás experimentando problemas con la detección de stock o errores al conectar con las APIs, puedes utilizar el script de verificación:

```bash
node scripts/check-env-vercel.js
```

Este script verificará la disponibilidad de las variables de entorno necesarias y te proporcionará información sobre cualquier configuración faltante o incorrecta.

## Desarrollo Local

Para desarrollo local, necesitarás crear un archivo `.env` en la raíz del proyecto con las mismas variables que están configuradas en Vercel. Puedes usar `.env.example` como plantilla.

## Problema Común: Detección de Stock

Si todos los productos aparecen como "sin stock", verifica:

1. Que `KINGUIN_API_KEY` esté correctamente configurada en Vercel
2. Que la API key no haya expirado
3. Que la estructura de las ofertas de Kinguin no haya cambiado

## Configuración en Vercel

Para actualizar las variables de entorno en Vercel:

1. Accede al panel de Vercel
2. Ve a la configuración del proyecto
3. Selecciona "Environment Variables"
4. Actualiza o añade las variables necesarias