import axios from "axios";

// ---------- Registro de actividad ----------
export async function logActivity(message, type = 'info', details = null, jobId = null) {
  try {
    // Llamada interna a la API de activity-logs
    const timestamp = new Date().toISOString();
    
    // Si estamos en un entorno serverless o SSR:
    if (typeof window === 'undefined') {
      // Importación dinámica para evitar problemas con SSR
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      // Registrar directamente en la base de datos
      await supabase.from("activity_logs").insert({
        message,
        type, // info, success, error, warning
        details,
        job_id: jobId,
        timestamp
      });
      
      // También registrar en la consola para debugging
      const typeEmoji = {
        'info': 'ℹ️',
        'success': '✅',
        'error': '❌',
        'warning': '⚠️'
      };
      console.log(`${typeEmoji[type] || '🔸'} [${type.toUpperCase()}]${jobId ? ` [Job: ${jobId}]` : ''} ${message}`);
      
      return { success: true, timestamp };
    }
    // En entorno cliente, usar la API
    else {
      const response = await fetch('/api/activity-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, type, details, jobId })
      });
      
      if (!response.ok) {
        console.error('Error al registrar actividad:', await response.text());
        return { success: false, error: 'Error al registrar actividad' };
      }
      
      return await response.json();
    }
  } catch (err) {
    console.error('Error al registrar actividad:', err);
    return { success: false, error: err.message };
  }
}

// ---------- Plataforma ----------
export function normalizePlatform(platform) {
  if (!platform) return "PC";
  const p = platform.toLowerCase().trim();
  if (p.includes("ea app")) return "EA App";
  if (p.includes("origin")) return "Origin";
  if (p.includes("gog.com") || p.includes("gog")) return "GOG";
  if (p.includes("steam")) return "Steam";
  if (p.includes("epic")) return "Epic Games";
  if (p.includes("ubisoft") || p.includes("uplay")) return "Ubisoft";
  if (p.includes("battle.net") || p.includes("battlenet")) return "Battle.net";
  if (p.includes("microsoft") || p.includes("xbox")) return "Microsoft Store";
  return "PC";
}

// ---------- Tipo de producto ----------
export function getProductType(product) {
  const parts = [
    product?.name, product?.originalName, product?.format, product?.platform,
    ...(Array.isArray(product?.features) ? product.features : [product?.features].filter(Boolean)),
    product?.description
  ].filter(Boolean);
  const text = parts.map(v => String(v).toLowerCase()).join(" ");

  const isGiftCard = text.includes("gift card") || text.includes("tarjeta de regalo") || text.includes("wallet") || /\$\d+|\d+\s?usd|\d+\s?eur/.test(text);

  if (isGiftCard && !text.includes("altergift")) {
    return "gift_card";
  }
  if (text.includes("altergift") || text.includes("alter gift")) return "altergift";
  if (text.includes("dlc") || text.includes("downloadable content") || text.includes("expansion")
    || text.includes("add-on") || text.includes("season pass")) return "dlc";
  if (text.includes("gift") && !text.includes("altergift")) return "gift";

  const accountHints = ["login","credential","credentials","password","usuario","contraseña","full access","offline account","preloaded account","compartida","shared account"];
  const isAccount = text.includes("account") && accountHints.some(h => text.includes(h));
  if (isAccount) return "account";

  return "key";
}

// ---------- Región (estricto) ----------
export function regionVerdict(regionLimitations) {
  const norm = (regionLimitations || "").trim().toLowerCase();
  const allowedRegions = [
    "region free", "row", "latin america", "latam", "row custom",
    "global", "worldwide", "international"
  ];
  const allowed = norm === "" || allowedRegions.some(r => norm.includes(r));
  return { norm, allowed };
}

// ---------- Validar Producto Kinguin ----------
export function validateProduct(product) {
  const errors = [];
  if (!product) errors.push("El objeto del producto es nulo o indefinido.");
  else if (!product?.name && !product?.originalName) errors.push("Producto sin nombre");
  else if (!Array.isArray(product?.offers) || !product.offers.length) errors.push("Sin ofertas disponibles");
  return { isValid: errors.length === 0, errors };
}

// ---------- FX EUR->CLP ----------
/**
 * Obtiene el tipo de cambio EUR->CLP usando el API interno que consulta múltiples fuentes
 * Si todas las fuentes fallan, se utiliza un valor por defecto.
 * @returns {Promise<number>} El tipo de cambio EUR->CLP
 */
