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

- [ ]  Eliminar del repo: `license-server/private.key`, `licenses.json`, `users.json`, `invites.json`, `activation_tokens.json` y cualquier `.db`/`.lic`.
- [ ]  Añadirlos a `.gitignore` y purgarlos del historial de git (git filter-repo/BFG). Documentar el procedimiento.
- [ ]  Generar un **nuevo par de llaves RSA** (privada solo en el servidor, pública embebida en el cliente). La privada NUNCA se commitea.
- [ ]  Reemplazar TODOS los secretos hardcodeados por variables de entorno **sin fallback inseguro**:
    - `SECRET_KEY`, `SHARED_API_KEY`, `TRIAL_SECRET_KEY`, `HIST_SECRET`, `HASH_SECRET`, credenciales admin.
- [ ]  Crear `.env.example` (sin valores reales) documentando cada variable.
- [ ]  Hacer que el servidor **no arranque** si falta un secreto obligatorio (fail-fast).

### 1.2 Quitar servidores/dominios externos

- [ ]  Eliminar/parametrizar todas las URLs hardcodeadas: `bodegapp.com.ve`, `/admin-licencias/api/...`, `/respaldo`, fallback de tasas `bodegapp.com.ve/tasas/`.
- [ ]  Centralizar endpoints en configuración (`.env` / archivo de config) con default a **servidor local** (`http://localhost:PUERTO`).
- [ ]  Desconectar cualquier llamada saliente que no sea imprescindible.

### 1.3 Rotar credenciales admin

- [ ]  Quitar usuario/clave por defecto `admin=[REMOVED-COMPROMISED-CREDENTIAL]`. Forzar creación de admin en el primer arranque del servidor.

**Criterio de aceptación:** no queda ningún secreto ni URL externa en el código; el servidor exige variables de entorno; nuevas llaves generadas; historial de git limpio de secretos.

**Commit sugerido:** `fix(fase-1): rotación de secretos, remoción de servidores externos y fail-fast de config`

### 🚫 NO HACER en Fase 1

- No dejar ni un `|| 'valor-por-defecto'` en secretos.
- No conservar el `private.key` viejo en ningún lado del repo/historial.

---

# 🟥 FASE 2 — Nuevo sistema de licencias (anti-trampa)

**Meta:** que solo el dueño pueda generar licencias y que sea muy difícil saltarse la activación. Servidor **local** por ahora.

### 2.1 Servidor de licencias (local)

- [ ]  Endpoint de **generación de licencias** protegido por **login real de admin** (no por API key compartida). Eliminar `authenticateApiKey` basado en `SHARED_API_KEY`.
- [ ]  Modelo de licencia: `clave`, `plan`, `estado` (pendiente/activa/revocada), `hwid`, `fecha_activacion`, `fecha_expiracion`, `equipo`, `notas`.
- [ ]  Endpoint `activar`: valida clave + HWID, rechaza si ya está activada en otro equipo, devuelve **token firmado** con expiración corta.
- [ ]  Endpoint `verificar` (heartbeat): revalida estado (activa/revocada/expirada).
- [ ]  Endpoint `revocar` (solo admin): invalida una licencia individual.
- [ ]  Rate limiting + logging de intentos en endpoints de activación/verificación.
- [ ]  Migrar hash de contraseñas del panel a **bcrypt/argon2**.

### 2.2 Cliente (Electron)

- [ ]  Embeber solo la **clave pública**; validar la firma del token localmente.
- [ ]  Guardar la licencia como **caché cifrada** (no texto plano, no archivo fácilmente copiable entre equipos).
- [ ]  Vincular a **HWID** (`node-machine-id`); si el HWID no coincide con el del token → invalidar.
- [ ]  **Bloqueo total de la app** si no hay licencia válida (pantalla de activación, sin acceso a módulos).
- [ ]  Ventana de gracia offline corta y configurable; al vencer, exigir re-verificación online.
- [ ]  Endurecer trial de 72h: firmado por servidor y ligado a HWID (que no se reinicie borrando un archivo local).

