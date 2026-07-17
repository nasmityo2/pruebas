# Evidencia de Fase 2 — Rebranding y migración

Fecha: 2026-07-17

## Identidad

- Paquete: `name=stokko`, `productName=Stokko`.
- Runtime: `app.setName('Stokko')`, AppUserModelID `com.codigocreativo.stokko`.
- WiX: nombre/exe/shortcut/program folder `Stokko`; upgrade code estable; fabricante y descripción definidos.
- Ejecutable: `out/Stokko-win32-x64/Stokko.exe`.
- MSI: `out/make/wix/x64/Stokko.msi`.
- ZIP: `out/make/zip/win32/x64/Stokko-win32-x64-1.26.10617.zip`.

## Artefactos de validación de marca

- EXE SHA-256: `f5cb15242ff90a676d3e2298b0dd0114758c8e4579a4dd73dff51b103d9d0b29`.
- MSI SHA-256: `459d42faadfffad4cd9dcf74aa4c2178e551b12c470e7e8c1bfe5688d143a011`.
- ZIP SHA-256: `7e0cce504c03ead08c9a6c4e9f5c2f0a333eace9f731f66828513f79d0f050c0`.
- Estos artefactos validan rebranding; no son todavía el release seguro final.

## Identidad visual

- Fuente: `assets/stokko-source.png`.
- Generador reproducible: `scripts/build-brand-assets.py`.
- Logo: 1024×1024.
- Splash: 1200×675.
- ICO: frames 16, 24, 32, 48, 64, 128 y 256 px.
- Favicon, iconos cliente/panel, logo por defecto y assets de instalador actualizados.
- Verificación visual: monograma S/cajas legible, contraste blanco sobre gradiente índigo/teal, texto del splash correcto.

## Migración de datos

- Destino: `%APPDATA%\Stokko_Data`.
- Fuentes legacy: perfil de usuario y ProgramData, construidas únicamente dentro del módulo de compatibilidad.
- Controles: lock exclusivo, detección de lock stale, validación de cabecera SQLite, backup verificado por SHA-256, staging, swap, marcador idempotente y rollback que conserva el destino migrado.
- Comando de prueba: `node --require ./test/setup-env.js --test test/stokkoMigration.units.test.js`.
- Resultado: 4/4 pass: primera migración, segunda ejecución, origen ausente, origen corrupto, lock, preservación de DB/uploads/preferencias/licencia/backups y rollback.

## Regresión y búsqueda

- `npm test`: 94/94 pass, 0 fail, 0 skipped, 0 todo.
- `npm run test:smoke`: backend y Electron OK con `Stokko_Data`.
- Búsqueda case-insensitive sobre fuente distribuida: 0 coincidencias de marca anterior.
- Escaneo de ASAR: 3724 archivos de texto revisados, 0 coincidencias de marca anterior.

## Toolchain de instalador

El primer `npm run make -- --arch=x64` falló por ausencia de WiX. Chocolatey no pudo instalar sin elevación. Se descargó el archivo oficial portable WiX 3.14.1 fuera del repositorio, SHA-256 `6ac824e1642d6f7277d0ed7ea09411a508f6116ba6fae0aa5f2c7daa2ff43d31`; `candle.exe` y `light.exe` 3.14.1.8722 se añadieron solo al PATH del proceso. La repetición generó MSI y ZIP con exit code 0.
