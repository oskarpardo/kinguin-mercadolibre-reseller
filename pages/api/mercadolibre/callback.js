import axios from "axios";
import qs from "qs";

export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: "Authorization code required" });
  }

  try {
    // Intercambiar código por token con redirect_uri fijo
    const tokenResponse = await axios.post(
      "https://api.mercadolibre.com/oauth/token",
      qs.stringify({
        grant_type: "authorization_code",
        client_id: process.env.ML_APP_ID,
        client_secret: process.env.ML_CLIENT_SECRET,
        code,
        redirect_uri: "https://kinguin-ml-reseller.vercel.app/api/mercadolibre/callback"
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );

    const { access_token, refresh_token, user_id } = tokenResponse.data;

    // Por ahora solo log para probar (luego guardar en DB)
    console.log("Access Token:", access_token);
    console.log("Refresh Token:", refresh_token);
    console.log("User ID:", user_id);

    res.redirect("/dashboard?auth=success");
  } catch (error) {
    console.error("OAuth Error:", error.response?.data || error.message);
    res.status(500).json({
      error: "Failed to authenticate with MercadoLibre",
      details: error.response?.data || error.message
    });
  }
}