### 2.3 Panel de administración (solo dueño)

- [ ]  Login admin seguro (bcrypt/argon2) — un solo rol admin.
- [ ]  Vista para crear, listar, activar, revocar y ver el equipo (HWID) de cada licencia.

**Criterio de aceptación:** generar licencia requiere login admin; activar exige servidor + HWID; app se bloquea sin licencia válida; revocación individual funciona; copiar el archivo de licencia a otro equipo **no** activa la app.

**Commit sugerido:** `feat(fase-2): sistema de licencias con activación online, HWID y revocación remota`

### 🚫 NO HACER en Fase 2

- No validar licencia solo en el cliente.
- No permitir generar licencias sin autenticación admin.
- No guardar el token de licencia en texto plano.

---

# 🟧 FASE 3 — Endurecimiento del servidor local y acceso móvil

**Meta:** permitir uso desde el celular en la LAN sin exponer la seguridad.

- [ ]  Backend Fastify escucha por defecto en `127.0.0.1`; el acceso LAN se **activa manualmente** desde Configuración.
- [ ]  Cuando se active LAN, exigir **token/QR temporal con expiración** para conectar el celular.
- [ ]  Que `configurar-firewall.bat` no abra puertos por defecto; abrir solo el puerto necesario y solo cuando el usuario active el modo LAN.
- [ ]  Añadir autenticación a los endpoints internos sensibles (no dejar rutas abiertas por estar en localhost).
- [ ]  Cabeceras de seguridad básicas y CORS restringido a orígenes conocidos.

**Criterio de aceptación:** por defecto no se accede desde fuera; el modo LAN pide token/QR temporal; el firewall no queda abierto sin acción del usuario.

**Commit sugerido:** `feat(fase-3): acceso LAN/móvil controlado con token temporal y bind seguro`

### 🚫 NO HACER en Fase 3

- No dejar `0.0.0.0` como default.
- No abrir rango de puertos 53050–53060 automáticamente.

---

# 🟧 FASE 4 — Roles, permisos y auditoría

**Meta:** usuarios internos con roles y registro de quién hizo qué.

- [ ]  Modelo de usuarios internos con roles: **cajero / supervisor / admin**.
- [ ]  Contraseña admin requerida para: **borrar producto, anular venta, restaurar backup, cambiar licencia, cambiar tasa** (NO para exportar datos).
- [ ]  Tabla de **auditoría**: usuario, acción, entidad, fecha/hora, detalle.
- [ ]  Registrar en auditoría todas las acciones sensibles anteriores.

**Criterio de aceptación:** cada acción sensible pide clave admin (según lista) y queda registrada con autor y fecha.

**Commit sugerido:** `feat(fase-4): roles internos, gate de contraseña admin y log de auditoría`

### 🚫 NO HACER en Fase 4

- No pedir clave admin para exportar datos.
- No registrar contraseñas ni secretos en la auditoría.

---

# 🟨 FASE 5 — Base de datos: integridad y migraciones

**Meta:** migraciones versionadas, borrado seguro y tasas congeladas por venta.

- [ ]  Crear tabla `_migrations` versionada + runner de migraciones idempotente.
- [ ]  **Backup automático de la DB antes de migrar**.
- [ ]  Unificar a **soft-delete** en todo; eliminar el `DELETE FROM productos` de `sales.controller.js` (conflicto con el soft-delete de `product.controller.js`).
- [ ]  Congelar la **tasa aplicada al momento de la venta** (guardar tasa en la venta) para que cambios futuros de tasa **no afecten ventas pasadas**.
- [ ]  Revisar y crear las migraciones faltantes de **Cashea** (`cashea_ventas`, `cashea_cuotas`) para que el módulo no rompa.
- [ ]  Quitar `verbose: console.log` de better-sqlite3 en producción.
- [ ]  Añadir índices SQL en columnas de búsqueda frecuente (productos, ventas, clientes).

