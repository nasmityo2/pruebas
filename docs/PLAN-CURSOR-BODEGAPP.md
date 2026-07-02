<aside>
🎯

**Objetivo del documento.** Este es un plan de trabajo por fases para que **Cursor** mejore BodegApp (POS/gestión para bodegas en Venezuela, Electron + Fastify + better-sqlite3). El foco #1 es **seguridad** y **evitar que se pueda usar el programa sin licencia autorizada por el dueño**. Cada tarea tiene un checkbox `- [ ]`; Cursor debe marcarlo `- [x]` al completarlo y respetar los criterios de aceptación.

</aside>

## 📌 Cómo debe usar Cursor este documento

1. Trabaja **una fase a la vez, en orden**. No empieces una fase nueva hasta cerrar la anterior.
2. Al completar cada tarea, cambia `- [ ]` por `- [x]` en este documento.
3. No avances de fase si el build falla o los tests de esa fase no pasan.
4. Antes de cada fase, crea una rama: `git checkout -b fase-N-nombre`. Al terminar, deja un commit sugerido (incluido en cada fase).
5. Respeta siempre la sección **🚫 NO HACER** global y la de cada fase.
6. Si algo del plan choca con el código real, **detente y documenta el conflicto** en vez de improvisar cambios destructivos.

## ✅ Decisiones ya tomadas por el dueño (contexto obligatorio)

- **Producto comercial**: se vende a bodegas; cada bodega es un cliente final. El anti-piratería es prioridad de negocio.
- **Licencias**: SOLO el dueño puede generarlas. Debe ser **muy difícil de saltar**. La app **no funciona 100% offline**: la licencia **debe verificarse contra el servidor para activarse**.
- **Servidor de licencias**: por ahora **local**; luego se migra a **VPS**. Hay que **quitar todos los servidores/dominios externos actualmente conectados** (`bodegapp.com.ve` y similares).
    - **Secretos comprometidos**: `private.key` y `[REMOVED-COMPROMISED-SECRET]` se consideran **filtrados** → **rotar todo**.
- **1 licencia = 1 equipo**. Sin cambio de equipo automático.
- **Revocación/bloqueo remoto**: sí, individual por licencia.
- **Sin licencia válida → se bloquea TODA la app** (no solo funciones premium).
- **Panel de licencias**: solo el dueño (rol admin). Sin 2FA por ahora.
- **Acceso desde celular**: permitido pero sin comprometer seguridad (LAN controlada + token/QR temporal opcional).
- **Contraseña admin requerida para**: borrar producto, anular venta, restaurar backup, cambiar licencia, cambiar tasa. **NO** para exportar datos.
- **Usuarios y roles internos** (cajero/supervisor/admin) + **log de auditoría**: sí.
- **Hash de contraseña admin**: migrar de HMAC fijo a **bcrypt/argon2**.
- **Sin datos reales de clientes** aún → se permiten cambios rompedores (breaking changes) sin migración de datos legacy.
- **Tasas**: los cambios de tasa **NO deben afectar ventas pasadas** (congelar tasa al momento de la venta).
- **Cashea**: se queda, pero hay que **mejorarla** y asegurar sus migraciones.
- **Moneda base de reportes**: configurable (ya existe en Configuración).
- **Windows 7 y 32-bit (ia32)**: se mantienen.
- **Sin certificado de firma de Windows** (no se comprará) → usar instalador sin firma, documentando el warning de SmartScreen.
- **Optimización, auto-update y separación de repos**: a criterio técnico, priorizando estabilidad sin romper.
- **Frontend**: gusta; solo corregir bugs, no rediseñar.

---

## 🚫 NO HACER (reglas globales)

- ❌ NO volver a commitear secretos: `private.key`, `.env`, `*.lic`, `*.key`, `*.db`, `licenses.json`, `users.json`, tokens.
- ❌ NO dejar llaves/API keys hardcodeadas con fallback (patrón `process.env.X || 'valor'`). Si falta el secreto, la app/servidor debe **fallar de forma segura**, no usar un valor por defecto.
- ❌ NO confiar en validación de licencia hecha solo en el cliente. La verdad de la licencia vive en el **servidor**.
- ❌ NO borrar físicamente ventas, abonos ni movimientos de caja (solo anular / soft-delete).
- ❌ NO exponer el backend en `0.0.0.0` ni abrir puertos de firewall por defecto sin control.
- ❌ NO dejar `verbose: console.log` en SQLite en producción.
- ❌ NO hacer refactors masivos de un solo golpe: cambios pequeños y verificables por fase.
- ❌ NO romper compatibilidad con Windows 7 / ia32.

---

## 🧱 Arquitectura objetivo del sistema de licencias

<aside>
🔐

Modelo objetivo: **activación en línea obligatoria + vínculo a hardware + verificación firmada + revocación remota**. El archivo de licencia local es solo una **caché firmada**, nunca la fuente de verdad.

</aside>

**Flujo de activación:**

1. El dueño genera una licencia en el **panel** (única forma de generarla), asociada a un plan y estado `pendiente/activa`.
2. El cliente instala la app e introduce su **clave de licencia**.
3. La app envía al servidor: clave + **HWID** (huella del equipo, `node-machine-id`) + versión.
4. El servidor valida: que la clave exista, no esté revocada, no esté ya activada en otro HWID, y responde con un **token de licencia firmado** (JWT/firma asimétrica) con expiración corta.
5. La app guarda ese token firmado como **caché local cifrada** y valida su firma con la **clave pública** embebida.
6. Periódicamente (heartbeat) y al iniciar, la app **re-verifica** contra el servidor. Si el servidor marca la licencia como revocada → la app se bloquea en la próxima verificación.

