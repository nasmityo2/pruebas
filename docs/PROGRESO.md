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

## Fase 11.5 — Anti-replay del token

**Estado:** ✅ Completada. **Rama:** `fase-11-5-replay`. **Tests:** 60/60 verde.

- Nuevo `src/security/token.js` (puro): `isReplay` / `nextAcceptedIat`. 5 tests.
- `src/utils/license.js`: `saveLicenseCache` persiste `lastAcceptedIat` monotónico (del
  `iat` del token guardado); `getCachedPayload` rechaza un token cacheado con `iat` menor
  al último aceptado (re-inyección de token viejo).
- Combinado con el `jti`/`iat` que ya emite el servidor (Fase 2 refuerzo).

---

## Fase 11.3 — Bloqueo por offline prolongado

**Estado:** ✅ Completada. **Rama:** `fase-11-3-offline`. **Tests:** 64/64 verde.

- Nuevo `src/security/offline.js` (puro): `isOfflineGraceExceeded` con `GRACE_OFFLINE_HOURS`
  (env, default 72h). 4 tests.
- `getCachedPayload` bloquea si `now - lastSeenEpoch > 72h`. Como `lastSeenEpoch` solo avanza
  tras un contacto EXITOSO con el servidor, bloquear el tráfico (firewall/hosts) ya no da
  uso indefinido: pasadas 72h sin verificar, la app cae a EXPIRED y muestra activación.
- Junto con Fase 11.2 (reloj) cierra el ataque combinado A.1 (reloj atrasado + firewall).

- **DECISIÓN:** el backoff explícito con reintentos del heartbeat se difiere (requiere
  validar en runtime/GUI); la distinción offline vs revoked/expired ya existía en `heartbeat()`.

---

## Fase 11.4 — HWID robusto (sin archivo portátil)

**Estado:** ✅ Completada. **Rama:** `fase-11-4-hwid`. **Tests:** 70/70 verde.

- Nuevo `src/security/hwid.js`: HWID multi-señal (machineId, MachineGuid, serial de
  placa/BIOS, serial de volumen del sistema, CPU, platform-arch) hasheado con SHA-256.
  `combineSignals` es puro (6 tests, incl. fail-safe y descarte de placeholders OEM).
- Eliminado el fallback portátil `device.id` en texto plano (cierra A.1 🔴): si no hay
  señal fuerte, `getHardwareId()` devuelve null → el cliente no puede activar/validar
  (fail-safe) en vez de fabricar un ID copiable entre equipos.
- `PUBLIC_KEY` del cliente ya no es un bloque PEM literal: se guarda en base64 y se
  decodifica en runtime (obfuscation-safe; la ofuscación fuerte llega en Fase 13).
- El test `clientLicense` sigue verde: `getHardwareId()` real (WMI/registro en Windows) +
  clave pública decodificada validan un token firmado de extremo a extremo.

---

## Fase 12 — Actualizaciones firmadas (anti-RCE)

**Estado:** ✅ Completada. **Rama:** `fase-12-updates`. **Tests:** 74/74 verde.

- Nuevo `src/security/updateVerify.js` (puro): `sha256Hex`, `verifySignature`, `verifyUpdateFile`.
  4 tests (acepta binario correcto; rechaza hash manipulado, firma de otra clave, faltantes).
- `executeUpdate` verifica HASH + FIRMA del `.exe` con la clave pública embebida ANTES de
  `spawn`; si falla, borra el archivo y responde 400. Cierra la cadena RCE (A.2/A.3 🔴).
- `downloadUpdate` ya no acepta una URL arbitraria del body: solo la `downloadUrl` publicada
  por el dueño (server-verified vía heartbeat) y que traiga sha256+firma.
- `/update/publish` (servidor) EXIGE `sha256`+`signature` y audita `UPDATE_PUBLISH`.
- `scripts/sign-update.js`: herramienta del dueño para firmar el binario en cada release.