export async function getEuroToClp() {
  try {
    console.log("[FX] 🔄 Obteniendo tipo de cambio...");
    
    // En lugar de hacer una llamada HTTP interna, usar directamente la lógica
    // Esto evita problemas de timeout y es más eficiente en Vercel
    
    // Lista de APIs públicas para tipo de cambio
    const apis = [
      { 
        name: "ExchangeRate-API", 
        url: "https://v6.exchangerate-api.com/v6/4b2791d8815316b6f5d4e0b2/latest/EUR", 
        extractRate: (data) => data?.conversion_rates?.CLP
      },
      { 
        name: "Open Exchange Rates", 
        url: "https://open.er-api.com/v6/latest/EUR", 
        extractRate: (data) => data?.rates?.CLP
      },
      { 
        name: "Currency API (CDN)", 
        url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json", 
        extractRate: (data) => data?.eur?.clp
      }
    ];

    const results = [];
    const errors = [];
    
    // Consultar las primeras 2 APIs en paralelo para mayor velocidad
    const quickPromises = apis.slice(0, 2).map(async (api) => {
      try {
        console.log(`[FX] Consultando API: ${api.name}`);
        const response = await axios.get(api.url, { 
          timeout: 10000,  // Aumentado de 5s a 10s para mejor estabilidad
          headers: { 'User-Agent': 'Mozilla/5.0 MercadoLibre Currency Converter/1.0' }
        });
        
        const rate = api.extractRate(response.data);
        if (rate && typeof rate === 'number' && rate > 0) {
          console.log(`[FX] ✅ API ${api.name} respondió con tasa: ${rate}`);
          results.push({ name: api.name, rate });
          return true;
        }
        
        console.warn(`[FX] ⚠️ API ${api.name} devolvió tasa inválida: ${rate}`);
        errors.push(`${api.name}: Tasa inválida (${rate})`);
        return false;
      } catch (error) {
        const errorMsg = error.response?.status 
          ? `Error HTTP ${error.response.status}` 
          : error.code === 'ECONNABORTED'
            ? 'Timeout'
            : error.message;
            
        console.error(`[FX] ❌ Error en API ${api.name}: ${errorMsg}`);
        errors.push(`${api.name}: ${errorMsg}`);
        return false;
      }
    });
    
    await Promise.allSettled(quickPromises);

    // Si hay al menos un resultado exitoso, usar promedio
    if (results.length > 0) {
      const sum = results.reduce((acc, curr) => acc + curr.rate, 0);
      const average = Math.round(sum / results.length);
      
      console.log(`[FX] ✅ Tipo de cambio obtenido: ${average} (promedio de ${results.length} fuentes)`);
      
      // Guardar en la base de datos para uso futuro
      try {
        const { createClient } = await import("@supabase/supabase-js");
        const supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        
        await supabase.from("exchange_rates").insert({
          rate: average,
          sources: results.map(r => r.name),
          created_at: new Date().toISOString()
        });
        
        console.log(`[FX] 💾 Tipo de cambio guardado en la base de datos: ${average}`);
      } catch (dbError) {
        console.error(`[FX] Error al guardar tipo de cambio en la base de datos: ${dbError.message}`);
      }
      
      await logFxRate(average, results.map(r => r.name), false);
      return average;
    }
    
    throw new Error("No se pudo obtener tipo de cambio de las APIs");
  } catch (error) {
    console.error(`[FX] ❌ ERROR al obtener tipo de cambio: ${error.message}`);
    
    // Intentar obtener el último tipo de cambio guardado de la base de datos
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      const { data: lastRate, error: dbError } = await supabase
        .from("exchange_rates")
        .select("rate, created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      
      if (!dbError && lastRate && lastRate.length > 0) {
        const savedRate = lastRate[0].rate;
        const savedDate = new Date(lastRate[0].created_at);
        const hoursAgo = (Date.now() - savedDate.getTime()) / (1000 * 60 * 60);
        
        // Solo usar valor de BD si es de las últimas 24 horas
        if (hoursAgo < 24) {
          console.warn(`[FX] ⚠️ Usando tipo de cambio de la base de datos de hace ${Math.round(hoursAgo)} horas: ${savedRate}`);
          await logFxRate(savedRate, ["database_recent"], true);
          return savedRate;
        } else {
          console.error(`[FX] ❌ Tipo de cambio en base de datos demasiado antiguo (${Math.round(hoursAgo)} horas)`);
        }
      }
    } catch (dbError) {
      console.error(`[FX] Error al consultar tipo de cambio en la base de datos: ${dbError.message}`);
    }
    
    // Si no se pudo obtener un tipo de cambio real, usar un valor de emergencia hardcodeado
    console.error(`[FX] ❌ ERROR CRÍTICO: No se pudo obtener un tipo de cambio real válido`);
    await logActivity(
      `ERROR CRÍTICO: No se pudo obtener un tipo de cambio real EUR/CLP de ninguna fuente`,
      'error',
      { error: error.message }
    );
    
    // VALOR DE EMERGENCIA HARDCODEADO - actualizado septiembre 2025
    const emergencyRate = 1120; // Valor EUR/CLP actualizado según tasa actual septiembre 2025
    console.warn(`[FX] ⚠️ Usando tipo de cambio de emergencia hardcodeado: ${emergencyRate}`);
    await logFxRate(emergencyRate, ['hardcoded_emergency'], true);
    await logActivity(
      `Usando tipo de cambio de EMERGENCIA hardcodeado: ${emergencyRate} EUR/CLP`,
      'warning',
      { rate: emergencyRate, source: 'hardcoded_emergency' }
    );
    
    // Guardar también este valor en la BD para no tener que usarlo en la próxima ejecución
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      await supabase.from("exchange_rates").insert({
        rate: emergencyRate,
        sources: ['hardcoded_emergency'],
        created_at: new Date().toISOString(),
        fallback: true
      });
      
      console.log(`[FX] 💾 Tipo de cambio de emergencia guardado en la base de datos: ${emergencyRate}`);
    } catch (dbError) {
      console.error(`[FX] Error al guardar tipo de cambio de emergencia: ${dbError.message}`);
    }
    
    // Devolver el valor de emergencia en lugar de lanzar error
    return emergencyRate;
  }
}

