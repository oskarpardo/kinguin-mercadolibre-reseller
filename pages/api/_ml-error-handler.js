// Utilidad para manejar errores 400 de MercadoLibre
// Este archivo contiene funciones para recuperarse de errores comunes
// en las solicitudes a la API de MercadoLibre

import axios from 'axios';
import { logActivity } from './_logic';
import { axiosWithSmartRetry } from './_http-utils';

/**
 * Analiza un error 400 de MercadoLibre y proporciona información sobre cómo manejarlo
 * @param {Error} error - El error capturado
 * @returns {Object} Información sobre el error y posibles acciones correctivas
 */
export async function analyzeMercadoLibreError(error, jobId = null) {
  // Verificar si es un error 400
  if (error.response && error.response.status === 400) {
    const errorData = error.response.data || {};
    let errorMessage = errorData.message || 'Error 400 en la solicitud a MercadoLibre';
    let errorCause = '';
    
    // Extraer información más específica del cause
    if (errorData.cause) {
      if (Array.isArray(errorData.cause)) {
        // Múltiples errores
        errorCause = errorData.cause.map(c => 
          typeof c === 'object' ? 
            `${c.code || 'ERR'}: ${c.message || c}` : 
            c.toString()
        ).join(' | ');
      } else if (typeof errorData.cause === 'object') {
        // Un solo error estructurado
        errorCause = `${errorData.cause.code || 'ERROR'}: ${errorData.cause.message || errorData.cause}`;
      } else {
        // Texto plano
        errorCause = errorData.cause.toString();
      }
    }
    
    // Si tenemos causa específica, incluirla en el mensaje principal
    if (errorCause && errorCause !== errorMessage) {
      errorMessage = `${errorMessage} - ${errorCause}`;
    }
    
    // Registrar el error para análisis
    await logActivity(`Error 400 de MercadoLibre: ${errorMessage}`, 'error', {
      error: errorMessage,
      cause: errorCause,
      rawCause: errorData.cause,
      details: errorData
    }, jobId);
    
    // Categorizar el error y sugerir acciones
    let category = 'unknown';
    let recoveryAction = null;
    
    const fullErrorText = `${errorMessage} ${errorCause}`.toLowerCase();
    
    // Error de título (muy común)
    if (fullErrorText.includes('title') || fullErrorText.includes('título')) {
      category = 'title_error';
      recoveryAction = {
        type: 'title_correction',
        description: 'Error en el título del producto. Puede ser muy largo, muy corto o contener caracteres inválidos.',
        canRetry: true
      };
    }
    // Error de precio
    else if (fullErrorText.includes('price') || fullErrorText.includes('precio')) {
      category = 'price_error';
      recoveryAction = {
        type: 'price_correction',
        description: 'Error en el precio. Debe ser un número válido y estar en el rango permitido.',
        canRetry: true
      };
    }
    // Error de categoría
    else if (fullErrorText.includes('category') || fullErrorText.includes('categoría')) {
      category = 'category_error';
      recoveryAction = {
        type: 'category_correction',
        description: 'La categoría especificada no es válida o no existe.',
        canRetry: false
      };
    }
    // Error de imágenes
    else if (fullErrorText.includes('picture') || fullErrorText.includes('image') || fullErrorText.includes('foto')) {
      category = 'image_error';
      recoveryAction = {
        type: 'image_correction',
        description: 'Error con las imágenes del producto. URLs inválidas o formato no soportado.',
        canRetry: true
      };
    }
    // Error de descripción
    else if (fullErrorText.includes('description') || fullErrorText.includes('descripción')) {
      category = 'description_error';
      recoveryAction = {
        type: 'description_correction',
        description: 'Error en la descripción del producto. Puede ser muy larga o contener HTML inválido.',
        canRetry: true
      };
    }
    // Error de atributos
    else if (fullErrorText.includes('attributes') || fullErrorText.includes('atributos')) {
      category = 'attributes_error';
      recoveryAction = {
        type: 'attributes_correction',
        description: 'Los atributos proporcionados son inválidos o insuficientes para esta categoría.',
        canRetry: true
      };
    }
    // Error de validación general
    else if (fullErrorText.includes('validation') || fullErrorText.includes('validación')) {
      category = 'validation_error';
      recoveryAction = {
        type: 'validation_correction',
        description: 'Error de validación general. Revisa todos los campos del producto.',
        canRetry: true
      };
    }
    // Error de token
    else if (errorMessage.includes('token') || errorCause?.includes('token') || errorCause?.includes('auth')) {
      category = 'auth_error';
      recoveryAction = {
        type: 'token_refresh',
        description: 'Error de autenticación. Se requiere refrescar el token.',
        canRetry: true
      };
    }
    
    return {
      status: 400,
      category,
      message: errorMessage,
      cause: errorCause,
      details: errorData,
      recoveryAction,
      original: error
    };
  }
  
  // Para otros tipos de errores, devolver información general
  return {
    status: error.response?.status || 'unknown',
    category: 'general_error',
    message: error.message,
    cause: error.response?.data || error.cause,
    recoveryAction: null,
    original: error
  };
}

