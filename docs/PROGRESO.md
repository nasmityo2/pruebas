# Registro de avance — BodegApp

Registro cronológico de fases completadas, decisiones de ingeniería y bloqueos.
Complementa `PLAN-CURSOR-BODEGAPP.md` (documento maestro).

---

## Etapa 0 — Auditoría ampliada (Anexo B)

**Estado:** ✅ Completada.

- Se realizó una segunda pasada de auditoría profunda sobre todo el repositorio,
  dominio por dominio (A–I), verificando cada hallazgo contra el código real.
- Resultados integrados en `PLAN-CURSOR-BODEGAPP.md` → sección **"🔎 ANEXO B —
  Auditoría ampliada (hallazgos nuevos)"**, con severidad, `archivo:línea` y fase
  destino.
- Se creó la **Fase 14** para los hallazgos 🔴/🟠 nuevos del servidor de licencias
  y de robustez, y se actualizó la tabla "Resumen de prioridad".

### Decisiones de la Etapa 0

- **DECISIÓN:** los sub-agentes en paralelo no estaban disponibles (problema de
  facturación de la cuenta). La auditoría se hizo en una sola pasada secuencial,
  leyendo el código real de cada dominio antes de registrar cada hallazgo.
- **DECISIÓN (entorno de dev/test):** el repo no incluye `license-server/private.key`
  (gitignored y correcto). Para poder correr `npm test` se generó un par de llaves
  RSA nuevo de desarrollo (`node license-server/generate-keys.js --force`, ambas
  gitignored) y se sincronizó la **clave pública** embebida en `src/utils/license.js`
  con la nueva privada. Las claves públicas no son secretas y no hay clientes reales
  todavía, por lo que rotar es seguro (coherente con Fase 1). Con esto la suite pasó
  a **36/36 verde**.

### Hallazgo más grave (nuevo)

- 🔴 **Bypass total de licencia por clave de prototipo (`__proto__`)** en el servidor
  (`license-server/server.js`): `data.licenses["__proto__"]` devuelve `Object.prototype`
  y el servidor emite un token PRO firmado sin clave real ni auth. Verificado E2E.
  Se corrige en la **Fase 14**.

---

## Fase 14 — Cierre de auditoría ampliada (Anexo B)

**Estado:** ✅ Completada. **Rama:** `fase-14-auditoria-b`. **Tests:** 41/41 verde.

### 14.1 Servidor de licencias
- Cerrado el bypass `__proto__`/`constructor`: helpers `isUnsafeMapKey`/`safeMapGet`
  con `hasOwnProperty` en `/activate`, `/verify`, `/trial` y endpoints admin.
- `readJson` ahora respalda el archivo corrupto (`.corrupt-<ts>`) y aborta si no puede
  respaldar (evita borrar todas las licencias en la siguiente escritura).
- `/verify` exige `estado==='activa'` y `hwid` coincidente.
- `SECRET_KEY` exige ≥32 caracteres (fail-fast).
- `jwt.verify` fija `algorithms: ['HS256']`.
- 5 tests nuevos (incl. `key:"__proto__"` → 404; verify de pendiente no reemite token).

### 14.2 Robustez del cliente
- CORS: rangos LAN solo si `isLanEnabled()`.
- `process.on('unhandledRejection')` en `main.js` (loguea, no mata el proceso).
- Ventanas ocultas de impresión/PDF con `contextIsolation:true, sandbox:true`.
- `@fastify/multipart` con límites (20MB / 1 archivo / 50 campos).

### Decisiones de la Fase 14
- **DECISIÓN (roles de operador):** no se implementa login por operador (no hay UI ni
  requerimiento del dueño aún). `x-operator` queda como dato informativo de auditoría;
  el control real de acciones sensibles es `ensureUnlocked` (clave admin), server-side.
- **DECISIÓN (`getAdminPasswordStatus`):** se mantiene público (solo booleano `enabled`);
  el frontend lo necesita para decidir si pedir la clave admin. Riesgo bajo aceptado.

---

## Fase 5 (reapertura) — Integridad de BD (items abiertos)

**Estado:** ✅ Completada. **Rama:** `fase-5b-db-integridad`. **Tests:** 43/43 verde.

- `PRAGMA foreign_keys = ON` activado al FINAL de `initializeDB()` (tras las
  reconstrucciones legacy DROP+CREATE, que necesitan FK off). Test con node:sqlite
  verifica que un hijo con padre inexistente es rechazado.
- Eliminado el `DELETE FROM abonos WHERE anulado = 1` que corría en cada arranque
  (borraba el histórico de abonos anulados). Ahora se conservan y se filtran por
  `COALESCE(anulado,0)=0`. Test verifica que el histórico se conserva.

- **DECISIÓN (FK al final de init):** activar `foreign_keys` en `openDatabase()` habría
  hecho que las migraciones legacy de reconstrucción de tablas corrieran con FK on
  (riesgo). Se activa al final de `initializeDB()` para no cambiar el comportamiento de
  esas migraciones (patrón seguro de "table rebuild") y aplicar FK solo a la operación
  normal. Como el entorno headless no permite ejecutar better-sqlite3/Electron, se validó
  la semántica con node:sqlite en la suite.

---

## Anexo A — Bugs de dinero (subconjunto seguro y testeable)

**Estado:** ✅ Lote 1 completado. **Rama:** `fase-anexoA-dinero`. **Tests:** 45/45 verde.

