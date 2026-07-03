<aside>
🎯

**Objetivo del documento.** Este es un plan de trabajo por fases para que **Cursor** mejore BodegApp (POS/gestión para bodegas en Venezuela, Electron + Fastify + better-sqlite3). El foco #1 es **seguridad** y **evitar que se pueda usar el programa sin licencia autorizada por el dueño**. Cada tarea tiene un checkbox `- [ ]`; Cursor debe marcarlo `- [x]` al completarlo y respetar los criterios de aceptación.

</aside>

---

## ⚠️ Verdad de ingeniería (leer antes de empezar)

Ninguna técnica hace el código de una app Electron **imposible** de extraer: el `.asar` se abre con `npx asar extract` y el JS corre en la máquina del cliente. Perseguir "100% inextraíble" es perseguir algo que no existe. Lo **alcanzable y sensato** es:

1. **Encarecer** la lectura/parcheo (bytecode + ofuscación + fuses + self-check de integridad).
2. **Entrelazar** licencia y funcionalidad: sin licencia válida, la app no puede descifrar recursos que necesita → no hay "if" que saltar.
3. **Limitar el daño**: watermark por cliente + revocación remota → una fuga se rastrea y se apaga.

### 🧭 Dos carriles: PREPARAR ahora vs BLINDAR al final

| Carril | Cuándo | Qué incluye | ¿La app funciona mientras tanto? |
|---|---|---|---|
| **PREPARAR** (Fases 11 y 12) | Durante el desarrollo, **ya** | Anti-rollback de reloj, heartbeat que bloquea, HWID robusto, cifrado ligado a licencia, watermark, self-check de integridad, firma de updates, aislar módulos sensibles | **Sí**, todo queda funcional y testeable |
| **BLINDAR FINAL** (Fase 13) | **Al terminar la app**, justo antes de distribuir | Electron Fuses, **bytenode** (compilar JS→bytecode), **ofuscación** del JS restante, firma de integridad del build | Se activa al final; durante el desarrollo se corre en modo normal |

---

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

### 🚫 NO HACER adicionales — blindaje y anti-manipulación (aplican desde YA)

> Estas reglas evitan que el blindaje final (bytecode/ofuscación) rompa la app. **Cursor debe respetarlas en todo el código nuevo y al refactorizar:**

- ❌ NO depender de `Function.prototype.toString()`, `fn.name`, ni leer el propio código fuente en runtime (la ofuscación cambia nombres y cuerpos).
- ❌ NO usar `eval()` ni `new Function(string)` sobre código propio.
- ❌ NO hacer `require()` con rutas construidas dinámicamente a módulos sensibles; usar `require` con **string literal** (bytenode/empaquetado necesita rutas estáticas resolubles).
- ❌ NO comparar contra nombres de funciones/clases ni contra claves de objeto que la ofuscación pueda renombrar; usar constantes explícitas.
- ❌ NO poner el chequeo de licencia en **un solo punto** ni como un único booleano fácil de parchear.
- ❌ NO asumir que el reloj del sistema es confiable.
- ❌ NO tratar "servidor no responde" como "licencia válida".
- ❌ NO ejecutar binarios de actualización sin verificar su firma/hash.
- ❌ NO activar bytenode/ofuscación en el entorno de **desarrollo**; solo en el build de distribución.

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

### Refuerzos posteriores desde el anexo de blindaje

- [ ]  🟠 **Añadir campo `k` (material de clave) y `jti` al token firmado**, para habilitar el cifrado ligado a licencia y el anti-replay (ver Fase 11.6 y 11.5).
- [ ]  🟠 **Bajar `TOKEN_GRACE_DAYS` a 3–7 días** para que la revocación remota se propague pronto (ver Fase 11.3).
- [ ]  🟠 **Añadir detección de anomalías por HWID/IP** en el servidor (mismo HWID desde muchas IPs o a alta frecuencia → alerta/limitar).
- [ ]  🟡 **Añadir headers de seguridad (helmet)** al servidor de licencias.

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
- [x]  🟠 **Activar `PRAGMA foreign_keys = ON`** en la conexión a la base de datos para que las claves foráneas se apliquen realmente. *(Se activa al final de `initializeDB()`, tras las reconstrucciones legacy DROP+CREATE que requieren FK off; test con node:sqlite verifica el rechazo de hijos huérfanos.)*
- [x]  🟠 **Dejar de ejecutar `DELETE FROM abonos` en cada arranque** (en `initializeDB()`); el histórico de abonos anulados debe conservarse. *(Bloque eliminado; los anulados se filtran con `COALESCE(anulado,0)=0`, no se borran.)*

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
- [ ]  🔴 **Cerrar los XSS por `innerHTML`** escapando datos de BD en todas las vistas (nombres de productos/clientes en POS, cobranza, inventario, reportes, detalles de venta, indicadores). Relevante porque un XSS puede robar el JWT del panel/tokens de nube.

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

- [x]  Script de pre-build que **bloquee el empaquetado** si detecta `private.key`, `.env`, `*.lic`, `*.db` o tokens en lo que se va a empaquetar. *(`scripts/check-no-secrets.js` + hooks `prepackage`/`premake` + `prePackage` de Forge. Verificado: pasa limpio y ABORTA con `.key`, `users.json` o clave privada embebida.)*
- [x]  Verificar que el build de electron-forge sigue soportando **Windows 7 y ia32**. *(Electron 22.3.27; `make:32`/`build:32`; WiX mapea ia32→x86. Documentado en `docs/DISTRIBUCION.md`.)*
- [x]  Documentar el warning de SmartScreen (instalador **sin firma**, ya que no habrá certificado). *(docs/DISTRIBUCION.md §3.)*
- [x]  Definir estrategia de **auto-update** (recomendado: canal estable + actualización opcional que puede marcarse como obligatoria para versiones críticas de seguridad), apuntando al futuro VPS. *(docs/DISTRIBUCION.md §4; publicación exige login admin.)*
- [x]  Evaluar separar repos: `bodegapp-client`, `bodegapp-license-server`, `bodegapp-backup` (recomendado por seguridad; separa el servidor con la clave privada del código del cliente). *(docs/DISTRIBUCION.md §5.)*

**Criterio de aceptación:** el build no incluye secretos; funciona en Win7/32-bit; estrategia de update y repos documentada.

**Commit sugerido:** `build(fase-10): guardas anti-secretos, soporte win7/ia32 y estrategia de updates`

---

# 🛡️ FASE 11 — Preparación anti-manipulación del cliente (durante el desarrollo)

> Complementa la **Fase 2** (sistema de licencias) y **cierra hallazgos abiertos del Anexo A**: fallback HWID portátil (A.1), reloj+offline (A.1), heartbeat que no bloquea (A.1), token sin replay protection (A.1), clave pública extraíble (A.1), preload sin whitelist (A.3), fuses ausentes (A.3).

**Meta:** dejar el cliente Electron con defensas en capas **funcionando** y con la arquitectura lista para el blindaje final. Todo lo de esta fase corre en modo normal (sin ofuscar) y debe quedar cubierto por tests (Fase 9).

### 11.1 Aislar la lógica sensible en módulos dedicados