/**
 * Registra el tipo de cambio usado para análisis posterior
 * @param {number} rate - El tipo de cambio usado
 * @param {Array<string>} sources - Las fuentes utilizadas
 * @param {boolean} isFallback - Si es un valor por defecto
 */
async function logFxRate(rate, sources = [], isFallback = false) {
  try {
    // Registrar en la consola para debugging inmediato
    console.log(`[FX] 📊 EUR/CLP: ${rate} | Fuentes: ${sources.join(', ')} | Fallback: ${isFallback}`);
    
    // También registrar en la actividad del sistema
    await logActivity(
      `Tipo de cambio EUR/CLP: ${rate} (${isFallback ? 'fallback' : 'tiempo real'})`,
      isFallback ? 'warning' : 'info',
      { rate, sources, isFallback }
    );
  } catch (error) {
    console.error(`[FX] Error al registrar tipo de cambio: ${error.message}`);
  }
}

// ---------- Fee Kinguin ----------
const KINGUIN_FEE_TIERS = [
  { max: 1, fee: 0.81 }, { max: 2, fee: 0.92 }, { max: 3, fee: 1.03 },
  { max: 4, fee: 1.14 }, { max: 5, fee: 1.25 }, { max: 6, fee: 1.36 },
  { max: 7, fee: 1.47 }, { max: 8, fee: 1.58 }, { max: 9, fee: 1.69 },
  { max: 10, fee: 1.80 }, { max: 20, fee: 1.94 }, { max: 30, fee: 2.43 },
  { max: 40, fee: 2.93 }, { max: 50, fee: 3.43 }
];
export function kinguinFeeEUR(subtotalEUR) {
  const t = KINGUIN_FEE_TIERS.find(x => subtotalEUR <= x.max);
  return t ? t.fee : 3.5;
}

// ---------- Redondeo de Precio ----------
function roundTo990(value) {
  return Math.ceil(value / 1000) * 1000 - 10;
}

// ---------- Precio CLP ----------
/**
 * Calcula el precio en CLP a partir del precio en EUR de una oferta
 * Incluye la fee de Kinguin, el tipo de cambio, el margen y la comisión ML
 * Ahora siempre retorna un resultado usando valores de emergencia si es necesario
 * 
 * @param {number} offerPriceEUR - Precio de la oferta en EUR
 * @returns {Promise<{FX_EUR_CLP: number|null, priceCLP: number|null}>} Tipo de cambio y precio final en CLP o null si hay errores críticos
 */