- 🔴 Stock negativo (A.4): `processSaleTransaction` ahora descuenta con
  `UPDATE ... WHERE id=? AND stock>=?`; si no puede, revierte la venta. Evita stock
  negativo por líneas duplicadas del carrito o carreras.
- 🟡 `voidPayment` (A.4 + regla global): dejó de borrar físicamente el abono; ahora es
  soft-delete (`anulado=1`, `anulado_en`, `motivo_anulacion`), idempotente. El recálculo
  ya filtra `COALESCE(anulado,0)=0`, así que la deuda se recalcula correctamente.

- **DECISIÓN (alcance):** los otros bugs de dinero de A.4 que exigen reescribir el flujo de
  venta (recalcular el total server-side desde el carrito, `force_settle`, cierre Z antes
  del PDF, PDFs con tasa histórica) NO se tocan en este lote: son money-critical y el plan
  ya avisa contra refactors sin poder validar en la GUI (better-sqlite3/Electron no corre en
  este entorno headless). Se abordarán con la GUI disponible como red de seguridad.

---

## Fase 8 (reapertura) — XSS por innerHTML (parcial)

**Estado:** 🟡 Parcial. **Rama:** `fase-8-xss`. **Tests:** 48/48 verde.

- Creado `public/js/escape.js` con `escapeHtml` (global + export CommonJS para test).
- Aplicado a los sinks más expuestos: POS (nombre de producto y de presentación en los
  resultados de búsqueda) y Cobranza (nombre/cédula/teléfono/dirección en las tarjetas).
- Añadido `<script src="/js/escape.js">` antes del script principal en `pos.html` y
  `cobranza.html`.
- Test unitario del helper en `test/escape.units.test.js`.

- **DECISIÓN (alcance):** el resto de vistas (inventario, reportes, detalles_venta,
  indicadores, configuración, layout, etiquetas) NO se escapan aún: son archivos grandes y
  el cambio necesita validación en la GUI para no romper el render (regla "cambios pequeños
  y verificables"). Queda como continuación de Fase 8 con GUI. Documentado en Anexo B B.G.

---

## Fase 11.9 — Endurecer superficie del cliente (IPC / DevTools / errores)

**Estado:** ✅ Completada. **Rama:** `fase-11-9-superficie`. **Tests:** 48/48 verde.

- `preload.js`: whitelist explícita de canales IPC. `invoke` solo permite `app:restart`
  (único canal genérico usado por el frontend, verificado con grep); `send`/`receive`
  sin canales permitidos (no se usan). Cierra A.3 y Fase 11.9 🔴.
- DevTools deshabilitadas en el build empaquetado (`devTools: !app.isPackaged` + cierre
  automático si se abren). `contextIsolation:true`/`nodeIntegration:false` intactos.
- Error handler global y adapter: en producción (`NODE_ENV==='production'`, fijado por el
  build empaquetado) NO se filtran `error.message`/`error.name` al cliente. Cierra A.3.

---

## Fase 2 (refuerzos posteriores del anexo de blindaje)

**Estado:** ✅ Completada. **Rama:** `fase-2-refuerzos`. **Tests:** 49/49 verde.

- Token de licencia ahora incluye `jti` (id único por emisión, base de anti-replay 11.5)
  y `k` (32 bytes de material de clave por-licencia, base del cifrado ligado a licencia
  11.6). `k` se genera al activar y es estable; `jti` cambia en cada emisión. Test lo verifica.
- `TOKEN_GRACE_DAYS` por defecto bajado de 7 a 5 días (revocación remota se propaga antes).
- Detección de anomalías `trackAnomaly`: ≥5 IPs distintas por clave en 1h → `ANOMALY_MANY_IPS`
  en el access log (mitiga clonado/trial farming).
- Cabeceras de seguridad tipo helmet en el servidor de licencias (sin dependencia nueva) +
  límite de body 256kb.

- **DECISIÓN:** el CONSUMO en el cliente de `jti` (anti-replay 11.5) y `k` (cifrado de
  recursos 11.6) requiere el refactor de `src/security/*` (Fase 11.1) y validación en GUI;
  se dejan preparados en el token pero su implementación cliente queda para Fase 11.5/11.6.

---

## Fase 11.1 + 11.2 — Aislar seguridad + anti-rollback de reloj

**Estado:** ✅ Núcleo completado. **Rama:** `fase-11-2-clock`. **Tests:** 55/55 verde.

- Creada carpeta `src/security/` con `clock.js` (lógica PURA de anti-rollback), API con
  strings literales (obfuscation-safe). 6 tests unitarios.
- Integrado en `src/utils/license.js`:
  - `saveLicenseCache` guarda un sello monotónico `lastSeenEpoch = max(previo, ahora)`.
  - `getCachedPayload` invalida la caché si el reloj se atrasó por debajo de
    `lastSeenEpoch - 24h` (tolerancia por husos) → fuerza re-verificación online.
- Creado `docs/SEGURIDAD-CLIENTE.md` con la lista blanca de módulos sensibles (Fase 13).

- **DECISIÓN:** la 2ª ubicación de `lastSeenEpoch` (registro de Windows) y el log de
  auditoría del evento se difieren: requieren entorno Windows/GUI para validar. La función
  `clock.maxLastSeen` ya está lista para combinar múltiples fuentes cuando se implemente.

---