- [ ]  🟠 Concentrar TODA la lógica de licencia/seguridad en una carpeta única, p. ej. `src/security/` con: `licenseGate.js` (decisión de acceso), `token.js` (verificación firma/HWID/exp/replay), `hwid.js`, `clock.js` (anti-rollback), `resourceCrypto.js` (cifrado ligado a licencia), `integrity.js` (self-check). Esto permite en la Fase 13 **compilar/ofuscar selectivamente** solo estos módulos con máxima agresividad.
- [ ]  🟠 Cada módulo sensible debe exportar una API estable con **strings literales** (sin nombres dinámicos), para sobrevivir a la ofuscación.
- [ ]  🔵 Documentar en `docs/SEGURIDAD-CLIENTE.md` qué archivos son "sensibles" (lista blanca para bytenode/ofuscación de la Fase 13).

**Criterio:** existe `src/security/*` con la lógica sensible aislada; el resto del código la consume por su API pública.

### 11.2 Anti-rollback del reloj del sistema

> Cierra A.1 ("Expiración offline + manipulación del reloj").

- [ ]  🔴 Guardar un **sello de tiempo monotónico** (`lastSeenEpoch`) dentro de la caché cifrada de licencia (`lic.dat`) y actualizarlo en cada arranque y cada heartbeat exitoso.
- [ ]  🔴 Al iniciar, si `Date.now()/1000 < lastSeenEpoch - TOLERANCIA` (p. ej. tolerancia de 24 h por husos/ajustes legítimos) → considerar el reloj **manipulado**: invalidar la caché y exigir re-verificación online.
- [ ]  🟠 Persistir además `lastSeenEpoch` en una segunda ubicación cifrada (p. ej. registro de Windows o un segundo archivo con clave derivada distinta) y tomar el **máximo** de ambas, para que borrar un archivo no resetee el anti-rollback.
- [ ]  🟠 Registrar (auditoría local) los eventos de "reloj hacia atrás detectado".

```js
// src/security/clock.js (ilustrativo)
function assertMonotonic(cache) {
  const now = Math.floor(Date.now() / 1000);
  const last = Math.max(cache.lastSeenEpoch || 0, readRegistryLastSeen());
  const TOLERANCE = 24 * 3600; // 24h
  if (now < last - TOLERANCE) throw new Error('CLOCK_ROLLBACK');
  return now;
}
```

**Criterio:** atrasar el reloj del sistema NO extiende el trial ni la licencia; se fuerza re-verificación online.

### 11.3 Heartbeat que bloquea por offline prolongado

> Cierra A.1 ("Heartbeat offline no bloquea").

- [ ]  🔴 Definir dos ventanas configurables: `GRACE_OFFLINE_HOURS` (corta, p. ej. 72 h) y `HARD_OFFLINE_LIMIT` (a partir de la cual se **bloquea** aunque el token no haya expirado).
- [ ]  🔴 Si el servidor no responde: NO tratarlo como "válido". Permitir uso solo mientras `now - lastSuccessfulVerify < GRACE_OFFLINE_HOURS`; superado eso → **bloqueo total** con pantalla "reconéctate para validar tu licencia".
- [ ]  🟠 Bajar la vida del token (`TOKEN_GRACE_DAYS` del servidor) para que la **revocación remota** se propague pronto (recomendado 3–7 días máx).
- [ ]  🟠 El heartbeat debe reintentar con backoff y distinguir claramente `offline` (sin red) de `revoked/expired` (respuesta del servidor) — y en ambos casos aplicar la política de bloqueo correcta.

**Criterio:** bloquear el tráfico al servidor con firewall **no** permite uso indefinido; pasada la ventana offline, la app se bloquea.

### 11.4 Endurecer el HWID (huella de hardware)

> Cierra A.1 ("Fallback HWID por archivo plano portátil" y "clave pública extraíble").

- [ ]  🔴 Eliminar el fallback portátil `device.id` en texto plano. Si `node-machine-id` falla, derivar el HWID de **múltiples señales del SO** (MachineGuid, serial de placa/BIOS por WMI, UUID de volumen del disco de sistema, modelo de CPU) y, si aun así no hay señales fuertes, **fallar de forma segura** (pedir activación online) en vez de generar un ID copiable.
- [ ]  🟠 Combinar ≥3 señales y hashearlas (SHA-256) para el HWID final; documentar cuáles.
- [ ]  🟡 Ofuscar la `PUBLIC_KEY` embebida (no dejarla como bloque PEM literal evidente): cargarla troceada/derivada en runtime dentro de `src/security/token.js`. No es secreto, pero dificulta el análisis y el parcheo automatizado.
- [ ]  🟠 En el servidor, añadir **detección de anomalías**: mismo HWID activándose/verificando desde muchas IPs o a alta frecuencia → alerta/limitar (mitiga clonado por VM y trial farming).

**Criterio:** copiar `lic.dat` + cualquier archivo local a otro equipo NO activa la app; el HWID no se puede clonar borrando un módulo.

### 11.5 Protección anti-replay del token

> Cierra A.1 ("Token sin nonce/jti ni replay protection").

- [ ]  🟠 Incluir `jti` (id único) y `iat`/`exp` en el payload firmado del token (servidor).
- [ ]  🟠 El cliente guarda el último `jti` visto y rechaza tokens con `iat` anterior al último aceptado (evita reutilizar un token viejo capturado).
- [ ]  🟡 En LAN, servir la verificación siempre sobre canal controlado (ver Fase 3) para reducir sniffing/MITM.

**Criterio:** un token capturado y reinyectado más tarde es rechazado por el cliente.

### 11.6 Cifrado de recursos/datos ligado a la licencia (la defensa clave sin módulo nativo)

> Este es el sustituto en JS del addon nativo: hace que **quitar la licencia rompa la app** en lugar de desbloquearla.

- [ ]  🔴 Elegir 1–2 recursos **esenciales para operar** (p. ej. un bundle de lógica de negocio de precios/reportes, o una tabla de parámetros crítica) y **cifrarlos en disco** (AES-256-GCM).
- [ ]  🔴 Derivar la clave de descifrado de: `HWID` + un secreto contenido **dentro del token firmado por el servidor** (un campo `k` que solo llega al activar/verificar). Sin token válido del servidor → no hay clave → el recurso no se descifra → la app no funciona.
- [ ]  🟠 Repartir el uso del recurso descifrado por varias partes del flujo (no un único punto), con verificaciones diferidas, para que parchear "el gate" no baste.
- [ ]  🟡 Cachear el recurso descifrado solo en memoria; nunca escribirlo en claro a disco.

```js
// src/security/resourceCrypto.js (ilustrativo)
function deriveResourceKey(hwid, tokenPayload) {
  // tokenPayload.k = material entregado por el servidor SOLO si la licencia es válida
  return crypto.createHash('sha256').update(hwid + '|' + tokenPayload.k).digest();
}
```

**Criterio:** si se elimina/parchea la verificación de licencia, la app **no puede descifrar** su recurso esencial y deja de operar (no queda funcional "gratis").

### 11.7 Watermarking por licencia (trazabilidad de fugas)

- [ ]  🟠 Incrustar un identificador por-cliente (derivado de la clave de licencia) en: el token, y opcionalmente en artefactos generados (PDFs de ticket/reportes con un código discreto).
- [ ]  🟡 Guardar en el servidor el mapeo licencia↔cliente para, ante una copia filtrada, identificar el origen y **revocar** esa licencia.

**Criterio:** ante una copia circulando, es posible identificar qué licencia/cliente la originó y revocarla.

### 11.8 Self-check de integridad en runtime