export async function computePriceCLP(offerPriceEUR) {
  // Validar el precio de entrada
  if (!offerPriceEUR || typeof offerPriceEUR !== 'number' || offerPriceEUR <= 0) {
    console.error(`[Precio] ❌ Precio EUR inválido: ${offerPriceEUR}`);
    return { FX_EUR_CLP: null, priceCLP: null };
  }
  
  try {
    // 1. Obtener tipo de cambio actualizado (ahora siempre devuelve un valor)
    const FX = await getEuroToClp();
    if (!FX || FX <= 0) {
      console.error(`[Precio] ❌ Tipo de cambio inválido: ${FX}`);
      return { FX_EUR_CLP: null, priceCLP: null };
    }
    
    // 2. Calcular costo base (precio + fee)
    const fee = kinguinFeeEUR(offerPriceEUR);
    const costEUR = offerPriceEUR + fee;
    const costCLP = costEUR * FX;
    
    // 3. Aplicar margen según rango de precio
    let margin;
    if (costCLP < 3500) margin = 0.75;       // 75% para productos muy baratos
    else if (costCLP <= 7000) margin = 0.30; // 30% para productos de rango medio
    else margin = 0.30;                      // 30% para productos caros (mínimo establecido)
    
    // 4. Calcular precio final
    let finalCLP = costCLP * (1 + margin);
    
    // 5. Ajustes adicionales
    if (finalCLP < 9990) finalCLP += 700;  // Ajuste para productos muy económicos
    finalCLP = finalCLP * 1.19;            // Factor para compensar comisión ML (aprox)
    finalCLP = roundTo990(finalCLP);       // Redondear a formato psicológico (ej: 9.990, 14.990)
    
    // Registro detallado del cálculo
    console.log(`[Precio] 📊 Cálculo detallado:`);
    console.log(`         - Precio base EUR: ${offerPriceEUR.toFixed(2)}`);
    console.log(`         - Fee Kinguin: ${fee.toFixed(2)} EUR`);
    console.log(`         - Costo total EUR: ${costEUR.toFixed(2)}`);
    console.log(`         - Tipo cambio EUR/CLP: ${FX}`);
    console.log(`         - Costo en CLP: ${costCLP.toFixed(0)}`);
    console.log(`         - Margen aplicado: ${(margin * 100).toFixed(0)}%`);
    console.log(`         - Precio final CLP: ${finalCLP.toFixed(0)}`);
    
    return { FX_EUR_CLP: FX, priceCLP: finalCLP };
  } catch (error) {
    console.error(`[Precio] ❌ Error al calcular precio: ${error.message}`);
    return { FX_EUR_CLP: null, priceCLP: null };
  }
}

// ---------- Título ----------
export function titleFrom(product, productType) {
  const platform = normalizePlatform(product?.platform);
  const baseName = product?.originalName || product?.name || "Videojuego";
  let cleanName = baseName
    .replace(/\b(pc|steam|gog|epic|ubisoft|origin|ea app)\b/gi, '')
    .replace(/\b(key|digital|gift|dlc)\b/gi, '') // NO eliminar "código" para no perder tilde
    .replace(/\s+/g, ' ')
    .trim();
  // Normalizar a Unicode NFC para mantener tildes y ñ correctamente
  cleanName = cleanName.normalize('NFC');

  let suffix = "";
  switch (productType) {
    case "altergift": suffix = `${platform} Altergift`; break;
    case "dlc":       suffix = `${platform} DLC`; break;
    case "account":   suffix = `${platform} Cuenta`; break;
    case "gift":      suffix = `${platform} Steam Gift`; break;
    default:          suffix = `${platform} Código Digital`;
  }
  let finalTitle = `${cleanName} | ${suffix}`;
  if (finalTitle.length > 60) finalTitle = `${cleanName.slice(0, 54 - suffix.length)}... | ${suffix}`;
  return finalTitle;
}

