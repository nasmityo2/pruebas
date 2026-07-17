# Script para publicar actualizaciones de Stokko
# Uso: .\publish-update.ps1 -version "1.2.0" -url "https://github.com/.../app.exe" -changelog "Mejoras en POS", "Corrección en reportes"

param (
    [string]$version = "1.1.26.3.23",
    [string]$url = "https://tu-repositorio.com/descargas/Stokko_Setup.exe",
    [string[]]$changelog = @("Actualización de mantenimiento", "Mejoras de estabilidad"),
    [string]$description = "Una nueva versión de Stokko está lista para descargar.",
    # La API key se lee del entorno (SHARED_API_KEY). Sin fallback hardcodeado.
    [string]$apiKey = $env:SHARED_API_KEY,
    [string]$serverUrl = "http://localhost:3000" # Cambiar al dominio real en producción
)

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    Write-Host "[ERROR] Falta la API key. Define la variable de entorno SHARED_API_KEY o pásala con -apiKey." -ForegroundColor Red
    exit 1
}

$body = @{
    version = $version
    downloadUrl = $url
    changelog = $changelog
    description = $description
    mandatory = $false
} | ConvertTo-Json

$headers = @{
    "Content-Type" = "application/json"
    "x-api-key" = $apiKey
}

Write-Host "Enviando señal de actualización $version a $serverUrl..." -ForegroundColor Cyan

try {
    $response = Invoke-RestMethod -Uri "$serverUrl/api/update/publish" -Method Post -Headers $headers -Body $body
    Write-Host "¡Éxito! Servidor respondió: $($response.message)" -ForegroundColor Green
} catch {
    Write-Host "Error al publicar la actualización: $_" -ForegroundColor Red
}