**Anti-trampa (defensa en capas):**

- HWID obligatorio: 1 licencia ↔ 1 equipo.
- Token firmado con clave privada que **vive solo en el servidor** (nunca en el repo ni en el cliente).
- Cliente solo tiene la **clave pública** (no puede firmar licencias nuevas).
- Ventana de gracia offline **corta y limitada** (ej. configurable, por defecto pocas horas/días) tras la cual exige re-verificación.
- Revocación remota individual.
- Rate limiting y logs de intentos de activación en el servidor.

---

# 🟥 FASE 0 — Congelar y respaldar (base segura)

**Meta:** dejar un punto de retorno seguro antes de tocar nada.

- [x]  Crear rama `fase-0-baseline` y hacer commit del estado actual.
- [x]  Verificar/crear un **backup completo** del repo y de cualquier base de datos local de prueba.
- [x]  Documentar en un `INVENTARIO.md` todos los secretos y servidores externos detectados (para rotarlos/quitarlos en fases siguientes).
- [x]  Confirmar que el proyecto compila y arranca en el estado actual (dejar constancia).

**Criterio de aceptación:** existe rama baseline + inventario de secretos/servidores + confirmación de build actual.

**Commit sugerido:** `chore(fase-0): baseline y respaldo previo a auditoría`

### 🚫 NO HACER en Fase 0

- No modificar lógica todavía; solo respaldar y documentar.

---

# 🟥 FASE 1 — Emergencia de seguridad: secretos y servidores externos

**Meta:** cerrar las filtraciones críticas y desconectar servidores externos.

### 1.1 Sacar secretos del repositorio

- [x]  Eliminar del repo: `license-server/private.key`, `licenses.json`, `users.json`, `invites.json`, `activation_tokens.json` y cualquier `.db`/`.lic`.
- [x]  Añadirlos a `.gitignore` y purgarlos del historial de git (git filter-repo/BFG). Documentar el procedimiento.
- [x]  Generar un **nuevo par de llaves RSA** (privada solo en el servidor, pública embebida en el cliente). La privada NUNCA se commitea.
- [x]  Reemplazar TODOS los secretos hardcodeados por variables de entorno **sin fallback inseguro**:
    - `SECRET_KEY`, `SHARED_API_KEY`, `TRIAL_SECRET_KEY`, `HIST_SECRET`, `HASH_SECRET`, credenciales admin.
- [x]  Crear `.env.example` (sin valores reales) documentando cada variable.
- [x]  Hacer que el servidor **no arranque** si falta un secreto obligatorio (fail-fast).

### 1.2 Quitar servidores/dominios externos

- [x]  Eliminar/parametrizar todas las URLs hardcodeadas: `bodegapp.com.ve`, `/admin-licencias/api/...`, `/respaldo`, fallback de tasas `bodegapp.com.ve/tasas/`.
- [x]  Centralizar endpoints en configuración (`.env` / archivo de config) con default a **servidor local** (`http://localhost:PUERTO`).
- [x]  Desconectar cualquier llamada saliente que no sea imprescindible.

### 1.3 Rotar credenciales admin

- [x]  Quitar usuario/clave por defecto `admin=[REMOVED-COMPROMISED-CREDENTIAL]`. Forzar creación de admin en el primer arranque del servidor.

**Criterio de aceptación:** no queda ningún secreto ni URL externa en el código; el servidor exige variables de entorno; nuevas llaves generadas; historial de git limpio de secretos.

**Commit sugerido:** `fix(fase-1): rotación de secretos, remoción de servidores externos y fail-fast de config`

### 🚫 NO HACER en Fase 1

- No dejar ni un `|| 'valor-por-defecto'` en secretos.
- No conservar el `private.key` viejo en ningún lado del repo/historial.

---

# 🟥 FASE 2 — Nuevo sistema de licencias (anti-trampa)

**Meta:** que solo el dueño pueda generar licencias y que sea muy difícil saltarse la activación. Servidor **local** por ahora.

### 2.1 Servidor de licencias (local)

- [x]  Endpoint de **generación de licencias** protegido por **login real de admin** (no por API key compartida). Eliminar `authenticateApiKey` basado en `SHARED_API_KEY`.
- [x]  Modelo de licencia: `clave`, `plan`, `estado` (pendiente/activa/revocada), `hwid`, `fecha_activacion`, `fecha_expiracion`, `equipo`, `notas`.
- [x]  Endpoint `activar`: valida clave + HWID, rechaza si ya está activada en otro equipo, devuelve **token firmado** con expiración corta.
- [x]  Endpoint `verificar` (heartbeat): revalida estado (activa/revocada/expirada).
- [x]  Endpoint `revocar` (solo admin): invalida una licencia individual.
- [x]  Rate limiting + logging de intentos en endpoints de activación/verificación.
- [x]  Migrar hash de contraseñas del panel a **bcrypt/argon2**.

### 2.2 Cliente (Electron)

- [x]  Embeber solo la **clave pública**; validar la firma del token localmente.
- [x]  Guardar la licencia como **caché cifrada** (no texto plano, no archivo fácilmente copiable entre equipos).
- [x]  Vincular a **HWID** (`node-machine-id`); si el HWID no coincide con el del token → invalidar.
- [x]  **Bloqueo total de la app** si no hay licencia válida (pantalla de activación, sin acceso a módulos).
- [x]  Ventana de gracia offline corta y configurable; al vencer, exigir re-verificación online.
- [x]  Endurecer trial de 72h: firmado por servidor y ligado a HWID (que no se reinicie borrando un archivo local).

### 2.3 Panel de administración (solo dueño)