// ---------- Descripción (plantillas texto plano) ----------
export function descriptionFrom(product, productType) {
  const platform = normalizePlatform(product?.platform);
  const baseName = product?.originalName || product?.name || "este producto";
  const horario = "Horario de atención: Lunes a Domingo de 9:00 a 23:00 hrs. Entrega por mensajería de Mercado Libre.";
  const soporte = "Soporte en español durante todo el proceso. Garantía real: si tienes un problema, te ayudamos.";
  const confianza = "Compra segura y atención personalizada. Experiencia comprobada.";
  const urgencia = "¡OFERTA POR TIEMPO LIMITADO! No te pierdas esta oportunidad.";
  const faq = `
PREGUNTAS FRECUENTES:
¿Necesito tarjeta de crédito internacional? NO, solo pagas por MercadoLibre.
¿Hay costos ocultos o adicionales? NO, pagas exactamente el precio publicado.
¿Cuánto tarda la entrega? Durante el horario de atención, una vez confirmado el pago.
¿Es confiable? SÍ, ofrecemos soporte garantizado y atención personalizada.`;
  let descripcion = "";

  if (productType === "gift_card") {
    let cantidad = "";
    const match = /([0-9]+\s?(usd|eur|clp|mxn|\$|€|\₿|\₽|\£|\₺|\₩|\¥|\₴|\₪|\₹|\₫|\₦|\₲|\₵|\₡|\₱|\₸|\₭|\₮|\₠|\₢|\₣|\₤|\₥|\₧|\₨|\₩|\₪|\₫|\₭|\₮|\₯|\₰|\₱|\₲|\₳|\₴|\₵|\₸|\₺|\₼|\₽|\₾|\₿|dólares?|euros?|pesos?|reales?|soles?|libras?|yuanes?|yenes?))/i.exec(baseName);
    if (match) cantidad = match[0].toUpperCase();
    descripcion = `${urgencia}\n\n` +
      `Recarga tu cuenta ${platform} de forma rápida y segura. Confianza garantizada.\n\n` +
      `${baseName} (${cantidad}) para ${platform}.\n\n` +
      `¿Cómo comprar?\n` +
      `1. Compra y paga fácilmente por Mercado Libre.\n` +
      `2. Recibe tu código digital durante el horario de atención.\n` +
      `3. Canjea el saldo y disfruta de tus juegos y contenido favorito.\n\n` +
      `Ventajas de comprar aquí:\n` +
      `- Entrega durante horario de atención: Lunes a Domingo de 9:00 a 23:00 hrs.\n` +
      `- Sin verificaciones adicionales ni requisitos de tarjeta internacional.\n` +
      `- Soporte en español durante todo el proceso.\n` +
      `- Activación garantizada o te devolvemos tu dinero.\n\n` +
      `${horario}\n${soporte}\n${confianza}\n\n` +
      `${faq}\n\n` +
      `Importante: Verifica que tu cuenta sea compatible con la región de la tarjeta antes de comprar. No se aceptan devoluciones por error de región.`;
  } else if (productType === "altergift") {
    descripcion = `${urgencia}\n\n` +
      `¡Consigue ${baseName} en formato Altergift para ${platform}!\n\n` +
      `Compra y paga con Mercado Libre. Recibe un enlace especial: al abrirlo, un bot te agregará como amigo y enviará el juego como regalo a tu biblioteca.\n\n` +
      `¿Cómo funciona?\n` +
      `1. Compra y paga fácilmente.\n` +
      `2. Recibe el enlace especial durante el horario de atención.\n` +
      `3. Acepta la solicitud de amistad y recibe el juego en tu biblioteca.\n\n` +
      `Ventajas:\n` +
      `- Entrega durante horario establecido: Lunes a Domingo de 9:00 a 23:00 hrs.\n` +
      `- Sin verificaciones adicionales ni requisitos de tarjeta internacional.\n` +
      `- Soporte en español durante todo el proceso.\n` +
      `- Activación garantizada o te devolvemos tu dinero.\n\n` +
      `${horario}\n${soporte}\n${confianza}\n\n` +
      `${faq}\n\n` +
      `Importante: Necesitas una cuenta activa en ${platform}. No hay devoluciones una vez enviado el regalo.`;
  } else if (productType === "gift") {
    descripcion = `${urgencia}\n\n` +
      `Disfruta de ${baseName} en formato Steam Gift.\n\n` +
      `Compra y paga con Mercado Libre. Recibe un enlace oficial de Steam para aceptar el regalo con tu cuenta.\n\n` +
      `¿Cómo comprar?\n` +
      `1. Compra y paga fácilmente.\n` +
      `2. Recibe el enlace durante el horario de atención.\n` +
      `3. Acepta el regalo y el juego quedará en tu biblioteca.\n\n` +
      `Ventajas:\n` +
      `- Entrega durante horario establecido: Lunes a Domingo de 9:00 a 23:00 hrs.\n` +
      `- Sin verificaciones adicionales ni requisitos de tarjeta internacional.\n` +
      `- Soporte en español durante todo el proceso.\n` +
      `- Activación garantizada o te devolvemos tu dinero.\n\n` +
      `${horario}\n${soporte}\n${confianza}\n\n` +
      `${faq}\n\n` +
      `Importante: Necesitas cuenta activa en Steam. No hay devoluciones una vez entregado el regalo.`;
  } else if (productType === "account") {
    descripcion = `${urgencia}\n\n` +
      `Accede a una cuenta de ${baseName} para ${platform}.\n\n` +
      `Compra y paga con Mercado Libre. Recibe los datos de acceso y las instrucciones para usar la cuenta.\n\n` +
      `¿Cómo funciona?\n` +
      `1. Compra y paga fácilmente.\n` +
      `2. Recibe los datos de acceso durante el horario de atención.\n` +
      `3. Sigue las instrucciones para acceder y jugar.\n\n` +
      `Ventajas:\n` +
      `- Entrega durante horario establecido: Lunes a Domingo de 9:00 a 23:00 hrs.\n` +
      `- Sin verificaciones adicionales ni requisitos de tarjeta internacional.\n` +
      `- Soporte en español durante todo el proceso.\n` +
      `- Activación garantizada o te devolvemos tu dinero.\n\n` +
      `${horario}\n${soporte}\n${confianza}\n\n` +
      `${faq}\n\n` +
      `Importante: Sigue las instrucciones para mantener el acceso. No hay devoluciones salvo error inicial de acceso.`;
  } else if (productType === "dlc") {
    descripcion = `${urgencia}\n\n` +
      `Expande tu experiencia con el DLC de ${baseName} para ${platform}.\n\n` +
      `Compra y paga con Mercado Libre. Recibe el contenido adicional para tu juego base.\n\n` +
      `¿Cómo funciona?\n` +
      `1. Compra y paga fácilmente.\n` +
      `2. Recibe el código o instrucciones durante el horario de atención.\n` +
      `3. Activa el DLC en tu cuenta de ${platform}.\n\n` +
      `Ventajas:\n` +
      `- Entrega durante horario establecido: Lunes a Domingo de 9:00 a 23:00 hrs.\n` +
      `- Sin verificaciones adicionales ni requisitos de tarjeta internacional.\n` +
      `- Soporte en español durante todo el proceso.\n` +
      `- Activación garantizada o te devolvemos tu dinero.\n\n` +
      `${horario}\n${soporte}\n${confianza}\n\n` +
      `${faq}\n\n` +
      `Importante: Requiere el juego base para funcionar. No hay devoluciones salvo error de activación.`;
  } else {
    // key o default
    descripcion = `${urgencia}\n\n` +
      `Obtén ${baseName} para ${platform} (código digital).\n\n` +
      `Compra y paga con Mercado Libre. Recibe el código digital para activar el juego completo en tu cuenta.\n\n` +
      `¿Cómo comprar?\n` +
      `1. Compra y paga fácilmente.\n` +
      `2. Recibe el código durante el horario de atención.\n` +
      `3. Activa el juego en tu cuenta de ${platform}.\n\n` +
      `Ventajas:\n` +
      `- Entrega durante horario establecido: Lunes a Domingo de 9:00 a 23:00 hrs.\n` +
      `- Sin verificaciones adicionales ni requisitos de tarjeta internacional.\n` +
      `- Soporte en español durante todo el proceso.\n` +
      `- Activación garantizada o te devolvemos tu dinero.\n\n` +
      `${horario}\n${soporte}\n${confianza}\n\n` +
      `${faq}\n\n` +
      `Importante: Una vez entregado el código no hay devoluciones, salvo código defectuoso.`;
  }
  return sanitizeDescriptionForML(descripcion);
}

