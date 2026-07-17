# Acciones externas obligatorias

Estas acciones no pueden ejecutarse desde el repositorio ni desde la máquina de build del cliente. No se registran valores sensibles.

## EA-001 — Revocación y rotación de autoridad de licencias

- Estado: requiere acceso autorizado al VPS/HSM/secret manager.
- Acción: revocar la clave privada recibida y retirar su `kid` de emisión; mantener su clave pública únicamente durante la ventana de migración controlada si existen licencias legítimas que deban convertirse.
- Acción: rotar `SECRET_KEY`, `SHARED_API_KEY`, credenciales admin y cualquier credencial presente en los `.env` recibidos.
- Acción: invalidar sesiones/JWT y tokens de activación emitidos por los secretos comprometidos.
- Verificación requerida: un token nuevo firmado con la autoridad anterior debe fallar; una sesión anterior debe recibir 401/403; la auditoría remota debe registrar la rotación sin almacenar secretos.
- Propietario: administrador autorizado del servidor de licencias.

## EA-002 — Nueva clave de producción

- Estado: requiere entorno de servidor separado.
- Acción: generar la nueva clave de firma en VPS/HSM/secret manager, asignar `kid`, exportar solo la clave pública y conservar la privada con ACL de servicio.
- Verificación requerida: permisos mínimos, backup cifrado probado y firma/verificación de un vector no sensible.
- Prohibición: no copiar la clave privada al repositorio, al artefacto, a CI sin secret manager ni a la máquina de build del cliente.

## EA-003 — Firma Authenticode

- Estado: requiere certificado comercial o identidad de firma administrada.
- Acción: configurar el pipeline con el certificado cuando esté disponible y validar publisher/timestamp.
- Mientras tanto: el build local debe quedar marcado como unsigned y conservar firma criptográfica propia de updates e integridad.

## EA-004 — Matriz física de Windows

- Estado: requiere VMs/hardware Windows 7 y Windows 10/11 x64/ia32.
- Acción: ejecutar el checklist generado por el pipeline sobre instalación, actualización, reparación, migración, impresión y desinstalación.