**Criterio de aceptación:** migraciones versionadas con backup previo; no hay borrado físico de ventas/abonos; tasas históricas intactas; Cashea con sus tablas; sin logging de SQL en prod.

**Commit sugerido:** `refactor(fase-5): migraciones versionadas, soft-delete unificado y congelamiento de tasas`

### 🚫 NO HACER en Fase 5

- No ejecutar migraciones destructivas sin backup previo.
- No recalcular ventas antiguas con tasas nuevas.

---

# 🟨 FASE 6 — Backups seguros

**Meta:** respaldos locales confiables, sin dependencia de servidor externo por ahora.

- [ ]  Backup **local automático** programable (y manual desde la app).
- [ ]  Cifrar los backups; **restaurar exige contraseña admin**.
- [ ]  Quitar la dependencia del backup en la nube externo (`bodegapp.com.ve/respaldo`) hasta tener el VPS; dejarlo como opción configurable y desactivada por defecto.
- [ ]  Cifrar cualquier token/credencial de nube que hoy se guarde en texto plano.

**Criterio de aceptación:** backups locales cifrados; restauración pide clave admin; sin dependencia forzada de servidor externo.

**Commit sugerido:** `feat(fase-6): backups locales cifrados y restauración protegida`

---

# 🟦 FASE 7 — Refactor de backend y limpieza de redundancias

**Meta:** eliminar duplicación y bajar el tamaño de los archivos gigantes, sin romper.

- [ ]  Extraer los `statements` SQL duplicados (productos/categorías repetidos en varios controladores) a una capa de repositorio única.
- [ ]  Dividir `reports.controller.js` (~94KB) y `sales.controller.js` (~38KB) en servicios más pequeños y testeables.
- [ ]  Revisar `temp_advance_controller.js` y `rapikom.controller.js`: decidir si se integran o se eliminan por experimentales.
- [ ]  Añadir paginación real en backend para listados grandes (inventario, ventas, reportes).
- [ ]  Quitar el hack de "Express-mock loader" en `server.js` si no es necesario.

**Criterio de aceptación:** sin lógica SQL duplicada entre controladores; archivos grandes divididos; listados paginados; build y app siguen funcionando.

**Commit sugerido:** `refactor(fase-7): capa de repositorio, división de controladores y paginación`

### 🚫 NO HACER en Fase 7

- No cambiar contratos de API sin actualizar el frontend correspondiente.

---

# 🟦 FASE 8 — Optimización de frontend y corrección de bugs

**Meta:** rendimiento y bugs, manteniendo el diseño actual (que al dueño le gusta).

- [ ]  Reducir assets pesados (ej. `default-logo.png` ~941KB → optimizar/redimensionar).
- [ ]  Eliminar librerías/JS no usados; cargar bajo demanda los módulos pesados (`inventario.js` ~109KB, `cobranza.js` ~73KB, `etiquetas.js` ~55KB).
- [ ]  Revisar y corregir bugs detectados durante el refactor (sin rediseñar la UI).
- [ ]  Mejorar la UX del módulo **Cashea** (según decisión de mejorarla).
- [ ]  Medir tiempo de arranque y de vistas pesadas antes/después.

**Criterio de aceptación:** carga más rápida, sin assets innecesarios, bugs corregidos, diseño intacto.

**Commit sugerido:** `perf(fase-8): optimización de assets, carga bajo demanda y fixes de UI`

---

# 🟩 FASE 9 — Pruebas automatizadas

**Meta:** proteger la lógica crítica contra regresiones.

- [ ]  Configurar framework de tests (Vitest o `node:test`).
- [ ]  Tests de **licencias**: activación, HWID, revocación, expiración, bloqueo sin licencia.
- [ ]  Tests de **precios/tasas**: que ventas pasadas no cambian con nueva tasa.
- [ ]  Tests de **stock y ventas**: descuentos de inventario, anulaciones (soft-delete).
- [ ]  Tests de **migraciones**: runner idempotente y backup previo.

**Criterio de aceptación:** suite de tests verde; las áreas críticas tienen cobertura.

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