// ---------- Lógica de Descripción para ML ----------

function sanitizeDescriptionForML(text) {
  if (!text) return "";
  let s = String(text);
  s = s.replace(/[\uD800-\uDFFF]/g, ""); // Quitar emojis / surrogate pairs
  s = s.replace(/[•●▪︎·–—−]/g, "-"); // Normalizar bullets
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); // Normalizar saltos de línea
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[ \t]{2,}/g, " ");
  // Eliminar solo caracteres de control, NO los acentos ni letras latinas
  s = s.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, "");
  // Normalizar a Unicode NFC para mantener tildes y ñ correctamente
  s = s.normalize('NFC');
  return s.trim();
}

function buildSafeFallbackDescription(product) {
  const platform = normalizePlatform(product?.platform);
  const baseName = product?.originalName || product?.name || "este producto";
  return (
`Hola! Vendo ${baseName} ${platform} (código digital).

Videojuego digital completo. Se activa en tu cuenta de ${platform}.

- Entrega en horario de 9:00 a 23:00 hrs.
- Sin devoluciones una vez entregado el código (salvo código defectuoso)
- Garantía: reemplazo o reembolso si se valida un error
- Soporte en español durante la activación`
  );
}

export async function postPlainDescription(mlId, rawDescription, token, product) {
  // Usamos PUT, que es idempotente: crea la descripción si no existe y la actualiza si ya existe.
  const URL = `https://api.mercadolibre.com/items/${mlId}/description`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  let desc = sanitizeDescriptionForML(rawDescription);
  if (!desc) desc = buildSafeFallbackDescription(product);

  await axios.put(URL, { plain_text: desc }, { headers, timeout: 20000 });
}

