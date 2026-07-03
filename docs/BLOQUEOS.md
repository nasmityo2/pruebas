# Bloqueos y trabajo diferido — BodegApp

Registro de tareas del plan que NO pudieron completarse/validarse en el entorno actual
(sesión headless de agente) y quedan explícitamente diferidas, con el motivo. NINGUNA es un
"build roto": la app compila, la suite pasa (ver `docs/PROGRESO.md`), y el guard anti-secretos
pasa. Estas tareas requieren un entorno que aquí no está disponible.

## Motivos recurrentes

- **GUI de Electron no ejecutable** en el entorno del agente (headless). No se puede abrir la
  app ni validar vistas/fl’ujos de UI en runtime.
- **`better-sqlite3` es un módulo nativo compilado para Electron**; la suite usa `node:sqlite`
  a propósito. No se puede ejecutar `initializeDB()`/controladores reales fuera de Electron.
- **Fase 13 (blindaje final)** es, por diseño del plan, el ÚLTIMO paso antes de distribuir y
  **no debe activarse en desarrollo**. Requiere **Electron 22.3.27 / ia32** y una **VM
  Windows 7** real para bytenode + fuses + verificación.

## Diferido (requiere GUI / runtime Electron)

- **Fase 8 (XSS) — resto de vistas.** Se creó el helper `escapeHtml` y se aplicó a POS y
  cobranza (los sinks más expuestos). Falta aplicarlo a inventario, reportes, detalles_venta,
  indicadores, configuración, layout y etiquetas: son archivos grandes y el cambio necesita
  verse en la GUI para no romper el render.
- **Fase 11.6 — recurso esencial cifrado.** Las primitivas (`resourceCrypto.js`) y el material
  `k` en el token están listos y testeados. Falta ELEGIR el recurso esencial real, cifrarlo en
  disco y repartir su uso por el flujo, validando que la app sigue operando (GUI).
- **Fase 11.7 — incrustar watermark en PDFs.** El helper `watermark.js` está listo; falta
  incrustar el código en los PDFs de ticket/reportes sin romper el layout (GUI).
- **Fase 11.2 — 2ª ubicación de `lastSeenEpoch`** (registro de Windows) y auditoría local del
  evento de reloj atrasado: `clock.maxLastSeen` está listo; la escritura al registro necesita
  Windows/GUI para validar.
- **Anexo A A.4 — bugs de dinero que reescriben el flujo de venta** (recalcular el total
  server-side desde el carrito, `force_settle`, cierre Z antes del PDF, PDFs con tasa
  histórica): son money-critical; el plan pide no refactorizar sin poder validar en la GUI.
- **B.G / A.7 — XSS restantes** (ver Fase 8 arriba).
- **A.4 — `venta_pagos` a soft-delete.** Al anular una venta, `venta_pagos` se sigue
  borrando físicamente (no tiene columna `anulado`; el recálculo corta en `ANULADO` y los
  reportes filtran por estado de venta, así que no descuadra). Migrar a soft-delete exige
  columna nueva + filtros en recálculo/reportes y validación en GUI.
- **B.H / A.9 — dependencias**: migrar `xlsx` a la build de SheetJS, unificar `fast-csv`/
  `csv-parser`, subir `axios`, quitar `maker-squirrel`: requieren revalidar import/export y
  el flujo de updates en runtime.

## Diferido (Fase 13 — release/blindaje final, NO en dev)

- Electron **Fuses** (`RunAsNode`, `EnableNodeCliInspectArguments`, `OnlyLoadAppFromAsar`).
- **bytenode** (compilar `src/security/*` y el proceso principal a `.jsc`) con Electron ia32.
- **Ofuscación** del JS restante con `javascript-obfuscator`.
- Verificación del build blindado en **Windows 7 / 32-bit real o VM**.

> Preparado para Fase 13: `docs/SEGURIDAD-CLIENTE.md` (lista blanca de módulos sensibles),
> `scripts/gen-integrity-manifest.js` (manifiesto firmado) y `scripts/sign-update.js`
> (firma de updates) ya existen. El self-check de integridad (11.8) ya corre en producción.

## Estado de build/tests en esta sesión

- `npm test` → **verde** (ver el número exacto en `docs/PROGRESO.md`).
- `npm run check:secrets` → **sin secretos** en lo que se empaquetaría.
- No hay ningún build roto pendiente de reparación.
