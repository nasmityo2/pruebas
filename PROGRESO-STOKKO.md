# Progreso de finalización de Stokko

La evidencia ejecutada prevalece sobre documentación histórica. Los resultados se registran sin secretos ni datos personales.

## Fase 0 — Baseline limpia y recuperación

### Rama de trabajo

- Fecha: 2026-07-17
- Archivos cambiados: ninguno.
- Comando: `git switch -c feat/stokko-complete-hardening`
- Resultado: exit code 0; rama creada desde `db09f04bdfef703e7df7360ab84d0f5678894719`.
- Evidencia: `RELEASE-EVIDENCE/baseline-git-status.txt`.
- Commit: pendiente del commit atómico de Fase 0.
- Riesgo residual: ninguno.

### Backup externo verificado

- Fecha: 2026-07-17
- Archivos cambiados: ninguno dentro del repositorio.
- Comandos: `tar.exe -a -cf "D:\bodegapp-backups\bodegapp-pre-stokko-20260717T0353.zip" -C "D:\bodegapp" .`; `tar.exe -tf ...`; `certutil.exe -hashfile ... SHA256`.
- Resultado: archive y listado exit code 0; 196098806 bytes; SHA-256 `dcd31ff27901819b6ea1aaedca539bffcb2d737c76b899bad407b253700911c4`.
- Evidencia: `RELEASE-EVIDENCE/baseline-git-status.txt`.
- Commit: no aplica (backup externo).
- Riesgo residual: el backup contiene el material recibido y se conserva fuera del repositorio como copia de recuperación; debe tratarse como sensible.

### Normalización EOL

- Fecha: 2026-07-17
- Archivos cambiados: `.gitattributes`.
- Comandos: `git ls-files --eol`; `git add --renormalize .`; `git diff --cached --check`; `git diff --cached --stat`.
- Resultado: exit code 0; no se generaron cambios masivos; solo quedó el cambio preexistente de `public/activacion.html`.
- Commit: pendiente del commit atómico de Fase 0.
- Riesgo residual: los scripts `.bat`, `.cmd` y `.ps1` conservan CRLF; el resto de texto usa LF.

### Baseline y tag

- Fecha: 2026-07-17
- Archivos cambiados: `RELEASE-EVIDENCE/baseline-git-status.txt`.
- Comandos: `git status --porcelain=v1 --branch`; `git tag -a pre-stokko-audit db09f04bdfef703e7df7360ab84d0f5678894719 -m "Baseline before Stokko hardening"`; `git rev-list -n 1 pre-stokko-audit`.
- Resultado: tag verificado sobre `db09f04bdfef703e7df7360ab84d0f5678894719`.
- Commit: pendiente del commit atómico de Fase 0.
- Riesgo residual: la modificación previa de `public/activacion.html` está respaldada y se integrará sin perderla.

### Instalación limpia desde lockfiles

- Fecha: 2026-07-17
- Archivos cambiados: `package.json`, `package-lock.json`, `main.js`.
- Comandos: `npm ci` (raíz); `npm ci` (`license-server`); tras reproducir el fallo, `npm pkg delete "dependencies.@thesusheer/electron-printer"` y `npm install --package-lock-only --ignore-scripts`; `npm ci` (raíz, repetición).
- Resultado: servidor: 86 paquetes instalados, exit code 0; raíz inicial: exit code 1 por toolset ClangCL requerido por `@thesusheer/electron-printer`; corrección aplicada con impresión basada en `webContents`; raíz final: 819 paquetes instalados, exit code 0.
- Conteo de auditoría observado: raíz 45 vulnerabilidades declaradas por npm; servidor 4. Se clasifican y corrigen en Fase 9, no se ocultan.
- Commit: pendiente del commit atómico de Fase 0.
- Riesgo residual: la ruta RAW binaria no tenía consumidores en el repositorio y ahora se rechaza; impresión de texto usa renderizado seguro de Electron y se cubrirá con regresión.

### Regresión y paquete de baseline

- Fecha: 2026-07-17
- Archivos cambiados: `public/css/output.css` generado e ignorado; `out/` generado e ignorado.
- Comandos: `npm test`; `npm run build:css:prod`; `npm run check:secrets`; `npm run package`.
- Resultado: tests 85/85 pass, 0 fail, 0 skipped, 0 todo; CSS exit code 0; guard exit code 0; Forge package win32-x64 exit code 0.
- Artefacto baseline: `out/bodegapp-win32-x64/` (no es un release aceptable; todavía contiene fuente original y marca anterior).
- Commit: pendiente del commit atómico de Fase 0.
- Riesgo residual: el guard baseline solo cubre el conjunto empaquetable y el paquete aún no está blindado; ambos se endurecen en las fases correspondientes.

### Smokes de backend y shell Electron

- Fecha: 2026-07-17
- Archivos cambiados: `scripts/smoke-backend.js`, `scripts/smoke-electron.js`, `main.js`, `server.js`, `src/utils/localBackup.js`, `package.json`.
- Comando: `npm run test:smoke`.
- Resultado inicial: backend OK y Electron exit code 1; causa raíz: el handler `before-quit` cargaba `bcvUpdater` durante el cierre y, por efecto lateral, intentaba abrir `better-sqlite3` con ABI Node desde Electron.
- Corrección y regresión: el cierre solo detiene módulos ya cargados y todos los timers tienen `stop`; repetición: `[STOKKO_BACKEND_SMOKE_OK]` y `[STOKKO_ELECTRON_SMOKE_OK]`, exit code 0.
- Aislamiento: ambos smokes usan directorios temporales separados para `APPDATA`/`PROGRAMDATA` y los eliminan al terminar.
- Commit: pendiente del commit atómico de Fase 0.
- Riesgo residual: este smoke valida arranque real de backend y shell Electron, no reemplaza el E2E visual del instalador final.

### Inventario técnico

- Fecha: 2026-07-17
- Archivos cambiados: `RELEASE-EVIDENCE/architecture-inventory.md`.
- Comandos: búsquedas `rg` documentadas en la evidencia.
- Resultado: 112 rutas de routers + 2 Fastify directas; 19 tablas persistentes; 2 migraciones versionadas; 9 canales IPC; 14 documentos HTML; ventanas principal/impresión/PDF/smoke y tray inventariados.
- Evidencia: `RELEASE-EVIDENCE/architecture-inventory.md`.
- Commit: pendiente del commit atómico de Fase 0.
- Riesgo residual: el inventario describe el código actual; el pipeline final repetirá inventarios automatizados para detectar deriva.
