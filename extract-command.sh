#!/bin/bash

# 🔍 EXTRAER CONFIGURACIÓN DE MERCADOLIBRE
# Comando para Linux - Copia y pega en tu terminal

echo "🔍 Extrayendo configuración de MLC83928932..."
curl -s "https://kinguin-ml-reseller.vercel.app/api/extract-ml-config?item_id=MLC83928932" | jq .

# Si no tienes jq instalado, usa este comando simple:
# curl "https://kinguin-ml-reseller.vercel.app/api/extract-ml-config?item_id=MLC83928932"

# Para extraer solo el código a replicar:
echo ""
echo "📋 CÓDIGO PARA REPLICAR:"
curl -s "https://kinguin-ml-reseller.vercel.app/api/extract-ml-config?item_id=MLC83928932" | jq -r .replicate_code

# Para probar con otros items, cambia el MLC:
# curl "https://kinguin-ml-reseller.vercel.app/api/extract-ml-config?item_id=MLC1234567890"