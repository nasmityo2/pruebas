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
