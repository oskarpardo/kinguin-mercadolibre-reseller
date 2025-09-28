// Endpoint ultra-simple para verificar si el problema está en las importaciones
export default async function handler(req, res) {
  try {
    // Test básico sin ninguna importación problemática
    const testVar = "hello";
    const anotherVar = "world";
    
    return res.status(200).json({
      success: true,
      message: `${testVar} ${anotherVar}`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
}