/**
 * Intenta recuperarse de un error 400 en MercadoLibre
 * @param {Object} errorAnalysis - El análisis del error
 * @param {Object} params - Parámetros para la recuperación
 * @returns {Object} Resultado del intento de recuperación
 */
export async function recoverFromMercadoLibreError(errorAnalysis, params, jobId = null) {
  const { ml_id, ml_token, productData } = params;
  
  if (!errorAnalysis.recoveryAction || !errorAnalysis.recoveryAction.canRetry) {
    return { 
      success: false, 
      reason: 'no_recovery_possible',
      message: 'No es posible recuperarse automáticamente de este error'
    };
  }
  
  // Intentar recuperarse según el tipo de error
  switch (errorAnalysis.recoveryAction.type) {
    case 'price_correction':
      // Intentar actualizar el producto sin incluir el precio
      try {
        const { title, description } = params;
        
        // Actualizar solo el título
        if (title) {
          await axiosWithSmartRetry(
            `https://api.mercadolibre.com/items/${ml_id}`,
            { title },
            {
              method: 'put',
              headers: { 'Authorization': `Bearer ${ml_token}` }
            }
          );
          
          await logActivity(`Recuperación exitosa: se actualizó el título omitiendo el precio`, 'success', null, jobId);
        }
        
        // Actualizar la descripción
        if (description) {
          await axiosWithSmartRetry(
            `https://api.mercadolibre.com/items/${ml_id}/description`,
            { plain_text: description },
            {
              method: 'put',
              headers: { 'Authorization': `Bearer ${ml_token}` }
            }
          );
          
          await logActivity(`Recuperación exitosa: se actualizó la descripción omitiendo el precio`, 'success', null, jobId);
        }
        
        return { 
          success: true, 
          message: 'Se actualizaron algunos campos omitiendo el precio',
          updatedFields: [title ? 'title' : null, description ? 'description' : null].filter(Boolean)
        };
      } catch (recoveryError) {
        await logActivity(`Error en recuperación de error de precio: ${recoveryError.message}`, 'error', null, jobId);
        return { 
          success: false, 
          reason: 'recovery_failed',
          message: `La recuperación falló: ${recoveryError.message}`
        };
      }
      
    case 'token_refresh':
      // No podemos refrescar el token automáticamente aquí
      // Se sugiere implementar un endpoint específico para esto
      return { 
        success: false, 
        reason: 'token_refresh_required',
        message: 'Es necesario refrescar el token de acceso'
      };
      
    default:
      return { 
        success: false, 
        reason: 'recovery_not_implemented',
        message: `No hay implementación para recuperarse de ${errorAnalysis.recoveryAction.type}`
      };
  }
}