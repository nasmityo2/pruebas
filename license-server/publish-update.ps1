# Script para publicar actualizaciones de BodegApp
# Uso: .\publish-update.ps1 -version "1.2.0" -url "https://github.com/.../app.exe" -changelog "Mejoras en POS", "Corrección en reportes"

param (
    [string]$version = "1.1.26.3.23",
    [string]$url = "https://tu-repositorio.com/descargas/BodegApp_Setup.exe",
    [string[]]$changelog = @("Actualización de mantenimiento", "Mejoras de estabilidad"),
    [string]$description = "Una nueva versión de BodegApp está lista para descargar.",
    [string]$apiKey = "bodegapp-master-key-2026",
    [string]$serverUrl = "http://localhost:3000" # Cambiar al dominio real en producción
)

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