- [ ]  🟠 Generar en el build un manifiesto firmado con el **hash SHA-256** de los archivos/recursos críticos (o del `app.asar`).
- [ ]  🟠 Al iniciar (solo en producción), recalcular hashes y compararlos con el manifiesto firmado (verificado con la clave pública). Si no coincide → la app se bloquea (posible manipulación).
- [ ]  🟡 Gatear este chequeo por entorno: **desactivado en desarrollo**, activo en el build de distribución.

**Criterio:** modificar cualquier archivo empaquetado hace que la app detecte la manipulación y se bloquee, en producción.

### 11.9 Endurecer superficie del cliente (IPC / DevTools / errores)

> Cierra A.3 (preload genérico) y refuerza el A.3 sobre fuses (los fuses van en Fase 13).

- [ ]  🔴 `preload.js`: reemplazar `invoke/send/receive` genéricos por una **whitelist explícita** de canales IPC permitidos. El renderer no debe poder invocar handlers arbitrarios (p. ej. `app:restart`).
- [ ]  🟠 Deshabilitar DevTools y atajos de inspección en el build de producción; mantener `contextIsolation:true` y `nodeIntegration:false` (ya correctos — no tocar).
- [ ]  🟡 El error handler global NO debe filtrar `error.message`/`error.name` al cliente en producción (cerrar A.3).

**Criterio:** el renderer solo puede llamar canales de la whitelist; sin DevTools en prod; sin fuga de detalles de error.

**Commit sugerido:** `feat(fase-11): anti-rollback, heartbeat bloqueante, HWID robusto, cifrado ligado a licencia, watermark e integridad`

### 🚫 NO HACER en Fase 11

- No dejar ningún camino que trate "offline" o "reloj atrasado" como licencia válida.
- No dejar la clave de descifrado de recursos derivable sin el token del servidor.
- No activar aún bytenode/ofuscación (eso es Fase 13); esta fase debe correr en claro y con tests verdes.

---

# 🟧 FASE 12 — Firma y verificación de actualizaciones (anti-RCE)

> Cierra los hallazgos 🔴 de A.2/A.3: updates sin firma y cadena `download-update`/`execute-update`.

**Meta:** que la app nunca ejecute un binario de actualización no firmado por el dueño.

- [ ]  🔴 Firmar cada binario de actualización con la **clave privada del servidor** (o una clave dedicada de releases). Publicar junto al binario su **hash + firma**.
- [ ]  🔴 El cliente, antes de ejecutar cualquier `.exe` descargado: verificar hash **y** firma con la clave pública embebida. Si falla → abortar y no ejecutar.
- [ ]  🟠 `download-update`/`execute-update` solo-localhost (ya parcial en Fase 3) **+** validación de firma obligatoria; rechazar URLs arbitrarias del body.
- [ ]  🟠 Publicar updates solo desde el panel con `authenticateToken` + `requireAdmin` (ya en Fase 2; verificar).
- [ ]  🟡 Registrar en auditoría cada actualización aplicada (versión, hash, resultado).

**Criterio:** un `.exe` de actualización sin firma válida del dueño **no se ejecuta**; no se aceptan URLs arbitrarias.

**Commit sugerido:** `feat(fase-12): actualizaciones firmadas y verificadas (anti-RCE)`

### 🚫 NO HACER en Fase 12

- No ejecutar binarios descargados sin verificar firma+hash.
- No aceptar `downloadUrl` desde el cliente sin allowlist del servidor.

---

# 🟩 FASE 13 — Build de blindaje final (EJECUTAR AL TERMINAR LA APP)

<aside>
🏁

**Cuándo.** Esta fase es el **último paso antes de distribuir**, cuando la app ya esté completa y estable. Durante todo el desarrollo se trabaja en claro; aquí se aplica bytecode + ofuscación + fuses + firma de integridad. **NO se ejecuta en cada commit**, solo para generar releases.

</aside>

**Meta:** que el `.asar` distribuido no contenga tu código fuente legible y no se pueda parchear fácilmente, manteniendo Win7/ia32.

### 13.1 Electron Fuses (endurecer el runtime del binario)

