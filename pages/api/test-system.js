export default async function handler(req, res) {
  try {
    // Test simple para verificar que no hay problemas de variables
    const testArray = [1, 2, 3];
    const result = testArray.map(item => item * 2);
    
    return res.status(200).json({
      message: "Sistema funcionando correctamente",
      test_result: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
}