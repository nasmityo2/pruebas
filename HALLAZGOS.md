# Hallazgos de finalización y seguridad de Stokko

Este registro no incluye valores de secretos, tokens, licencias ni datos personales.

## H-001 — Material sensible en la entrega

- Severidad: crítica.
- Ubicación: archivos ignorados del árbol recibido y archivos ZIP de entrega.
- Reproducción: inventario de nombres del árbol inicial; no se leyeron ni imprimieron valores.
- Impacto: una clave privada de licencias o credencial incluida en una entrega debe considerarse comprometida.
- Corrección: pendiente de Fase 1: cuarentena/eliminación, rotación externa, nueva autoridad y guard ampliado.
- Prueba: pendiente de escaneo de árbol, historial y artefactos.

## H-002 — Pipeline de protección incompleto

- Severidad: crítica.
- Ubicación: `forge.config.js`, `scripts/apply-fuses.js`, `scripts/gen-integrity-manifest.js`.
- Reproducción: `package.json` no integra fuses, bundle, bytecode, ofuscación ni inspección en un comando de release.
- Impacto: el ASAR actual distribuye JavaScript original legible.
- Corrección: pendiente de Fases 7, 8 y 12.
- Prueba: extracción hostil de ASAR e instalador al cerrar el release.

## H-003 — Superficies renderer/API sin cerrar

- Severidad: alta.
- Ubicación: `public/`, `main.js`, `server.js`, controladores y rutas.
- Reproducción: auditoría inicial identifica sinks HTML, ausencia de sandbox/política completa de navegación, impresión remota y autorización insuficiente por endpoint.
- Impacto: XSS, abuso de IPC/API local/LAN y exposición de capacidades nativas.
- Corrección: pendiente de Fases 4 y 5.
- Prueba: tests adversariales XSS, IPC, origen, roles, impresión y shell injection.

## H-004 — Documentación histórica contradice el estado real

- Severidad: media.
- Ubicación: `docs/`, `INVENTARIO.md`, scripts de release y código.
- Reproducción: documentos previos declaran fases completadas mientras fuses y protección de código siguen manuales.
- Impacto: falsa confianza operativa y releases no verificables.
- Corrección: `PLAN.md` y evidencia ejecutada pasan a ser la fuente de verdad; documentación antigua se archivará fuera del producto.
- Prueba: puerta final y `release:secure`.

## H-005 — `npm ci` dependía de ClangCL por el addon de impresión

- Severidad: alta (reproducibilidad/release).
- Ubicación: `package.json`, `main.js`.
- Reproducción: `npm ci` con Node 24.15.0/npm 11.12.1 terminó con `MSB8020` al compilar `@thesusheer/electron-printer`.
- Impacto: una instalación limpia no era reproducible y el addon debía reconstruirse para dos arquitecturas antiguas.
- Corrección: dependencia retirada; inventario e impresión migrados a APIs `webContents` de Electron; entrada binaria rechazada y texto escapado/limitado.
- Prueba: segundo `npm ci` raíz, 819 paquetes, exit code 0; regresión IPC/impresión pendiente de Fase 5.
