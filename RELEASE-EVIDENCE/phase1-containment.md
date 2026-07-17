# Evidencia de Fase 1 — Contención

Fecha: 2026-07-17

## Material retirado

Se eliminaron del árbol de trabajo, sin mostrar valores: `.env` cliente/servidor, licencia local, clave privada/pública recibida, JSON runtime de licencias/usuarios/trials, log de acceso y ZIP de entrega. `git status --ignored --short` quedó limitado a dependencias y artefactos generados.

## Historial purgado

- Herramienta: `git-filter-repo` 2.47.0.
- Acciones: exclusión total de rutas sensibles/runtime y reemplazo de marcadores comprometidos.
- Validación del repositorio: búsqueda de rutas prohibidas sin resultados; escaneo de todos los commits alcanzables devolvió `CLEAN`.
- Clon de verificación: `D:\bodegapp-backups\stokko-history-verify`.
- Validación del clon: `git status` limpio, `git fsck --full --no-reflogs` exit code 0, rutas prohibidas sin resultados y escaneo de marcadores `CLEAN`.
- Efecto esperado: `git-filter-repo` eliminó `origin` para evitar un push accidental de historia reescrita. La publicación futura debe configurar el remoto de forma explícita y usar coordinación de rotación, sin force-push automático desde esta sesión.

## Guard de secretos

- `npm run check:secrets`: `repo=169`, `staged=14`, `history=7306`, `artifact=0`; exit code 0.
- Prueba negativa de nombre: un fixture `.key` fue bloqueado como `sensitive-extension`; exit code 1 esperado; fixture eliminado.
- Prueba negativa de artefacto: un fixture `.map` fue bloqueado como `release-source-or-map`; exit code 1 esperado; fixture eliminado.
- Hooks: `pre-commit` ejecuta el escaneo staged; `pre-push` ejecuta escaneo completo y tests.
- Instalación de hooks: `npm run prepare`, ambos hooks confirmados.
- CI: `.github/workflows/security.yml`, checkout de historial completo, instalaciones limpias separadas, guard, tests, smokes, CSS, package y escaneo.

## Separación cliente/servidor

- Paquete servidor: `stokko-license-server/`, con `package.json`/lockfile/instalación propios.
- Dependencia exclusiva `jsonwebtoken` retirada del cliente.
- ACL: `scripts/configure-acl.ps1` probado en temporal y aplicado a la carpeta real; `[STOKKO_PHYSICAL_SEPARATION_OK]`.
- La autoridad requiere clave privada externa; scripts de update/integridad ya no tienen ruta fallback al servidor.
- Tests usan claves RSA efímeras generadas en memoria/directorio temporal.
- Tests: 90/90 pass, 0 fail, 0 skipped, 0 todo.

## Inspección del cliente

- Package x64 generado con Forge.
- ASAR: 7320 entradas; 0 rutas de `stokko-license-server`, `.env`, claves privadas o JSON/logs runtime.
- Verificación de clave cliente: `[CLIENT_PUBLIC_KEY_ONLY_OK]`.
- Escaneo exterior del paquete: 76 archivos, 0 hallazgos.

## Bloqueos externos honestos

La revocación en VPS, la generación de la nueva clave de producción y la invalidación de sesiones/tokens requieren acceso al servidor/secret manager. Están registradas como EA-001/EA-002 en `EXTERNAL-ACTIONS.md`; no se declaran ejecutadas.