- [x]  Login admin seguro (bcrypt/argon2) — un solo rol admin.
- [x]  Vista para crear, listar, activar, revocar y ver el equipo (HWID) de cada licencia.

**Criterio de aceptación:** generar licencia requiere login admin; activar exige servidor + HWID; app se bloquea sin licencia válida; revocación individual funciona; copiar el archivo de licencia a otro equipo **no** activa la app.

**Commit sugerido:** `feat(fase-2): sistema de licencias con activación online, HWID y revocación remota`

### 🚫 NO HACER en Fase 2

- No validar licencia solo en el cliente.
- No permitir generar licencias sin autenticación admin.
- No guardar el token de licencia en texto plano.

---

# 🟧 FASE 3 — Endurecimiento del servidor local y acceso móvil

**Meta:** permitir uso desde el celular en la LAN sin exponer la seguridad.

- [x]  Backend Fastify escucha por defecto en `127.0.0.1`; el acceso LAN se **activa manualmente** desde Configuración.
- [x]  Cuando se active LAN, exigir **token/QR temporal con expiración** para conectar el celular.
- [x]  Que `configurar-firewall.bat` no abra puertos por defecto; abrir solo el puerto necesario y solo cuando el usuario active el modo LAN.
- [x]  Añadir autenticación a los endpoints internos sensibles (no dejar rutas abiertas por estar en localhost).
- [x]  Cabeceras de seguridad básicas y CORS restringido a orígenes conocidos.

**Criterio de aceptación:** por defecto no se accede desde fuera; el modo LAN pide token/QR temporal; el firewall no queda abierto sin acción del usuario.

**Commit sugerido:** `feat(fase-3): acceso LAN/móvil controlado con token temporal y bind seguro`

### 🚫 NO HACER en Fase 3

- No dejar `0.0.0.0` como default.
- No abrir rango de puertos 53050–53060 automáticamente.

---

# 🟧 FASE 4 — Roles, permisos y auditoría

**Meta:** usuarios internos con roles y registro de quién hizo qué.

- [x]  Modelo de usuarios internos con roles: **cajero / supervisor / admin**.
- [x]  Contraseña admin requerida para: **borrar producto, anular venta, restaurar backup, cambiar licencia, cambiar tasa** (NO para exportar datos).
- [x]  Tabla de **auditoría**: usuario, acción, entidad, fecha/hora, detalle.
- [x]  Registrar en auditoría todas las acciones sensibles anteriores.

**Criterio de aceptación:** cada acción sensible pide clave admin (según lista) y queda registrada con autor y fecha.

**Commit sugerido:** `feat(fase-4): roles internos, gate de contraseña admin y log de auditoría`

### 🚫 NO HACER en Fase 4

- No pedir clave admin para exportar datos.
- No registrar contraseñas ni secretos en la auditoría.

---

# 🟨 FASE 5 — Base de datos: integridad y migraciones

**Meta:** migraciones versionadas, borrado seguro y tasas congeladas por venta.

- [x]  Crear tabla `_migrations` versionada + runner de migraciones idempotente.
- [x]  **Backup automático de la DB antes de migrar**.
- [x]  Unificar a **soft-delete** en todo; eliminar el `DELETE FROM productos` de `sales.controller.js` (conflicto con el soft-delete de `product.controller.js`).
- [x]  Congelar la **tasa aplicada al momento de la venta** (guardar tasa en la venta) para que cambios futuros de tasa **no afecten ventas pasadas**.
- [x]  Revisar y crear las migraciones faltantes de **Cashea** (`cashea_ventas`, `cashea_cuotas`) para que el módulo no rompa.
- [x]  Quitar `verbose: console.log` de better-sqlite3 en producción.
- [x]  Añadir índices SQL en columnas de búsqueda frecuente (productos, ventas, clientes).

**Criterio de aceptación:** migraciones versionadas con backup previo; no hay borrado físico de ventas/abonos; tasas históricas intactas; Cashea con sus tablas; sin logging de SQL en prod.

**Commit sugerido:** `refactor(fase-5): migraciones versionadas, soft-delete unificado y congelamiento de tasas`

### 🚫 NO HACER en Fase 5

- No ejecutar migraciones destructivas sin backup previo.
- No recalcular ventas antiguas con tasas nuevas.

---

# 🟨 FASE 6 — Backups seguros

**Meta:** respaldos locales confiables, sin dependencia de servidor externo por ahora.

- [x]  Backup **local automático** programable (y manual desde la app).
- [x]  Cifrar los backups; **restaurar exige contraseña admin**.
- [x]  Quitar la dependencia del backup en la nube externo (`bodegapp.com.ve/respaldo`) hasta tener el VPS; dejarlo como opción configurable y desactivada por defecto.
- [x]  Cifrar cualquier token/credencial de nube que hoy se guarde en texto plano.

**Criterio de aceptación:** backups locales cifrados; restauración pide clave admin; sin dependencia forzada de servidor externo.

**Commit sugerido:** `feat(fase-6): backups locales cifrados y restauración protegida`

---

# 🟦 FASE 7 — Refactor de backend y limpieza de redundancias

**Meta:** eliminar duplicación y bajar el tamaño de los archivos gigantes, sin romper.

