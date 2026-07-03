# Seguridad del cliente — módulos sensibles (Fase 11 / 13)

Este documento lista los archivos "sensibles" del cliente Electron: la lógica de
licencia, integridad y anti-manipulación. Es la **lista blanca** para la Fase 13
(compilar a bytecode con bytenode y/u ofuscar con agresividad máxima).

> Regla obfuscation-safe: estos módulos exportan una API estable con **strings
> literales** y se importan con `require('ruta/literal')` (sin rutas dinámicas), para
> sobrevivir a la ofuscación. No dependen de `fn.name`, `toString()` ni `eval`.

## Módulos sensibles (candidatos a bytenode/ofuscación en Fase 13)

| Archivo | Rol | Estado |
|---|---|---|
| `src/security/clock.js` | Anti-rollback del reloj (lógica pura) | ✅ creado (Fase 11.2) |
| `src/security/token.js` | Anti-replay del token (`jti`/`iat`, lógica pura) | ✅ creado (Fase 11.5) |
| `src/security/offline.js` | Bloqueo por offline prolongado (lógica pura) | ✅ creado (Fase 11.3) |
| `src/security/hwid.js` | Huella de hardware multi-señal (fail-safe, sin archivo portátil) | ✅ creado (Fase 11.4) |
| `src/security/updateVerify.js` | Verificación de firma+hash de actualizaciones (anti-RCE) | ✅ creado (Fase 12) |
| `src/security/resourceCrypto.js` | Primitivas de cifrado de recursos ligado a licencia | ✅ creado (Fase 11.6) |
| `src/security/watermark.js` | Watermark por licencia (trazabilidad de fugas) | ✅ creado (Fase 11.7) |
| `src/utils/license.js` | Verificación de token firmado (RSA), HWID, caché cifrada, estado de la app | existente |
| `controllers/license.controller.js` | Activación, heartbeat, trial (habla con el servidor) | existente |
| `src/utils/adminUnlock.js` | Desbloqueo admin para acciones sensibles | existente |
| `src/utils/accessGate.js` | Decisión de acceso (gate de licencia + LAN) | existente |
| `preload.js` | Puente IPC con whitelist | existente (⚠️ ver 13.3: probar ofuscación sin romper contextIsolation) |

## Pendiente de aislar en `src/security/` (Fase 11.1)

A medida que se implementen, mover/crear aquí:
- `src/security/integrity.js` — self-check de integridad en runtime (Fase 11.8).

## Notas para la Fase 13 (blindaje final)

- Compilar `.jsc` con **Electron 22.3.27 / ia32** (bytecode atado a versión+arch).
- Mantener stubs `.js` mínimos (`module.exports = require('./modulo.jsc')`).
- No ofuscar de forma que rompa `preload.js`/contextIsolation sin probarlo.
- El self-check de integridad (11.8) y el bytecode se activan **solo en producción**.
