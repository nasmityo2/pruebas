@echo off
:: Check for administrative privileges
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [INFO] Ejecutando como administrador...
) else (
    echo [ERROR] Por favor, ejecuta este archivo como Administrador.
    echo Haz clic derecho sobre este archivo y selecciona "Ejecutar como administrador".
    pause
    exit /b
)

echo [INFO] Configurando reglas de Firewall de Windows para BodegApp...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-NetFirewallRule -DisplayName 'BodegApp - Servidor POS' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName 'BodegApp - Servidor POS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 53050-53060 -Description 'Permite conexion en red local para el sistema POS de BodegApp' -ErrorAction SilentlyContinue"

echo [SUCCESS] Reglas de firewall configuradas con exito.
echo Ya puedes cerrar esta ventana.
pause