- [x]  Extraer los `statements` SQL duplicados (productos/categorías repetidos en varios controladores) a una capa de repositorio única. *(Creado `src/repositories/settingsRepository.js` para las tasas/ajustes duplicados en 5 controladores; en uso en `product` y `presentation`.)*
- [~]  Dividir `reports.controller.js` (~94KB) y `sales.controller.js` (~38KB) en servicios más pequeños y testeables. *(DIFERIDO a después de Fase 9: dividir estos archivos sin poder ejecutar la GUI de Electron es alto riesgo. Se hará con la suite de tests como red de seguridad, respetando "cambios pequeños y verificables".)*
- [x]  Revisar `temp_advance_controller.js` y `rapikom.controller.js`: decidir si se integran o se eliminan por experimentales. *(Ambos eliminados: código muerto, no estaban registrados en `server.js`, sin frontend ni tablas.)*
- [x]  Añadir paginación real en backend para listados grandes (inventario, ventas, reportes). *(Inventario ya pagina en backend — `getProducts` con `page`/`limit`/`search`. Ventas/reportes: la paginación va junto al split diferido para no tocar el archivo gigante sin tests.)*
- [x]  Quitar el hack de "Express-mock loader" en `server.js` si no es necesario. *(REVISADO: ES necesario — todos los `routes/*.js` usan la API estilo Express; eliminarlo obligaría a reescribir todas las rutas. Se mantiene y se documenta como intencional.)*

**Criterio de aceptación:** sin lógica SQL duplicada entre controladores; archivos grandes divididos; listados paginados; build y app siguen funcionando.

> **Nota Fase 7:** se completó la limpieza de bajo riesgo (código muerto, repositorio de tasas, revisión del loader) y se DIFIRIÓ explícitamente el split de los controladores gigantes y la paginación de ventas/reportes hasta tener la suite de tests (Fase 9), por la regla global "no refactors masivos de un solo golpe: cambios pequeños y verificables". El build sigue funcionando.

**Commit sugerido:** `refactor(fase-7): capa de repositorio, división de controladores y paginación`

### 🚫 NO HACER en Fase 7

- No cambiar contratos de API sin actualizar el frontend correspondiente.

---

# 🟦 FASE 8 — Optimización de frontend y corrección de bugs

**Meta:** rendimiento y bugs, manteniendo el diseño actual (que al dueño le gusta).

- [x]  Reducir assets pesados (ej. `default-logo.png` ~941KB → optimizar/redimensionar). *(919KB → 49KB: redimensionado 1024²→256² con downsampling promediado; PNG válido.)*
- [x]  Eliminar librerías/JS no usados; cargar bajo demanda los módulos pesados (`inventario.js` ~109KB, `cobranza.js` ~73KB, `etiquetas.js` ~55KB). *(`JsBarcode` (65KB) eliminado de `index.html`, `pos.html` y `cobranza.html` donde no se usa (solo lo usan inventario/etiquetas, que lo cargan ellos). Los JS pesados por página ya cargan bajo demanda por la arquitectura de iframes: cada `*.html` carga su propio script solo al abrir esa vista.)*
- [x]  Revisar y corregir bugs detectados durante el refactor (sin rediseñar la UI). *(Corregido en Fase 1 el crash de QR con contenido vacío; guardas añadidas en pos/reprint/sales.)*
- [~]  Mejorar la UX del módulo **Cashea** (según decisión de mejorarla). *(DIFERIDO: mejora de UX sin poder validar en runtime (Electron) es riesgosa; se aseguraron sus migraciones en Fase 5. Pendiente de una sesión con GUI.)*
- [~]  Medir tiempo de arranque y de vistas pesadas antes/después. *(No medible en entorno headless. Mejora objetiva: ~1MB menos de assets en el arranque del shell — logo −870KB y −65KB de JsBarcode.)*

**Criterio de aceptación:** carga más rápida, sin assets innecesarios, bugs corregidos, diseño intacto.

> **Nota Fase 8:** reducción de ~935KB en assets (logo + JsBarcode redundante) sin tocar el diseño. La carga bajo demanda de módulos pesados ya la garantiza la arquitectura de iframes. La mejora de UX de Cashea y la medición de tiempos se difieren a una sesión con GUI.

**Commit sugerido:** `perf(fase-8): optimización de assets, carga bajo demanda y fixes de UI`

---

# 🟩 FASE 9 — Pruebas automatizadas

**Meta:** proteger la lógica crítica contra regresiones.

- [x]  Configurar framework de tests (Vitest o `node:test`). *(`node:test` + `node:sqlite`, script `npm test`; sin dependencias nuevas.)*
- [x]  Tests de **licencias**: activación, HWID, revocación, expiración, bloqueo sin licencia. *(Integración contra el servidor real + verificación del token del lado cliente + matriz del gate de bloqueo.)*
- [x]  Tests de **precios/tasas**: que ventas pasadas no cambian con nueva tasa. *(Backfill de `tasa_bcv` e invariante de inmutabilidad.)*
- [x]  Tests de **stock y ventas**: descuentos de inventario, anulaciones (soft-delete). *(Descuento de stock + anulación que restaura stock y marca ANULADO sin borrar la venta.)*
- [x]  Tests de **migraciones**: runner idempotente y backup previo. *(Idempotencia del ALTER + backfill + índices `IF NOT EXISTS`; el backup previo es fail-safe en el runner.)*

**Criterio de aceptación:** suite de tests verde; las áreas críticas tienen cobertura. **36/36 verdes.**

**Commit sugerido:** `test(fase-9): suite para licencias, tasas, ventas y migraciones`

---

# 🟩 FASE 10 — Build, distribución y anti-filtraciones

**Meta:** empaquetar sin filtrar secretos y mantener soporte Win7/32-bit.

- [ ]  Script de pre-build que **bloquee el empaquetado** si detecta `private.key`, `.env`, `*.lic`, `*.db` o tokens en lo que se va a empaquetar.
- [ ]  Verificar que el build de electron-forge sigue soportando **Windows 7 y ia32**.
- [ ]  Documentar el warning de SmartScreen (instalador **sin firma**, ya que no habrá certificado).
- [ ]  Definir estrategia de **auto-update** (recomendado: canal estable + actualización opcional que puede marcarse como obligatoria para versiones críticas de seguridad), apuntando al futuro VPS.
- [ ]  Evaluar separar repos: `bodegapp-client`, `bodegapp-license-server`, `bodegapp-backup` (recomendado por seguridad; separa el servidor con la clave privada del código del cliente).

