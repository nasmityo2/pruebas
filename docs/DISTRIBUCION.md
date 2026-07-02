# Distribución y build seguro — BodegApp

Documento de la Fase 10. Cubre: empaquetado sin secretos, soporte Windows 7 / 32-bit,
el warning de SmartScreen (sin certificado de firma), estrategia de auto-update y separación de repos.

## 1. Guard anti-filtraciones (obligatorio antes de empaquetar)

- `npm run check:secrets` recorre **lo que se empaquetaría** (aplicando el mismo predicado de
  exclusión que Electron Forge, en `scripts/packaging-ignore.js`) y **aborta** si encuentra:
  - Archivos prohibidos: `private.key`, `public.key`, `*.key`, `*.pem`, `.env`/`.env.*` (excepto `.env.example`),
    `*.lic`, `*.db`, `*.sqlite`, `licenses.json`, `users.json`, `invites.json`, `activation_tokens.json`,
    `trials.json`, `backup.key`.
  - Contenido sospechoso: bloques `BEGIN PRIVATE KEY`, y los secretos filtrados históricos.
- Está enganchado de dos formas:
  - Scripts npm: `prepackage` y `premake` ejecutan el guard automáticamente antes de `package`/`make`.
  - Hook `prePackage` de Electron Forge en `forge.config.js` (defensa en profundidad).
- Carpetas excluidas del paquete: `license-server/`, `test/`, `docs/`, `scripts/`, `scratch/`, `backups/`,
  `out/`, `dist/`, `build/`, `.git/`, etc. El **servidor de licencias (con la clave privada) NUNCA** se empaqueta con el cliente.

## 2. Soporte Windows 7 y 32-bit (ia32)

- Se mantiene **Electron 22.3.27** (última rama con soporte Windows 7/8).
- Build 64-bit: `npm run make`. Build 32-bit: `npm run build:32` (equivale a `make --arch=ia32`).
- El maker WiX mapea `ia32 → x86` (ver `forge.config.js`).
- No subir Electron por encima de la v22 sin renunciar a Windows 7.

## 3. Sin certificado de firma → warning de SmartScreen

- El instalador **no está firmado** (decisión del dueño: no se comprará certificado).
- En Windows, al ejecutar el instalador, SmartScreen mostrará **"Windows protegió tu PC"**.
- Instrucción para el cliente final:
  1. Clic en **"Más información"**.
  2. Clic en **"Ejecutar de todas formas"**.
- El warning desaparece con reputación (muchas descargas) o con un certificado EV. Documentarlo en el material de soporte/instalación.

## 4. Estrategia de auto-update

- El cliente ya consulta al servidor de licencias en el heartbeat (`/api/verify` → campo `update`).
- Recomendado:
  - **Canal estable único**: el dueño publica una versión con `node license-server/... update/publish` (requiere login admin).
  - **Actualización opcional** por defecto (el usuario decide), con posibilidad de marcarla **obligatoria** (`mandatory: true`)
    para versiones críticas de seguridad; en ese caso el cliente exige actualizar antes de continuar.
  - El binario se descarga desde una URL servida por el **futuro VPS** (no un dominio hardcodeado; se configura en el servidor).
- Hoy la publicación exige **login admin** (ya no la API key compartida).

## 5. Separación de repositorios (recomendado por seguridad)

Separar en tres repos reduce el riesgo de filtrar la clave privada junto al cliente:

- `bodegapp-client` — la app Electron (este repo, sin `license-server/`).
- `bodegapp-license-server` — el servidor de licencias con la **clave privada** (solo en el servidor/VPS, secretos por entorno).
- `bodegapp-backup` — (opcional) servicio de respaldo en la nube, cuando se habilite.

Beneficios: la clave privada vive en un repo/entorno distinto al del cliente; permisos de acceso independientes;
despliegues y rotaciones de secretos aislados.

## 6. Checklist de release

1. `npm test` → 36/36 verde.
2. `npm run check:secrets` → sin hallazgos.
3. `npm run build:css:prod`.
4. `npm run make` (64-bit) y/o `npm run build:32` (32-bit).
5. Verificar que el `out/` no contiene `.env`, `.key`, `.db`, ni `license-server/`.
6. Publicar update apuntando al VPS (login admin).