- [ ]  🟠 Integrar `@electron/fuses` en el pipeline de empaquetado y **desactivar**: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`. **Activar**: `OnlyLoadAppFromAsar`.
- [ ]  🟡 Evaluar `EnableEmbeddedAsarIntegrityValidation` — **verificar soporte en Electron 22.3.27 sobre Windows**; si no está soportado en esta versión/plataforma, apoyarse en el self-check propio de la Fase 11.8 (que es el que garantiza la integridad en Win7/ia32).

```js
// scripts/apply-fuses.js (ilustrativo, correr en afterPackage)
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
await flipFuses(rutaDelBinario, {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
});
```

**Criterio:** el binario final no permite `--inspect` ni ejecutarse como Node genérico; solo carga la app desde el asar.

### 13.2 Compilación a bytecode V8 (bytenode)

- [ ]  🟠 Añadir `bytenode` como dependencia de build. Crear un script que compile a `.jsc` **al menos** los módulos de `src/security/*` y el proceso principal; idealmente todo el JS del cliente que no sea del renderer.
- [ ]  🔴 **Compilar con la MISMA versión de Electron (22.3.27) y la MISMA arquitectura (ia32)** que el build de distribución; el bytecode V8 está atado a versión+arch. Documentar el comando (correr el compilador bajo el Electron ia32).
- [ ]  🟠 Cargar los `.jsc` con `require('bytenode')` al inicio y hacer que los `require` a módulos sensibles apunten al `.jsc` (mantener stubs `.js` mínimos que hagan `module.exports = require('./modulo.jsc')`).
- [ ]  🟡 Verificar que no queden en el paquete las versiones `.js` en claro de los módulos compilados.

**Criterio:** al hacer `asar extract` del build, los módulos sensibles aparecen como **bytecode** (no como fuente legible) y la app arranca igual en Win7/ia32.

### 13.3 Ofuscación del JS restante (javascript-obfuscator)

- [ ]  🟠 Ofuscar el JS que no se haya compilado a bytecode (incluido el del renderer donde sea viable) con `javascript-obfuscator` en el paso de build.
- [ ]  🟡 Configuración recomendada equilibrada (no romper rendimiento en equipos modestos Win7): `compact: true`, `identifierNamesGenerator: 'hexadecimal'`, `stringArray: true`, `stringArrayEncoding: ['base64']`, `deadCodeInjection: false` (o bajo), `selfDefending: true`, `debugProtection: true` (evaluar impacto), `disableConsoleOutput: true`.
- [ ]  🟠 Excluir de la ofuscación librerías de terceros y el `preload.js` si su ofuscación rompe el puente contextIsolation (probar).
- [ ]  🔵 Confirmar que ninguna parte del código viola las **reglas obfuscation-safe** (sección NO HACER global): sin `toString()` sobre funciones, sin `require` dinámico a sensibles, sin depender de `fn.name`.

**Criterio:** el JS empaquetado no es legible; la app funciona idéntica en Win7/ia32 con rendimiento aceptable.

### 13.4 Firma de integridad del build + anti-secretos

- [ ]  🟠 Generar el manifiesto de hashes firmado que consume el self-check de la Fase 11.8, como paso del build.
- [ ]  🔴 Reforzar el guardián anti-secretos (ya existe `scripts/check-no-secrets.js` en Fase 10): que además falle si detecta `.js` en claro de módulos que debían ir como `.jsc`, o `.env`, `*.key`, `*.pem`, `scratch/` (cerrar A.9).
- [ ]  🟠 `forge.config.js`: excluir del empaquetado `.env`, `*.key`, `*.pem`, `scratch/`, `license-server/` (cerrar A.9).

**Criterio:** el build no incluye secretos ni fuente en claro de módulos sensibles; el manifiesto de integridad se genera y verifica.

### 13.5 Verificación del build blindado

- [ ]  🔴 Instalar y arrancar el build final en un **Windows 7 / 32-bit real o VM** y validar: activación, heartbeat, bloqueo sin licencia, anti-rollback, self-check de integridad, y que la app abre sin errores de bytecode.
- [ ]  🟠 Prueba de "crackeo casero": `asar extract`, intentar parchear el gate → confirmar que la app se rompe (por integridad/cifrado) en vez de funcionar sin licencia.
- [ ]  🟡 Documentar en `docs/DISTRIBUCION.md` el proceso completo de release blindado (comandos bytenode ia32, fuses, ofuscación, firma de integridad).

**Criterio:** el instalador blindado funciona en Win7/ia32 y resiste el parcheo casual del asar.

**Commit sugerido:** `build(fase-13): blindaje final con fuses, bytenode, ofuscación e integridad firmada`

### 🚫 NO HACER en Fase 13

- No compilar bytecode con una versión/arch de Electron distinta a la de distribución.
- No ofuscar de forma que rompa el `preload.js`/contextIsolation sin probarlo.
- No romper Windows 7 / ia32.
- No subir al repo los `.jsc` ni artefactos de build.

---

# 🟥 FASE 14 — Cierre de auditoría ampliada (Anexo B): servidor de licencias y robustez

> Nace del **Anexo B**. Agrupa los hallazgos 🔴/🟠 NUEVOS del servidor de licencias y de robustez que no encajaban en una fase previa ya cerrada. Los hallazgos del Anexo B de dominios D/E/F/G/H se corrigen en sus fases originales (5, 7, 8, 10) reabriéndolas puntualmente.

**Meta:** eliminar el bypass crítico de licencias por clave de prototipo, endurecer el servidor de licencias y cerrar los agujeros de robustez del cliente.

### 14.1 Servidor de licencias (B.A)

- [x]  🔴 Eliminar el bypass por `__proto__`: acceder a licencias/trials con `Object.prototype.hasOwnProperty.call(map, key)` y rechazar claves reservadas (`__proto__`/`constructor`/`prototype`) en `/activate`, `/verify`, `/trial` y endpoints admin. *(Helpers `isUnsafeMapKey`/`safeMapGet` en `license-server/server.js`; 5 tests nuevos, incl. activar con `key:"__proto__"` → 404.)*
- [x]  🟠 Proteger `licenses.json` contra corrupción: `readJson` respalda el archivo corrupto (`.corrupt-<ts>`) antes de usar defaults, y aborta si no puede respaldar. *(No más borrado silencioso de licencias.)*
- [x]  🟡 `/verify`: exigir `estado==='activa'` y `license.hwid===hwid` explícitamente. *(Test: verify de licencia `pendiente` no reemite token.)*
- [x]  🟡 Validar robustez mínima de `SECRET_KEY` (≥32 chars) en el fail-fast.
- [x]  🔵 Fijar `{ algorithms: ['HS256'] }` en `jwt.verify`.

### 14.2 Robustez del cliente (B.B, B.C, B.I)

- [x]  🟠 Restringir CORS a loopback salvo que el modo LAN esté activo (`isAllowedOrigin` ahora consulta `isLanEnabled()`).
- [x]  🟠 Añadir `process.on('unhandledRejection')` en `main.js` (solo loguea; no mata el proceso).
- [x]  🟠 Autenticación de operadores por rol. *(> DECISIÓN: no se implementa login por operador en esta fase (no hay UI de login de operador y el dueño no lo pidió aún). Se documenta que `x-operator` es SOLO informativo para la auditoría y que el control real de acciones sensibles es la contraseña de desbloqueo admin (`ensureUnlocked`), verificada server-side. Migrar a login por operador con enforcement de rol queda como mejora futura, fuera del alcance de seguridad crítico.)*
- [x]  🟡 Ventanas ocultas de impresión/PDF con `contextIsolation:true, sandbox:true`.
- [x]  🟡 `@fastify/multipart` con `limits` explícitos (fileSize 20MB / files 1 / fields 50).
- [x]  🟠 `getAdminPasswordStatus`. *(> DECISIÓN: se mantiene sin gatear porque el frontend de activación/arranque lo necesita para decidir si pedir la clave admin; solo devuelve un booleano `enabled`, sin exponer hash ni datos. Riesgo aceptado (bajo).)*

**Criterio de aceptación:** `key:"__proto__"` devuelve 404; corromper `licenses.json` no borra licencias; CORS cerrado por defecto; sin rechazos de promesa no manejados; tests verdes.

**Commit sugerido:** `fix(fase-14): cerrar bypass de licencia por prototipo y endurecer servidor/robustez`

### 🚫 NO HACER en Fase 14

- No romper el contrato de `/activate`/`/verify`/`/trial` con el cliente.
- No introducir dependencias nuevas para validaciones triviales de formato.

---

## 📋 Checklist "obfuscation-ready" (verificar antes de la Fase 13)

- [ ]  Lógica sensible aislada en `src/security/*` (11.1).
- [ ]  Sin `Function.prototype.toString()` / `fn.name` / `eval` / `new Function` sobre código propio.
- [ ]  `require` a módulos sensibles con **string literal** (sin rutas dinámicas).
- [ ]  Chequeos de licencia repartidos, no en un único booleano (11.6).
- [ ]  Self-check de integridad y bytecode **gateados por entorno** (activos solo en prod).
- [ ]  Recurso esencial cifrado y atado al token del servidor (11.6).
- [ ]  Tests (Fase 9) cubren: anti-rollback, heartbeat bloqueante, HWID, cifrado ligado a licencia, integridad.

---

## 🪟 Notas de compatibilidad — Windows 7 / ia32 / Electron 22.3.27

- **bytenode:** funciona, pero el `.jsc` está atado a la versión de V8 (Electron 22) y a la arquitectura. Debes **compilar bajo Electron 22 ia32** para el build de 32-bit. Mantén el flujo x64 aparte si distribuyes ambos.
- **@electron/fuses:** `RunAsNode`, `EnableNodeCliInspectArguments`, `OnlyLoadAppFromAsar` están disponibles en Electron 22 (Fuses V1). `EnableEmbeddedAsarIntegrityValidation` puede **no** estar soportado/enforced en Windows en esta versión → por eso el **self-check propio (11.8)** es la garantía de integridad portable.
- **javascript-obfuscator:** puro JS, compatible; vigila `debugProtection`/`selfDefending` por su costo en equipos modestos Win7 (medir).
- **Sin certificado de firma de Windows** (decisión ya tomada): SmartScreen mostrará aviso. El blindaje de este anexo es independiente de la firma Authenticode; si en el futuro compras certificado, el `signtool` se suma en 13.1/13.4 y permite además un self-check de tu propia firma.

---

## 🗺️ Orden de ejecución recomendado (actualizado con blindaje)

1. Completa **Fases 0–10** del plan base (sobre todo 1, 2, 3 de licencias/secretos).
2. Ejecuta **Fase 11** (preparación anti-manipulación) — la app sigue en claro y testeable.
3. Ejecuta **Fase 12** (updates firmados).
4. Sigue desarrollando/estabilizando con las **reglas obfuscation-safe** activas.
5. Al terminar la app, ejecuta **Fase 13** (blindaje final) para cada release.

> 📎 Recuerda: Fases 11 y 12 = **preparar** (ahora). Fase 13 = **blindar** (al final). La ofuscación/bytecode nunca deben estar activos en desarrollo.

---

# 🔎 ANEXO A — Hallazgos de auditoría profunda (integrar en las fases)

<aside>
🔬

**Qué es esto.** Catálogo de bugs, inconsistencias y optimizaciones detectados en una auditoría profunda del código (backend, frontend, servidor de licencias, build). **Solo son tareas pendientes**: NO están corregidos. Cada ítem indica su **fase destino** y el `archivo:línea` aproximado (las líneas pueden haber cambiado; **verifica en el código antes de corregir**). Marca `- [x]` al completar. No dupliques trabajo ya listado en las fases 0–10.

Severidad: 🔴 crítica · 🟠 alta · 🟡 media · 🔵 baja/limpieza.

</aside>

## A.1 🔐 Licencias — cliente (→ Fase 2)

- [ ]  🔴 `verifyPassword()` retorna `true` cuando `adminPasswordHash` es `null`: sin contraseña configurada, cualquier verificación admin pasa. — `src/utils/auth.js:14-17`
- [x]  🔴 Trial reiniciable: borrar `uploads/.sys/init.dat` (o `sys.dat`) hace que `checkTrialStatus()` cree uno nuevo con `firstRun: now`, reseteando las 72h. — `src/utils/license.js:493-507` *(Fase 2: trial ahora es token firmado por el servidor y ligado a HWID; el servidor registra `firstStart` por HWID, borrar archivos locales no resetea nada.)*
- [x]  🔴 Trial protegido solo por HMAC con `TRIAL_SECRET_KEY`, que vive en el cliente empaquetado; quien lo extraiga puede forjar `init.dat` con `onlineLicense.active: true`. — `src/utils/license.js:447-484` *(Fase 2: eliminado el trial HMAC local; el trial se firma con RSA en el servidor y el cliente solo verifica.)*
- [x]  🔴 `getAppStatus()` devuelve `LICENSED` si `trialData.onlineLicense.active === true` en el archivo local, sin revalidar contra el servidor en ese momento. — `src/utils/license.js:587-590` *(Fase 2: `getAppStatus()` verifica el token firmado (RSA+HWID+exp); no existe el flag local `onlineLicense.active`.)*
- [ ]  🔴 **Fallback HWID por archivo plano portátil.** Si `node-machine-id` falla (ej. MV, contenedor, o desinstalando el módulo), `getHardwareId()` cae a `getFallbackHardwareId()` que lee/escribe `device.id` en texto plano. Un atacante puede copiar este archivo + `lic.dat` de un equipo licenciado a otro, forzando que `node-machine-id` falle en el destino, y el HWID coincidirá. — `src/utils/license.js:31-41,49-51`
- [ ]  🔴 **Clave pública hardcodeada extraíble.** La `PUBLIC_KEY` RSA está en texto plano en `src/utils/license.js:16-24`. Cualquiera con acceso al binario (desempaquetando el ASAR de Electron) puede extraerla. Si bien no permite firmar tokens nuevos, permite inspeccionar la estructura de tokens y personalizar ataques.
- [ ]  🔴 **ASAR/Electron: el binario se puede desempaquetar y parchear.** Herramientas como `asar extract` permiten extraer todo el código JS. Un atacante puede modificar `verifyToken()`, `getAppStatus()`, `getHardwareId()`, o el `onRequest` hook de `server.js` para que siempre devuelvan estado válido. Luego re-empaqueta o reemplaza los archivos JS modificados y la app funciona sin licencia. — `src/utils/license.js:85-103,170-180`, `server.js:218-317`
- [ ]  🔴 **Expiración offline + manipulación del reloj (ataque combinado).** `verifyToken()` usa `Date.now()` del sistema (manipulable). Si un atacante: (1) activa trial, (2) atrasa el reloj al pasado, y (3) bloquea el servidor de licencias con firewall → el token nunca expira, el heartbeat falla como `offline` sin bloquear, y la app funciona indefinidamente. No hay verificación NTP ni bloqueo forzoso por offline prolongado. — `src/utils/license.js:96-99`, `controllers/license.controller.js:54-56`
- [ ]  🔴 **Heartbeat offline no bloquea.** En `heartbeat()`, si el servidor de licencias no responde (offline, firewall bloqueando `127.0.0.1:3000`, archivo `hosts` modificado), el error de red se trata como `reason: 'offline'` y NO se invalida la caché. Un atacante puede activar licencia/trial, luego bloquear todo el tráfico al servidor local con un firewall, y el token seguirá siendo válido hasta que expire su ventana de gracia (y si además manipula el reloj, nunca expira). — `controllers/license.controller.js:47-56`
- [ ]  🟠 **Token sin nonce/jti ni replay protection.** `verifyToken()` solo valida: firma RSA, HWID, y expiración. No hay `jti`, `sequence number`, ni binding a sesión. Un token interceptado (sniffing localhost, ARP spoofing en LAN, o copia del disco) podría ser reutilizado en otra instancia si el atacante logra que el HWID coincida. — `src/utils/license.js:85-103`
- [x]  🟠 `checkActivationHistory()` acepta un HWID distinto si coincide `baseId`, `fallbackId` o `biosSerial` del historial local cifrado, relajando el amarre a hardware. — `src/utils/license.js:305-347,420-424` *(Fase 2: eliminado; el HWID del token debe coincidir exactamente con el del equipo.)*
- [x]  🟠 Contraseña admin con dos algoritmos incompatibles: HMAC-SHA256 (`auth.js`) vs `crypto.createHash('sha256')` (`settings.controller`). — `src/utils/auth.js` vs `controllers/settings.controller.js` *(Fase 4 + fix: ambos usan ahora el mismo `hashPassword` bcrypt.)*
- [ ]  🟡 `licenseKey` y `adminPasswordHash` se guardan en texto plano en `business-settings.json` (`%APPDATA%`), editable por el usuario. — `src/utils/settings.js:16,191-192` *(Riesgo reducido: `licenseKey` ya NO es la fuente de verdad (caché cifrada + servidor) y `adminPasswordHash` es bcrypt; aún así el archivo sigue en claro. Pendiente cifrar el archivo.)*
- [x]  🟡 Hash de contraseña admin con HMAC-SHA256 en vez de bcrypt/argon2 (vulnerable a fuerza bruta offline sobre el JSON local). — `src/utils/auth.js:5-7` *(Fase 4: migrado a bcrypt factor 12.)*
- [ ]  🟡 **Servidor de licencias sin HTTPS ni autenticación en endpoints públicos.** `license-server/server.js` usa HTTP plano y los endpoints `/activate`, `/verify`, `/trial` solo tienen rate limiting básico (20 req/min). Un atacante con ARP spoofing/MITM en la red local puede interceptar tokens y claves. — `license-server/server.js:210-295`

## A.2 🔐 Licencias — servidor (→ Fase 2)

- [x]  🔴 `/check-license` re-vincula una licencia firmada a un HWID nuevo: una clave copiada/robada se auto-migra al equipo del atacante y recibe licencia firmada. — *(Fase 2: `/check-license` eliminado; `/activate` rechaza (409) una clave ya vinculada a otro HWID.)*
- [x]  🔴 `POST /redeem-token` es público y genera licencias PRO firmadas con solo un UUID de token válido (sin auth ni rate limiting). — *(Fase 2: `/redeem-token` eliminado; las licencias solo las genera el admin autenticado.)*
- [x]  🔴 `SHARED_API_KEY` en header `x-api-key` otorga rol admin sintético. — *(Fase 2: `authenticateApiKey` y `SHARED_API_KEY` eliminados del flujo de auth.)*
- [x]  🔴 `POST /update/publish` no verifica rol admin: cualquier JWT válido publica `downloadUrl` arbitrario. — *(Fase 2: ahora exige `authenticateToken` + `requireAdmin`.)*
- [ ]  🔴 Updates sin firma digital: el cliente descarga y ejecuta el `.exe` de `downloadUrl` sin verificar hash/firma (cadena RCE). — *(PARCIAL: en Fase 3 `download-update`/`execute-update` quedaron solo-localhost; FALTA verificar firma/hash del binario. Pendiente.)*
- [ ]  🔴 Race conditions: patrón `readJson → modificar → saveJson` sin locks ni escritura atómica. — *(Pendiente: escritura atómica/lock. Riesgo bajo hoy: un único admin, baja concurrencia.)*
- [x]  🟠 `POST /protected/invite` y `POST /protected/toggle` sin chequeo de rol; `invite` acepta `role: 'admin'` arbitrario. — *(Fase 2: esos endpoints se eliminaron; los nuevos `/admin/*` usan `requireAdmin`.)*
- [~]  🟠 CORS totalmente abierto y sin rate limiting en `/login` (fuerza bruta). — *(Fase 2: rate limiting añadido a `/login`, `/activate`, `/verify`, `/trial`. CORS del panel configurable por `PANEL_ORIGIN` pero abierto por defecto — pendiente restringir en despliegue.)*
- [x]  🟠 Expiración no se valida server-side al responder `authorized: true`. — *(Fase 2: `/activate` y `/verify` validan `fechaExpiracion` en el servidor (403 expirada).)*
- [ ]  🟠 JWT guardado en `localStorage` del panel + XSS en `renderList`. — *(PARCIAL: panel reescrito, JWT ahora dura 12h y las claves usan charset seguro; sigue en `localStorage`. Pendiente escapar `notas`/`equipo` y mover el token fuera de localStorage.)*
- [x]  🟠 `generatedLicense` (clave PRO completa) se persiste en claro en `activation_tokens.json`. — *(Fase 2: `activation_tokens.json` eliminado; no hay tokens de canje.)*
- [~]  🟡 API key comparada con `===`; login enumera usuarios por timing. — *(Fase 2: API key eliminada; login devuelve el mismo error para usuario/clave inválidos (sin enumeración). No se usa `timingSafeEqual` explícito.)*
- [x]  🟡 `readJson` hace `JSON.parse` sin try/catch → un JSON corrupto tumba el proceso (DoS). — *(Fase 2: `readJson` ahora captura el error y reinicia con valores por defecto.)*
- [ ]  🟡 Sin headers de seguridad (helmet) ni dependencias de hardening; duración por defecto de tokens/licencias ~3650 días. — `license-server/server.js`, `license-server/package.json`

## A.3 🌐 Red y endpoints sin autenticación (→ Fase 3)

- [ ]  🔴 **`ensureUnlocked` sin rate limiting ni límite de intentos.** El Map de tokens de desbloqueo admin (`adminUnlock.js:9`) permite brute-force del header `x-admin-unlock` o la cookie `adminUnlock` sin restricción de velocidad. — `src/utils/adminUnlock.js:64-76`
- [ ]  🟠 **`network.json` en texto plano, editable por el usuario.** El archivo que controla `lanEnabled` está en `%APPDATA%/network.json` sin firma ni cifrado. Un atacante con acceso a los archivos puede activar LAN sin permiso. — `src/utils/network.js:11-34`

> Nota: `0.0.0.0`, CORS `origin:true` y firewall 53050–53060 ya están contemplados en la Fase 3. Aquí se listan endpoints concretos sin auth que faltan endurecer.

- [ ]  🔴 Cadena RCE: `POST /api/utils/download-update` descarga un `.exe` desde una URL arbitraria del body y `POST /api/utils/execute-update` lo ejecuta con `spawn` + `process.exit(0)`, sin firma ni validación de origen. — *(PARCIAL Fase 3: ambos son solo-localhost (bloqueados en LAN). FALTA verificación de firma/hash del binario antes de ejecutar. Pendiente.)*
- [x]  🔴 `POST /api/backup/cloud/restore` reemplaza `mi-tienda.db` con un `.db` remoto sin pedir contraseña admin (solo `token`+`filename`). — *(Fase 4/6: `ensureUnlocked` exige clave admin para restaurar; además la nube está desactivada por defecto.)*
- [ ]  🟠 `POST /api/print/remote` (printText/printHTML/getPrinters) sin token ni validación de origen. — `server.js` *(Pendiente; en LAN queda tras el gate de token temporal, pero sin auth adicional.)*
- [x]  🟠 `POST /api/settings/admin-password` permite fijar o **borrar** la contraseña admin sin auth previa. — *(Fix Fase 10: `updateAdminPassword` ahora exige `ensureUnlocked` para cambiar/borrar (cuando ya hay clave) y usa bcrypt; queda auditado.)*
- [~]  🟠 `POST /api/license/activate` cambia la licencia local sin auth. — *(Fase 4: cambiar la licencia estando YA licenciado exige clave admin; la activación de recuperación (bloqueado) se permite a propósito.)*
- [~]  🟠 `DELETE /api/reports/void/:saleId`, `/cash-withdrawal`, `/cash-opening`, `/cash-advance` sin verificación admin. — *(Fase 4: `void` ya exige clave admin y queda auditado. FALTA gatear cash-withdrawal/opening/advance.)*
- [ ]  🟠 `POST /api/backup/cloud/save-token` y `DELETE .../remove-token` sin auth. — `routes/backup.routes.js:90-143`
- [ ]  🟠 Carpeta `uploads` servida estáticamente en `/uploads/` sin control de acceso; `parseMultipartUpload` usa la extensión del `filename` del cliente sin validar MIME/tamaño/whitelist. — `server.js:172-205,229-236`
- [ ]  🟠 `preload.js` expone `invoke/send/receive` genéricos sin whitelist de canales; el renderer puede invocar cualquier handler IPC (p. ej. `app:restart`). — `preload.js:5-15`
- [~]  🟠 `bcvUpdater` usa `rejectUnauthorized: false` en `https.get` al scrapear BCV (MITM posible). — `src/services/bcvUpdater.js:21` *(Fase 1: se quitó del fallback parametrizado; el scraper directo de bcv.org.ve lo conserva por los problemas de certificado del sitio gubernamental. Pendiente evaluar.)*
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

- [x]  🟠 `PRAGMA foreign_keys = ON` no se activa pese a múltiples `FOREIGN KEY` declaradas → SQLite no los aplica. — `src/database.js` *(Fase 5: activado al final de `initializeDB()`.)*
- [x]  🟠 `initializeDB()` ejecuta `DELETE FROM abonos WHERE anulado = 1` en **cada arranque**, borrando histórico de abonos anulados. — `src/database.js:404-421` *(Fase 5: bloque eliminado.)*
- [ ]  🟡 Migraciones destructivas (`DROP TABLE productos`/`venta_pagos`) sin backup automático previo. — `src/database.js:555-590,728-805`
- [ ]  🟡 Timestamps con `datetime('now','localtime')` dependen del huso del SO, no de un UTC-4 fijo para Venezuela. — `src/database.js` (varios)

## A.6 ⚙️ Refactor y rendimiento — backend (→ Fase 7)

- [ ]  🟡 N+1: `generateReportDataHelper()` ejecuta `getDetailedSaleProductsStmt.all(sale.id)` dentro de un `for` por cada venta del rango. — `controllers/reports.controller.js:965-966`
- [ ]  🟡 N+1: `searchSales()` consulta productos por cada venta encontrada. — `controllers/reports.controller.js:2904-2906`
- [ ]  🟡 N+1: `getClientDebtsWithProducts()` consulta productos por cada venta abierta del cliente. — `controllers/client.controller.js:283`
- [ ]  🟡 `db.prepare(...)` dentro de funciones/loops en vez de una sola vez (recalc, `processSaleTransaction`, `importProducts`). — `controllers/sales.controller.js:206-207,398-438`, `controllers/product.controller.js:620`
- [ ]  🔵 `cancelSale` está exportado pero **sin ruta** y duplica la lógica de `voidSale`. — `controllers/sales.controller.js:1015-1068`
- [ ]  🔵 `printSettings.controller.js` no está ruteado; hay 3 implementaciones de config de impresión con campos distintos (`printHeader` vs `ticketHeader`, etc.). — `controllers/printSettings.controller.js`, `routes/printSettings.routes.js`, `routes/settings.routes.js`
- [x]  🔵 `routes/rapikom.routes.js` nunca se registra con `registerExpressRouter` → sus rutas están muertas. — *(Fase 7: rapikom y temp_advance eliminados por completo.)*
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
- [x]  🔵 `JsBarcode.all.min.js` se carga en `pos.html`/`cobranza.html` pero no se usa. — *(Fase 8: eliminado de `index.html`, `pos.html` y `cobranza.html`.)*
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
| 🛡️ Blindaje | 11, 12, 13 | Anti-manipulación del cliente, updates firmados y blindaje final del build |
| 🔴 Auditoría B | 14 | Cierra el bypass crítico de licencia por prototipo y endurece servidor/robustez (Anexo B) |

> 📎 Ver **Anexo A** (al final de las fases) para el catálogo de bugs/optimizaciones detectados en auditoría, ya repartidos por fase. Cada ítem está sin corregir y con su `archivo:línea` para completarlo.

---

# 🔎 ANEXO B — Auditoría ampliada (hallazgos nuevos)

<aside>
🔬

**Qué es esto.** Segunda pasada de auditoría profunda (julio 2026) sobre TODO el repositorio, dominio por dominio (A–I), buscando problemas **NUEVOS** que NO estén ya en las Fases 0–13 ni en el Anexo A. Cada hallazgo se verificó contra el código actual (`archivo:línea` reales; las líneas pueden variar tras editar). Severidad: 🔴 crítica · 🟠 alta · 🟡 media · 🔵 baja/limpieza. Cada ítem indica su **fase destino** (existente o nueva Fase 14/15). Marca `- [x]` solo cuando esté realmente corregido.

> DECISIÓN (ingeniería): la auditoría se ejecutó en una sola pasada secuencial (los sub-agentes en paralelo no estaban disponibles por un problema de facturación de la cuenta). Se priorizó verificar cada hallazgo leyendo el código real antes de registrarlo.

</aside>

## B.A 🔐 Licencias — servidor y cliente (→ Fase 2 / nueva Fase 14)

- [x]  🔴 **Bypass total por clave de prototipo (`__proto__`).** El servidor busca la licencia con `data.licenses[key]` sobre un objeto plano; con `key="__proto__"` (o `constructor`, `toString`, `valueOf`, `hasOwnProperty`) esa indexación devuelve `Object.prototype` (truthy) → `/activate` pasa todas las guardas (`estado`, `fechaExpiracion`, `hwid` son `undefined`) y **emite un token PRO firmado ligado al HWID del atacante, sin clave real ni autenticación**. Efectos: (1) activación gratis; (2) `/verify` la refresca indefinidamente; (3) **no se puede revocar** (no es una entrada real); (4) **prototype pollution** al hacer `license.hwid=...`/`license.estado=...` sobre `Object.prototype`. Mismo patrón en `/verify` y en `trials.trials[hwid]` de `/trial`. Verificado E2E contra el servidor real. — `license-server/server.js:216,256,282` (Fase 14) *(CORREGIDO en Fase 14.1.)*
- [x]  🟠 **Pérdida total de licencias por corrupción de `licenses.json`.** Si el archivo se corrompe, `readJson` retorna `{ licenses: {} }` en silencio y la **siguiente escritura** (`/activate`, `/verify`, crear/revocar) sobrescribe el archivo, **borrando todas las licencias**. Falta respaldo/rotación previa o abortar en corrupción. — `license-server/server.js:54-68` (Fase 14) *(CORREGIDO: respaldo `.corrupt-<ts>` + abort si no puede respaldar.)*
- [x]  🟡 **`/verify` no exige `estado==='activa'` ni `hwid` coincidente explícitos.** Solo excluye `revocada`/`otro_equipo`/`expirada`, así que reemite token para licencias `pendiente` (hoy acotado porque `hwid=null` hace que el cliente lo rechace, pero es frágil). — `license-server/server.js:251-273` (Fase 14) *(CORREGIDO en Fase 14.1.)*
- [x]  🟡 **`SECRET_KEY` (firma JWT admin) sin mínimo de robustez.** `requireEnv` solo comprueba que exista; a diferencia de `ADMIN_PASSWORD` (≥10). Un secreto débil permite forjar JWT admin y generar/revocar licencias offline. — `license-server/server.js:24` (Fase 14) *(CORREGIDO: exige ≥32.)*
- [x]  🔵 **`jwt.verify` sin `algorithms` fijado.** Falta `{ algorithms: ['HS256'] }` (defensa en profundidad contra confusión de algoritmo). — `license-server/server.js:178` (Fase 14) *(CORREGIDO.)*
- [ ]  🔵 **`getLicenseInfo` dispara heartbeat de red en cada GET `/api/license/info`** (`checkOnlineAndActivate().catch(()=>{})`), permitiendo verificaciones solapadas contra el servidor. — `controllers/license.controller.js:105` (Fase 14)

## B.B 🌐 Red / endpoints / IPC / Electron (→ Fase 3 / Fase 11 / nueva Fase 14)

- [x]  🟠 **CORS permite todos los rangos LAN privados aunque el modo LAN esté apagado.** `isAllowedOrigin` acepta `10.x`, `192.168.x`, `172.16–31.x` incondicionalmente; debería restringirse a loopback salvo que `isLanEnabled()`. — `server.js:259-272` (Fase 14) *(CORREGIDO.)*
- [x]  🟡 **Ventanas ocultas de impresión/PDF sin `sandbox`/`contextIsolation` explícitos.** `printHTML` y `printer:savePDF` cargan HTML arbitrario (posiblemente de impresión remota LAN) en un `BrowserWindow` con solo `nodeIntegration:false`; conviene fijar `contextIsolation:true, sandbox:true`. — `main.js:163,204` (Fase 14) *(CORREGIDO.)*
- [x]  🟡 **`@fastify/multipart` sin límites explícitos** (`limits.fileSize`, `files`, `fields`). Una subida grande puede llenar disco en `uploads/`. Complementa el hallazgo A.3 de validación de MIME/whitelist. — `server.js:320-321` (Fase 3/14) *(CORREGIDO: 20MB/1/50.)*

## B.C 🔐 Autenticación, roles y auditoría (→ Fase 4 / nueva Fase 14)

- [x]  🟠 **Los roles internos (cajero/supervisor/admin) NO se autentican ni se aplican server-side.** La tabla `usuarios` existe (Fase 4) pero no hay login de operador: el autor de auditoría sale de la cabecera `x-operator`, que el cliente puede falsificar, y **no hay control de acceso por rol** en el backend (la única barrera real es la contraseña de "desbloqueo admin"). — `src/utils/adminUnlock.js:51-56`, `src/utils/audit.js` (Fase 14) *(DECISIÓN documentada en Fase 14.2: `x-operator` es informativo; el gate real es `ensureUnlocked`. Login por operador = mejora futura.)*
- [x]  🟡 **`getAdminPasswordStatus` expone si hay clave admin configurada** sin autenticación (fuga menor de información útil para un atacante). — `controllers/settings.controller.js:195-207` (Fase 14) *(DECISIÓN: se mantiene; solo booleano, requerido por el frontend.)*

## B.D 💵 Dinero: ventas, cobranza, caja, Cashea (→ Fase 5 / bugfix)

- [ ]  🟡 **Vuelto (`registerChange`) en USD usa la tasa BCV ACTUAL, no la de la venta.** `amountInVes = amount * rates.BCV` con la tasa vigente; si la tasa cambió entre la venta y el registro del vuelto, el `venta_pagos` negativo queda con un monto en Bs inconsistente y descuadra el pendiente recalculado. — `controllers/sales.controller.js:1001-1003` (Fase 5/bugfix)
- [ ]  🟡 **Se pueden vender productos soft-deleted.** `processSaleTransaction`/`processSale` usan `getProductByIdStmt` que NO filtra `activo=1`; un producto "eliminado" (soft-delete) todavía se puede agregar y vender si se conoce su `id`. — `controllers/sales.controller.js:31-33,370,544` (Fase 5/bugfix)
- [ ]  🟡 **Cashea: cuotas no validan que sumen el total ni que las fechas sean válidas.** `createCasheaVenta` inserta las `cuotas` tal cual llegan del cliente sin verificar que `Σ monto_usd (+ inicial) == monto_total_usd` ni cantidad/orden de cuotas; permite planes de pago inconsistentes. Complementa A.4 (falta de validación en Cashea). — `controllers/cashea.controller.js:5-38` (Fase 5)
- [ ]  🟡 **`updateRates` sigue sin transacción** (6+ UPDATE/INSERT sueltos) — ya listado en A.4 como `settings.controller.js`; **verificado que persiste** tras los cambios de Fase 4/10. Se reafirma aquí para cerrarlo en Fase 5. — `controllers/settings.controller.js:43-79` (Fase 5)

## B.E 🗄️ Base de datos (→ Fase 5 / nueva Fase 14)

- [ ]  🟡 **`settings.value` declarada `REAL NOT NULL` pero almacena texto** (`IVA_MODE='INCLUDED'/'EXCLUDED'`). Funciona por la tipación dinámica de SQLite (afinidad, no restricción), pero es inconsistente y frágil ante validaciones futuras; conviene separar ajustes de texto o cambiar la columna a `TEXT`/`ANY`. — `src/database.js:74-79`, `controllers/settings.controller.js:59-61` (Fase 5)
- [ ]  🔵 **Sin `PRAGMA journal_mode=WAL` ni `synchronous` explícito.** El modo rollback por defecto es correcto para integridad, pero WAL mejora la concurrencia lectura/escritura en el POS; evaluar activarlo (con checkpoint en cierre). — `src/database.js:19-24` (Fase 5)

## B.F ⚙️ Backend — perf y correctitud (→ Fase 7)

- [ ]  🔵 **Doble lectura de producto por ítem en `processSale`.** Cada ítem se consulta con `getProductByIdStmt` dentro de la transacción y OTRA vez en el bucle de IVA. Se puede reutilizar el `productDetails` ya cargado. Complementa A.6 (prepared en loops). — `controllers/sales.controller.js:370,544` (Fase 7)

## B.G 🖥️ Frontend — XSS nuevos (→ Fase 8)

- [ ]  🟠 **XSS por `innerHTML` en Configuración.** `configuracion.js` arma con `innerHTML` (23 usos) listas de métodos de pago, tasas personalizadas y usuarios internos, insertando nombres provistos por el usuario sin escapar → XSS almacenado. NO estaba en A.7. — `public/js/configuracion.js` (Fase 8)
- [ ]  🟠 **XSS por `innerHTML` en el layout/topbar.** `layout.js` inyecta el `businessName` (configurable) y respuestas de red por `innerHTML` en la cabecera. NO estaba en A.7. — `public/js/layout.js:560-612` (Fase 8)
- [ ]  🟡 **XSS por `innerHTML` en Etiquetas.** `etiquetas.js` (8 usos) renderiza nombres de producto para las etiquetas sin escapar. NO estaba en A.7. — `public/js/etiquetas.js` (Fase 8)

## B.H 📦 Build y dependencias (→ Fase 10 / Fase 13)

- [ ]  🟠 **`xlsx@0.18.5` con vulnerabilidades conocidas** (Prototype Pollution — CVE-2023-30533 — y ReDoS). La versión de npm no tiene parche; se recomienda migrar a la build oficial (CDN de SheetJS) o mitigar el parseo de archivos no confiables. Se usa en `product.controller.js` y `reports.controller.js`. — `package.json:45` (Fase 10)
- [ ]  🔵 **Dos librerías CSV a la vez:** `fast-csv` y `csv-parser` ambas en `dependencies` y ambas importadas en `product.controller.js`. Unificar en una sola reduce superficie y peso. — `package.json:32,37`, `controllers/product.controller.js:4-5` (Fase 10)
- [ ]  🔵 **`@electron-forge/maker-squirrel` en devDependencies pero no se usa** (solo se empaqueta con `maker-wix`). Limpieza. — `package.json:49`, `forge.config.js:21-36` (Fase 10)
- [ ]  🔵 **`axios@^1.6.0` desactualizado** (versiones 1.6.x tuvieron avisos de seguridad de redirección/SSRF corregidos después). Evaluar subir dentro de 1.x. — `package.json:29` (Fase 10)

## B.I 🧩 Robustez general (→ nueva Fase 14)

- [x]  🟠 **No hay manejador de `unhandledRejection`.** `main.js` captura `uncaughtException` pero NO `unhandledRejection`; promesas rechazadas sin `catch` (heartbeats, impresión, updates) quedan silenciadas hoy y podrían terminar el proceso en futuras versiones de Node. — `main.js:93-105` (Fase 14) *(CORREGIDO: handler que loguea sin matar el proceso.)*

**Criterio de aceptación del Anexo B:** cada hallazgo se verifica contra el código actual, se corrige (o se documenta por qué se descarta) y se marca `- [x]`. Los 🔴/🟠 de licencias/servidor se cierran en la nueva **Fase 14**.

<!-- ANEXO-B-END -->