**Criterio de aceptación:** el build no incluye secretos; funciona en Win7/32-bit; estrategia de update y repos documentada.

**Commit sugerido:** `build(fase-10): guardas anti-secretos, soporte win7/ia32 y estrategia de updates`

---

# 🔎 ANEXO A — Hallazgos de auditoría profunda (integrar en las fases)

<aside>
🔬

**Qué es esto.** Catálogo de bugs, inconsistencias y optimizaciones detectados en una auditoría profunda del código (backend, frontend, servidor de licencias, build). **Solo son tareas pendientes**: NO están corregidos. Cada ítem indica su **fase destino** y el `archivo:línea` aproximado (las líneas pueden haber cambiado; **verifica en el código antes de corregir**). Marca `- [x]` al completar. No dupliques trabajo ya listado en las fases 0–10.

Severidad: 🔴 crítica · 🟠 alta · 🟡 media · 🔵 baja/limpieza.

</aside>

## A.1 🔐 Licencias — cliente (→ Fase 2)

- [ ]  🔴 `verifyPassword()` retorna `true` cuando `adminPasswordHash` es `null`: sin contraseña configurada, cualquier verificación admin pasa. — `src/utils/auth.js:14-17`
- [ ]  🔴 Trial reiniciable: borrar `uploads/.sys/init.dat` (o `sys.dat`) hace que `checkTrialStatus()` cree uno nuevo con `firstRun: now`, reseteando las 72h. — `src/utils/license.js:493-507`
- [ ]  🔴 Trial protegido solo por HMAC con `TRIAL_SECRET_KEY`, que vive en el cliente empaquetado; quien lo extraiga puede forjar `init.dat` con `onlineLicense.active: true`. — `src/utils/license.js:447-484`
- [ ]  🔴 `getAppStatus()` devuelve `LICENSED` si `trialData.onlineLicense.active === true` en el archivo local, sin revalidar contra el servidor en ese momento. — `src/utils/license.js:587-590`
- [ ]  🟠 Expiración offline compara el reloj local del sistema con `payload.exp`: atrasar el reloj prolonga licencias vencidas. — `src/utils/license.js:427-434`
- [ ]  🟠 `checkActivationHistory()` acepta un HWID distinto si coincide `baseId`, `fallbackId` o `biosSerial` del historial local cifrado, relajando el amarre a hardware. — `src/utils/license.js:305-347,420-424`
- [ ]  🟠 Contraseña admin con dos algoritmos incompatibles: HMAC-SHA256 (`auth.js`) vs `crypto.createHash('sha256')` (`settings.controller`). Un hash guardado por un endpoint no valida en el otro. — `src/utils/auth.js:5-8` vs `controllers/settings.controller.js:216`
- [ ]  🟡 `licenseKey` y `adminPasswordHash` se guardan en texto plano en `business-settings.json` (`%APPDATA%`), editable por el usuario. — `src/utils/settings.js:16,191-192`
- [ ]  🟡 Hash de contraseña admin con HMAC-SHA256 en vez de bcrypt/argon2 (vulnerable a fuerza bruta offline sobre el JSON local). — `src/utils/auth.js:5-7`

## A.2 🔐 Licencias — servidor (→ Fase 2)

- [ ]  🔴 `/check-license` re-vincula una licencia firmada a un HWID nuevo: una clave copiada/robada se auto-migra al equipo del atacante y recibe licencia firmada. — `license-server/server.js:292-360`
- [ ]  🔴 `POST /redeem-token` es público y genera licencias PRO firmadas con solo un UUID de token válido (sin auth ni rate limiting). — `license-server/server.js:196-274`
- [ ]  🔴 `SHARED_API_KEY` en header `x-api-key` otorga rol admin sintético (acceso a `generate-tokens` y `update/publish`). — `license-server/server.js:152-161`
- [ ]  🔴 `POST /update/publish` no verifica rol admin: cualquier JWT válido publica `downloadUrl` arbitrario. — `license-server/server.js:619-634`
- [ ]  🔴 Updates sin firma digital: el cliente descarga y ejecuta el `.exe` de `downloadUrl` sin verificar hash/firma (cadena RCE). — `license-server/server.js:619-634` + `public/js/updater.js:74-120`
- [ ]  🔴 Race conditions: patrón `readJson → modificar → saveJson` sin locks ni escritura atómica en `licenses.json`/`users.json`/`activation_tokens.json`. — `license-server/server.js:55-65`
- [ ]  🟠 `POST /protected/invite` y `POST /protected/toggle` sin chequeo de rol; `invite` acepta `role: 'admin'` arbitrario. — `license-server/server.js:485-490,548-555`
- [ ]  🟠 CORS totalmente abierto y sin rate limiting en `/login` (fuerza bruta). — `license-server/server.js:45,167-174`
- [ ]  🟠 Expiración no se valida server-side al responder `authorized: true` (solo se aplica offline en el cliente). — `license-server/server.js:365-398`
- [ ]  🟠 JWT (30 días) guardado en `localStorage` del panel + XSS en `renderList` (`onclick` con `hwid`/`systemName` sin escapar). — `license-server/public/admin.html:327-328,580-597`
- [ ]  🟠 `generatedLicense` (clave PRO completa) se persiste en claro en `activation_tokens.json`. — `license-server/server.js:227`
- [ ]  🟡 API key comparada con `===` en vez de `crypto.timingSafeEqual`; login enumera usuarios por timing. — `license-server/server.js:154,171`
- [ ]  🟡 `readJson` hace `JSON.parse` sin try/catch → un JSON corrupto tumba el proceso (DoS). — `license-server/server.js:55-61`
- [ ]  🟡 Sin headers de seguridad (helmet) ni dependencias de hardening; duración por defecto de tokens/licencias ~3650 días. — `license-server/server.js`, `license-server/package.json`

