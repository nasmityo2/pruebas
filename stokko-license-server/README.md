# Stokko License Server

Servicio desplegable independiente de la aplicación Electron. La autoridad de emisión, la clave privada y los datos de licencias viven únicamente en el entorno del servidor.

## Límites

- No forma parte del paquete ni del instalador de Stokko.
- Usa su propio `package.json`, lockfile, instalación y proceso de CI.
- La configuración sensible se inyecta por entorno o secret manager.
- `private.key`, bases de datos, logs y datos runtime nunca se versionan.
- `scripts/configure-acl.ps1` restringe la carpeta de despliegue a la identidad del servicio, SYSTEM y administradores.

## Desarrollo aislado

```powershell
npm ci
$env:DATA_DIR = Join-Path $env:TEMP 'stokko-license-server-dev'
npm start
```

Para pruebas automatizadas se generan claves efímeras dentro de un directorio temporal. Una clave de prueba nunca debe reutilizarse en producción.