- **DECISIÓN:** el registro en la auditoría LOCAL del cliente al aplicar la actualización se
  difiere (necesita runtime/GUI); la publicación sí queda auditada en el servidor.

---

## Fase 11.6 + 11.7 — Cifrado de recursos ligado a licencia + watermark

**Estado:** ✅ Primitivas completadas. **Rama:** `fase-11-6-7`. **Tests:** 79/79 verde.

- `src/security/resourceCrypto.js` (puro): `deriveResourceKey(hwid, k)` = SHA-256(hwid|k),
  `encryptResource`/`decryptResource` (AES-256-GCM). Sin `k` (que solo viaja en un token
  válido del servidor) NO hay clave → el recurso no se descifra. 5 tests (incl. clave
  equivocada falla).
- `src/security/watermark.js` (puro): `licenseWatermark(licenseKey)` deriva un código
  discreto y estable por licencia para incrustar en artefactos (PDFs) y rastrear fugas.

- **DECISIÓN:** la SELECCIÓN del recurso esencial a cifrar en disco y su uso repartido por el
  flujo, y la incrustación visual del watermark en los PDFs, se difieren a una sesión con GUI
  (hay que validar que la app sigue operando y que el PDF no se rompe). Las primitivas y el
  material `k`/`key` en el token ya están listos.

---

## Fase 11.8 — Self-check de integridad en runtime

**Estado:** ✅ Completada. **Rama:** `fase-11-8-integrity`. **Tests:** 83/83 verde.

- `src/security/integrity.js`: `buildManifest`, `canonical`, `verifyManifestSignature`,
  `findMismatches`, `runSelfCheck`. 4 tests (íntegro pasa; manipulado detecta; firma de
  otra clave rechaza; manifiesto ausente rechaza).
- `scripts/gen-integrity-manifest.js`: paso de build que hashea los archivos críticos +
  `src/security/*` y firma el manifiesto con la clave privada.
- `main.js`: ejecuta `runSelfCheck` SOLO en `app.isPackaged` (producción); si falla, muestra
  error y cierra. En desarrollo no corre.
- `integrity-manifest.json(.sig)` añadidos a `.gitignore` (artefacto de build).

---

## Anexo A A.9 / B.H — Build y dependencias (lote seguro)

**Estado:** ✅ Lote seguro completado. **Rama:** `fase-build-deps`. **Tests:** 83/83 verde.

- Verificado que `scripts/packaging-ignore.js` (usado por forge y por el guard) YA excluye
  `.env`/`.env.*`, `.key`, `.pem` y `scratch/` → A.9 🔴 y el PDF de `scratch/` cubiertos.
- Eliminadas dependencias muertas `consulta-dolar-venezuela` y `dir-compare` (sin `require`
  en ningún lado). `npm run check:secrets` sigue limpio; suite 83/83.
- Creado `docs/BLOQUEOS.md` con el trabajo diferido (GUI/runtime Electron y Fase 13 de
  release), con motivos.

- **DECISIÓN:** `jsonwebtoken` se mantiene en el `package.json` raíz porque el `license-server`
  (sin `node_modules` propio) lo resuelve desde el compartido; se separará al dividir repos
  (Fase 10). `xlsx` (CVE), unificar CSV, subir `axios`, quitar `maker-squirrel` → diferidos a
  una sesión con GUI (ver BLOQUEOS.md).

---

## Anexo A A.4/A.6 — Transacción de tasas + timers del scheduler

**Estado:** ✅ Completada. **Rama:** `fase-anexoA-robustez`. **Tests:** 83/83 verde.

- `updateRates` ahora escribe TODAS las tasas/ajustes en una `db.transaction()` con upsert
  (`INSERT ... ON CONFLICT DO UPDATE`); el fetch async de BCV queda fuera. Un fallo intermedio
  ya no deja tasas a medias (A.4/B.D).