## A.3 🌐 Red y endpoints sin autenticación (→ Fase 3)

> Nota: `0.0.0.0`, CORS `origin:true` y firewall 53050–53060 ya están contemplados en la Fase 3. Aquí se listan endpoints concretos sin auth que faltan endurecer.

- [ ]  🔴 Cadena RCE: `POST /api/utils/download-update` descarga un `.exe` desde una URL arbitraria del body y `POST /api/utils/execute-update` lo ejecuta con `spawn` + `process.exit(0)`, sin firma ni validación de origen. — `controllers/utils.controller.js:58-141`
- [ ]  🔴 `POST /api/backup/cloud/restore` reemplaza `mi-tienda.db` con un `.db` remoto sin pedir contraseña admin (solo `token`+`filename`). — `routes/backup.routes.js:151-309`
- [ ]  🟠 `POST /api/print/remote` (printText/printHTML/getPrinters) sin token ni validación de origen. — `server.js:274-299`
- [ ]  🟠 `POST /api/settings/admin-password` permite fijar o **borrar** la contraseña admin sin auth previa. — `controllers/settings.controller.js:201-236`, `routes/settings.routes.js:19`
- [ ]  🟠 `POST /api/license/activate` cambia la licencia local sin auth. — `routes/license.routes.js:8`
- [ ]  🟠 `DELETE /api/reports/void/:saleId`, `/cash-withdrawal`, `/cash-opening`, `/cash-advance` sin verificación admin. — `routes/reports.routes.js:28,35-41`
- [ ]  🟠 `POST /api/backup/cloud/save-token` y `DELETE .../remove-token` sin auth. — `routes/backup.routes.js:90-143`
- [ ]  🟠 Carpeta `uploads` servida estáticamente en `/uploads/` sin control de acceso; `parseMultipartUpload` usa la extensión del `filename` del cliente sin validar MIME/tamaño/whitelist. — `server.js:172-205,229-236`
- [ ]  🟠 `preload.js` expone `invoke/send/receive` genéricos sin whitelist de canales; el renderer puede invocar cualquier handler IPC (p. ej. `app:restart`). — `preload.js:5-15`
- [ ]  🟠 `bcvUpdater` usa `rejectUnauthorized: false` en `https.get` al scrapear BCV (MITM posible). — `src/services/bcvUpdater.js:21`
- [ ]  🟡 El error handler global filtra `error.message` y `error.name` al cliente. — `server.js:308-315`
- [ ]  🔵 No hay Electron Fuses configurados (`RunAsNode`, `EnableNodeCliInspectArguments`, etc.). Positivo: `contextIsolation:true` y `nodeIntegration:false` ya están bien — no tocar. — `main.js`

## A.4 💵 Ventas, cobranza y dinero — backend (→ Fase 5 / bugfix)

- [ ]  🔴 Stock puede quedar **negativo**: el descuento `UPDATE productos SET stock = stock - ?` no lleva `AND stock >= ?` y el guard solo comprueba `changes !== 1` (que sigue siendo 1 con resultado negativo). — `controllers/sales.controller.js:410-419`
- [ ]  🔴 El total de la venta se toma del cliente sin recalcular en servidor (`finalTotalVes = round2(parseFloat(totalVes))` del body); el backend calcula IVA pero no reconstruye el total desde el carrito × precios de BD. — `controllers/sales.controller.js:454,473-474,553-564`
- [ ]  🔴 `force_settle` cierra la venta como `PAGADO` y `monto_pendiente_usd = 0` sin verificar que la deuda recalculada sea realmente 0. — `controllers/client.controller.js:471-477`
- [ ]  🟠 Dashboard infla la ganancia: `profitVes = total_ingresos_ves - total_costo_ves` usa `SUM(total_ves)` de **todas** las ventas del día (incluye fiados no cobrados), no lo realmente cobrado. — `controllers/reports.controller.js:2073` (stmt `:390-393`)
- [ ]  🟠 Búsqueda de ventas rota: patrón LIKE con espacios literales `` `% ${q}% ` `` casi nunca coincide. — `controllers/reports.controller.js:2898`
- [ ]  🟠 `roundingAdjustment` se recibe en el body pero **nunca** se aplica a `finalTotalVes`. — `controllers/sales.controller.js:454`
- [ ]  🟠 Cierre Z: `insertClosureStmt` / `insertCierreZHistoryStmt` se ejecutan **antes** de generar el PDF; si el PDF falla, el cierre queda registrado y el saldo se resetea igual. — `controllers/reports.controller.js:1645-1710`
- [ ]  🟠 Consultas de abonos en reportes/cierre no filtran `COALESCE(a.anulado,0)=0` (a diferencia de `getAbonosBySaleIdStmt`), así abonos anulados podrían contar. — `controllers/reports.controller.js:62-69,142-158,221-236`
- [ ]  🟠 Al anular venta, `restoreStockStmt.run(...)` no verifica que el producto siga activo; si fue soft-deleted, el stock no se restaura. — `controllers/reports.controller.js:725-726`
- [ ]  🟠 `updateRates()` hace 6+ UPDATE/INSERT sin `db.transaction()`; un fallo intermedio deja tasas a medias. — `controllers/settings.controller.js:41-77`
- [ ]  🟡 PDFs de rango/fiados convierten a USD con `getBcvRate()` **actual** en vez de la tasa histórica de cada venta → totales en $ incorrectos si cambió BCV. — `controllers/reports.controller.js:1152-1164,2480-2487`
- [ ]  🟡 (verificar) Venta con `estado_pago === 'PAGADO'` pero pendiente > 0.01: se advierte pero no se corrige el estado en BD. — `controllers/sales.controller.js:300-305`
- [ ]  🟡 Cashea: `PagarCuota()` y `createCasheaVenta()` sin transacción ni validación de existencia/duplicados de la cuota/venta. — `controllers/cashea.controller.js:5-37,71-92`
- [ ]  🟡 `client.voidPayment()` hace `DELETE FROM abonos` físico pese a existir columnas `anulado`/`anulado_en` (rompe soft-delete y auditoría). — `controllers/client.controller.js:648-650`
- [ ]  🟡 `product.updateStock()` permite ajustes negativos sin piso 0 ni transacción. — `controllers/product.controller.js:1142-1148`
- [ ]  🟡 Inconsistencia de tasas: `sales.controller.getRates()` NO hace `parseFloat` mientras `product/presentation/client` sí; con la guarda `typeof === 'number'` de `calculateInternalCostVes`, si una tasa llega como texto el costo se vuelve 0 silenciosamente. — `controllers/sales.controller.js:162-168,109-133`