// ---------- Lógica de Caché para Kinguin ----------

// Variable para importación dinámica con soporte lazy loading
let axiosWithSmartRetry = null;

export async function getKinguinProduct(kinguinId, { KINGUIN_API_KEY }) {
  const kinguinIdStr = String(kinguinId);

  // En entornos de producción como Vercel, el KINGUIN_API_KEY debería estar disponible
  // No lanzamos error inmediatamente para permitir que se ejecute en Vercel
  if (!KINGUIN_API_KEY) {
    console.warn(`[Kinguin API] ⚠️ KINGUIN_API_KEY no está configurada`);
  }

  // Importar la utilidad de HTTP sólo cuando sea necesario
  if (!axiosWithSmartRetry) {
    const httpUtils = await import('./_http-utils');
    axiosWithSmartRetry = httpUtils.axiosWithSmartRetry;
  }

  // Siempre obtener de Kinguin API
  console.log(`[Kinguin API] 🔄 Obteniendo producto de Kinguin API para ID: ${kinguinIdStr}`);
  
  try {
    // Usar la función con reintentos inteligentes
    const { data: productData } = await axiosWithSmartRetry(
      `https://gateway.kinguin.net/esa/api/v1/products/${kinguinIdStr}`,
      null,
      {
        headers: { "X-Api-Key": KINGUIN_API_KEY },
        timeout: 15000,
        retries: 5,
        baseDelay: 500,
        onRetry: ({ attempt, maxAttempts, delay, isRateLimitError }) => {
          console.log(
            `[Kinguin API] ⚠️ Reintentando petición para ID ${kinguinIdStr} (${attempt}/${maxAttempts}) en ${Math.round(delay)}ms - ${
              isRateLimitError ? 'Error 429 (too many requests)' : 'Error de conexión'
            }`
          );
        }
      }
    );
    
    // Verificar estructura básica de la respuesta
    if (!productData || typeof productData !== 'object') {
      throw new Error(`Respuesta inválida de la API de Kinguin para ID ${kinguinIdStr}`);
    }
    
    return productData;
  } catch (error) {
    // Mejorar mensajes de error específicos
    if (error.response?.status === 401) {
      console.error(`[Kinguin API] ❌ ERROR DE AUTENTICACIÓN: API key inválida o expirada`);
      throw new Error(`Error de autenticación con la API de Kinguin (401). Verifica KINGUIN_API_KEY en las variables de entorno de Vercel.`);
    } 
    else if (error.response?.status === 404) {
      console.error(`[Kinguin API] ❌ PRODUCTO NO ENCONTRADO: ID ${kinguinIdStr} no existe`);
      throw new Error(`El producto con ID ${kinguinIdStr} no existe en Kinguin.`);
    }
    else if (error.response?.status === 429) {
      console.error(`[Kinguin API] ❌ LÍMITE DE TASA EXCEDIDO: Demasiadas peticiones a la API`);
      throw new Error("Se ha excedido el límite de peticiones a la API de Kinguin. Intenta nuevamente más tarde.");
    }
    
    // Para otros errores, propagar el error original
    console.error(`[Kinguin API] ❌ ERROR: ${error.message}`);
    throw error;
  }
}