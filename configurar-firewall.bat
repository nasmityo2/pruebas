@echo off
:: BodegApp - Apertura de firewall para acceso LAN (uso OPCIONAL y manual).
:: No abre nada por defecto: debes pasar el puerto que usa la app.
:: Uso:  configurar-firewall.bat 53050
setlocal

net session >nul 2>&1
if %errorLevel% == 0 (
    echo [INFO] Ejecutando como administrador...
) else (
    echo [ERROR] Ejecuta este archivo como Administrador.
    echo Haz clic derecho y selecciona "Ejecutar como administrador".
    pause
    exit /b
)

set "PORT=%~1"
if "%PORT%"=="" (
    echo [ERROR] Debes indicar el puerto. Ejemplo: configurar-firewall.bat 53050
    echo El puerto exacto aparece en BodegApp ^> Configuracion ^> Acceso movil.
    pause
    exit /b
)

echo [INFO] Abriendo SOLO el puerto %PORT% para BodegApp (perfil de red Privada)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-NetFirewallRule -DisplayName 'BodegApp - Servidor POS' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName 'BodegApp - Servidor POS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort %PORT% -Profile Private -Description 'Permite conexion en red local para BodegApp' -ErrorAction SilentlyContinue"

echo [SUCCESS] Regla creada para el puerto %PORT%.
echo Para revertir: elimina la regla 'BodegApp - Servidor POS' en el Firewall de Windows.
pause