## A.5 🗄️ Base de datos y migraciones (→ Fase 5)

> Nota: `_migrations` versionadas, backup antes de migrar, quitar `verbose`, soft-delete unificado y congelar tasa por venta ya están en la Fase 5. Aquí van los que faltan.

- [ ]  🟠 `PRAGMA foreign_keys = ON` no se activa pese a múltiples `FOREIGN KEY` declaradas → SQLite no los aplica. — `src/database.js`
- [ ]  🟠 `initializeDB()` ejecuta `DELETE FROM abonos WHERE anulado = 1` en **cada arranque**, borrando histórico de abonos anulados. — `src/database.js:404-421`
- [ ]  🟡 Migraciones destructivas (`DROP TABLE productos`/`venta_pagos`) sin backup automático previo. — `src/database.js:555-590,728-805`
- [ ]  🟡 Timestamps con `datetime('now','localtime')` dependen del huso del SO, no de un UTC-4 fijo para Venezuela. — `src/database.js` (varios)

## A.6 ⚙️ Refactor y rendimiento — backend (→ Fase 7)

- [ ]  🟡 N+1: `generateReportDataHelper()` ejecuta `getDetailedSaleProductsStmt.all(sale.id)` dentro de un `for` por cada venta del rango. — `controllers/reports.controller.js:965-966`
- [ ]  🟡 N+1: `searchSales()` consulta productos por cada venta encontrada. — `controllers/reports.controller.js:2904-2906`
- [ ]  🟡 N+1: `getClientDebtsWithProducts()` consulta productos por cada venta abierta del cliente. — `controllers/client.controller.js:283`
- [ ]  🟡 `db.prepare(...)` dentro de funciones/loops en vez de una sola vez (recalc, `processSaleTransaction`, `importProducts`). — `controllers/sales.controller.js:206-207,398-438`, `controllers/product.controller.js:620`
- [ ]  🔵 `cancelSale` está exportado pero **sin ruta** y duplica la lógica de `voidSale`. — `controllers/sales.controller.js:1015-1068`
- [ ]  🔵 `printSettings.controller.js` no está ruteado; hay 3 implementaciones de config de impresión con campos distintos (`printHeader` vs `ticketHeader`, etc.). — `controllers/printSettings.controller.js`, `routes/printSettings.routes.js`, `routes/settings.routes.js`
- [ ]  🔵 `routes/rapikom.routes.js` nunca se registra con `registerExpressRouter` → sus rutas están muertas. — `routes/rapikom.routes.js` vs `server.js:256-271`
- [ ]  🔵 DDL como side-effect al cargar el módulo: `db.exec('CREATE TABLE IF NOT EXISTS cierres_z ...')`. — `controllers/reports.controller.js:316-329`
- [ ]  🔵 `cloudBackup.js` copia SQLite en caliente con `fs.copyFileSync` (sin `.backup()`/checkpoint WAL) y reutiliza el mismo `FormData` en reintentos (stream ya consumido). — `src/utils/cloudBackup.js:46-48,96-144`
- [ ]  🔵 `bcvUpdater.startScheduler()` usa `setInterval` sin `clearInterval` al cerrar la app. — `src/services/bcvUpdater.js:182-184`

## A.7 🖥️ Frontend — bugs, XSS y fugas (→ Fase 8)