- `bcvUpdater`: `stopScheduler()` limpia el `setTimeout` de arranque y el `setInterval` de 30
  min; se invoca en `app.on('before-quit')` (A.6, evita fuga de timers).

---

## Fase 13 — Blindaje final (preparado; ejecución en release)

**Estado:** 🟡 Preparado (tooling listo). **Rama:** `fase-13-prep`.

- `scripts/apply-fuses.js` (Electron Fuses) y `scripts/gen-integrity-manifest.js` listos;
  `scripts/sign-update.js` (Fase 12) también. `docs/DISTRIBUCION.md` §6 documenta el pipeline
  completo de release blindado (fuses + bytenode + ofuscación + firma + verificación en Win7).
- `forge.config.js`/`packaging-ignore.js` ya excluyen `.env`/`.key`/`.pem`/`scratch`/
  `license-server`; el guard anti-secretos pasa.

- **BLOQUEO (documentado en `docs/BLOQUEOS.md`):** bytenode (13.2), ofuscación (13.3) y la
  verificación del build blindado en **Windows 7 / ia32** (13.5) requieren el entorno de
  release (Electron 22 ia32 + VM Win7) y, por diseño del plan, NO se ejecutan en desarrollo.
  Todo el tooling queda listo para correrlos en esa máquina.

---

## Anexo A A.4 — Lote 2 (stock y coerción de tasas)

**Estado:** ✅ Completada. **Rama:** `fase-anexoA-dinero2`. **Tests:** 83/83 verde.

- `product.updateStock`: los ajustes negativos usan guarda `stock + ? >= 0` (no deja stock
  negativo); distingue "producto no existe" de "el ajuste dejaría negativo".
- `sales.controller.getRates()`: coerciona las tasas a número. Corrige un bug real: `bcvUpdater`
  guarda `BCV` como TEXTO (`toFixed(8)`), y `calculateInternalCostVes` descartaba valores no
  numéricos → costo 0 silencioso (precios mal). Ahora se parsea; `IVA_MODE` queda como texto.

> Nota: estos controladores dependen de `better-sqlite3` (nativo de Electron); no se pueden
> ejercitar en la suite headless (usa `node:sqlite`). Verificados por lectura del código.

---

## Anexo A A.4 — Lote 3 (abonos anulados en reportes)

**Estado:** ✅ Completada. **Rama:** `fase-anexoA-abonos-reportes`.

- Consecuencia de pasar `voidPayment` a soft-delete: los abonos anulados AHORA permanecen en
  la tabla, así que TODAS las consultas de reportes/cierre/dashboard que suman abonos deben
  excluirlos. Añadido `AND COALESCE(a.anulado,0)=0` a las 5 consultas de `reports.controller`.
- `voidSale` ahora ANULA (soft-delete) los abonos de la venta en vez de borrarlos físicamente
  (respeta la regla global y preserva histórico).

- **DECISIÓN:** `venta_pagos` de una venta anulada se siguen borrando físicamente en `voidSale`
  (no tienen columna `anulado` y el recálculo corta en `ANULADO`, así que no descuadran). Migrar
  `venta_pagos` a soft-delete requiere columna nueva + filtros en recálculo/reportes y validación
  GUI; registrado como diferido en `docs/BLOQUEOS.md`.

---

## Resumen de la sesión

- **Suite de tests:** 83/83 verde (arrancó en 36; +47 nuevos).
- **`npm run check:secrets`:** limpio.
- **Módulos de seguridad nuevos** (`src/security/`): `clock`, `token`, `offline`, `hwid`,
  `resourceCrypto`, `watermark`, `updateVerify`, `integrity` — todos con tests puros.
- **Fases cerradas o muy avanzadas:** 14 (nueva, bypass crítico), 2 (refuerzos), 5 (items
  abiertos), 8 (XSS parcial), 11.1–11.9 (salvo integración GUI de 11.6/11.7), 12, 13 (preparado).
- **Diferido a GUI/release:** ver `docs/BLOQUEOS.md`.
