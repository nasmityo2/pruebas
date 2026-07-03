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