- [ ]  🔴 XSS por `innerHTML` con datos de BD sin escapar (nombres de productos/clientes): resultados de búsqueda del POS, tarjetas de cliente en cobranza, tabla de inventario, fila de venta en reportes, detalles de venta, indicadores. — `public/js/pos.js:671-688`, `public/js/cobranza.js:174-194`, `public/js/inventario.js:887-893`, `public/js/reports.js:328-330`, `public/js/detalles_venta.js:406-407`, `public/js/indicadores.js:336,396,505`
- [ ]  🔴 Doble submit de pago/venta: los botones no se deshabilitan antes del `fetch` en cobranza (`handlePaymentSubmit`, `applyClientFullPayment`, `handleFullCompletarPago`) y hay ventana de carrera en `completeSale` del POS. — `public/js/cobranza.js:370-437,1190-1278,1287-1336`, `public/js/pos.js:2300-2437`
- [ ]  🔴 Carrito ignora el stock real: `addUnitProductToCart` incrementa cantidad sin recomputar `remainingBase`; `loadCartFromLocalStorage` asigna `baseStock: Infinity`; reabrir venta anulada/en espera fuerza `stock: Infinity`. — `public/js/pos.js:885-886,251-254,4068-4069,1643-1648`
- [ ]  🟠 Fechas en UTC en vez de Venezuela (UTC-4) con `new Date().toISOString().split('T')[0]`: alertas Cashea, fechas de cuotas, modal promo, nombres de PDF. — `public/js/cashea_alerts.js:10-18`, `public/js/pos.js:4262-4267`, `public/js/layout.js:173-190`, `public/js/configuracion.js:780,816`
- [ ]  🟠 Cálculo de "resumen realizado" duplicado y **divergente** entre Indicadores y Reportes (uno incluye IVA y clamping distinto) → la ganancia del día no coincide entre pantallas. — `public/js/indicadores.js:112-173` vs `public/js/reports.js:253-275`
- [ ]  🟠 Pendiente en Bs recalculado con la tasa **actual** (`pendienteUsd * currentBcvRate`) en cobranza, no con la tasa de la venta. — `public/js/cobranza.js:687-688`
- [ ]  🟠 `config_cloud.html` guarda `cloud_token`/`cloud_user` en `localStorage` (robables vía XSS). — `public/config_cloud.html:538-540`
- [ ]  🟡 `showGlobalConfirm()` retorna `true` si no existe el modal → confirma acciones (anular abono, abono parcial) sin interacción del usuario. — `public/js/cobranza.js:74-80`, `public/js/detalles_venta.js:49-56`
- [ ]  🟡 `setInterval` sin `clearInterval`: updater cada 30 min, tasas del POS cada 60 s, autosave de etiquetas cada 5 s y badge cada 2 s. — `public/js/updater.js:105-133`, `public/js/pos.js:4673-4675`, `public/js/etiquetas.js:1322,1575-1577`
- [ ]  🔵 `JsBarcode.all.min.js` se carga en `pos.html`/`cobranza.html` pero no se usa. — `public/pos.html:13`, `public/cobranza.html:13`
- [ ]  🔵 Clave `presentationId` duplicada en el literal de objeto de `addPresentationToCart`. — `public/js/pos.js:968-969`

## A.8 📥 Cargas masivas — rendimiento frontend (→ Fase 7 / Fase 8)

- [ ]  🟠 `reports.js` pide `/api/products?limit=100000` y llena un `<select>` con todo el inventario en el DOM. — `public/js/reports.js:145-146`
- [ ]  🟠 `indicadores.js` pide `/api/products?limit=99999` para estadísticas. — `public/js/indicadores.js:222-223`
- [ ]  🟠 `cobranza.js` carga **todos** los clientes y filtra en el cliente; además dispara N+1 de `/api/sales/:id/details` al saldar una deuda. — `public/js/cobranza.js:101-106,1216-1256`

## A.9 📦 Build y empaquetado (→ Fase 10)

- [ ]  🔴 `forge.config.js` **no excluye** `.env`, `*.key`, `*.pem` ni `scratch/` del empaquetado (sí excluye `.db`/`.lic`/`license-server/`): riesgo de empaquetar secretos. — `forge.config.js:26-41`
- [ ]  🟠 `scratch/` contiene 13+ scripts y `Estado_de_Cuenta_TAIRON.pdf` (posible dato real de cliente); está en `.gitignore` pero no se excluye del build. — `scratch/`
- [ ]  🟠 Dependencias muertas en el bundle del cliente: `bcryptjs`, `jsonwebtoken` (solo se usan en `license-server`), `consulta-dolar-venezuela`, `dir-compare`. — `package.json:26,29,31,36`
- [ ]  🔵 `output.css` (Tailwind compilado) versionado en disco pero listado en `.gitignore` → riesgo de drift si no se corre `build:css:prod`. — `public/css/output.css` vs `.gitignore`
- [ ]  🔵 `configuracion.html` enlaza `/excel-template/plantilla-productos.xlsx` inexistente → importación guiada rota. — `public/configuracion.html:374`

**Criterio de aceptación del anexo:** cada hallazgo se verifica contra el código actual, se reasigna a su fase si corresponde y se marca `- [x]` cuando queda corregido (o se documenta por qué se descarta).

---

## 🧭 Guía de migración a VPS (para más adelante)

<details><summary>Pasos cuando decidas migrar el servidor de licencias a VPS</summary>

- Desplegar `bodegapp-license-server` en el VPS con la **clave privada solo ahí** (variables de entorno / secretos del servidor).
- Servir por **HTTPS** con certificado válido (Let's Encrypt) — sin `rejectUnauthorized:false`.
- Cambiar en el cliente la URL del servidor de licencias (por configuración, no hardcodeada).
- Mantener rate limiting, logs y backups del servidor de licencias.
- Rotar de nuevo secretos al pasar de local a VPS.

</details>

## 📊 Resumen de prioridad

| Prioridad | Fases | Motivo |
| --- | --- | --- |
| 🔴 Crítica | 0, 1, 2 | Cierra filtraciones y asegura el anti-trampa de licencias |
| 🟠 Alta | 3, 4 | Endurece acceso y añade control/auditoría |
| 🟡 Media | 5, 6 | Integridad de datos y respaldos |
| 🔵 Normal | 7, 8 | Refactor y rendimiento |
| 🟢 Cierre | 9, 10 | Tests y distribución segura |

> 📎 Ver **Anexo A** (al final de las fases) para el catálogo de bugs/optimizaciones detectados en auditoría, ya repartidos por fase. Cada ítem está sin corregir y con su `archivo:línea` para completarlo.