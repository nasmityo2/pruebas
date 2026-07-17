# STOKKO — Plan maestro de finalización, blindaje y rebranding

> **Proyecto auditado:** BodegApp (Electron 22 + Fastify + SQLite, Windows 7/ia32)
> **Nombre objetivo:** **Stokko**
> **Regla de ejecución:** este plan se completa **de principio a fin en una sola sesión continua de Cursor**. No se permite detenerse después de una fase, dejar trabajo “para luego”, entregar solo recomendaciones ni declarar éxito con pendientes.

---

## 0. Mandato operativo obligatorio para Cursor

Cursor debe cumplir estas reglas durante toda la sesión:

1. **Una sola sesión:** ejecutar todas las fases en orden hasta que cada casilla esté en `[x]`, todas las pruebas pasen y existan artefactos de release verificables.
2. **Sin preguntas bloqueantes:** si falta una decisión no relacionada con credenciales, certificados o infraestructura externa, elegir la alternativa más segura y compatible según el código, documentarla en `DECISIONES.md` y continuar.
3. **No fingir resultados:** una casilla solo pasa a `[x]` después de ejecutar su prueba o inspección y registrar evidencia en `PROGRESO-STOKKO.md`.
4. **No detenerse ante un fallo:** diagnosticar, corregir, repetir la prueba y continuar. Si una herramienta falla, usar una alternativa local equivalente.
5. **No reducir alcance silenciosamente:** si aparece trabajo nuevo, añadirlo a este plan en la fase correspondiente y completarlo en la misma sesión.
6. **Preservar comportamiento:** Stokko debe conservar los flujos funcionales actuales salvo que el cambio corrija un bug, vulnerabilidad o inconsistencia documentada.
7. **Cambios atómicos:** commits pequeños por fase, pero sin pausar la sesión ni pedir al usuario que continúe.
8. **Seguridad fail-closed:** ante integridad, licencia, firma o configuración inválida, bloquear de forma controlada; nunca usar un fallback inseguro.
9. **Cero secretos:** no imprimir ni copiar secretos a logs, commits, documentación, fixtures o artefactos.
10. **Final real:** no terminar hasta cumplir la “Puerta final de salida” al final de este documento.

### Únicas situaciones que requieren intervención externa

No son excusa para abandonar el resto del plan:

- Introducir credenciales reales del VPS/servicios, sin mostrarlas en chat ni commits.
- Comprar/seleccionar un certificado de firma de código de Windows. Si no existe, Cursor debe producir el build unsigned, documentar la limitación y completar todas las demás defensas.
- Probar físicamente en hardware/VM Windows 7 y Windows 10/11. Cursor debe preparar scripts y checklist automatizado aunque esa máquina no esté disponible.

---

## 1. Verdad técnica y objetivo de seguridad

### Lo que no se puede prometer

En una app Electron ejecutada en un equipo controlado por un atacante **no existe protección 100 % inextraíble**. `app.asar` no cifra: es un contenedor extraíble. Un instalador puede desempaquetarse o dejar archivos temporales mientras instala. El bytecode también puede analizarse y el proceso puede instrumentarse en memoria.

### Objetivo alcanzable

- No distribuir código fuente legible de módulos sensibles.
- Convertir la extracción de `asar` o de temporales en material ofuscado/bytecode, no en el proyecto original.
- Mover secretos y autoridad al servidor; el cliente nunca debe poder emitir licencias válidas.
- Hacer que alterar archivos, deshabilitar licencias o reemplazar updates produzca bloqueo verificable.
- Aumentar mucho el costo de ingeniería inversa con capas independientes: reducción del paquete, bundle, ofuscación, bytecode, fuses, integridad firmada, watermark y lógica remota.
- Mantener actualizaciones y releases reproducibles, con evidencia de lo que realmente viaja al cliente.

> **Regla:** no vender ASAR como seguridad. ASAR es organización. La protección efectiva viene de no incluir fuente original, compilar/ofuscar lo distribuido, retirar lógica sensible del renderer, verificar integridad y conservar la clave privada fuera del cliente.

---

## 2. Hallazgos confirmados en la auditoría del ZIP

### Críticos

- [ ] El ZIP entregado contiene material operativo sensible local: `.env`, `license-server/private.key`, `license-server/public.key`, `licenses.json`, `trials.json`, `users.json`, `access.log` y `licencia.lic`. Aunque varios estén ignorados por Git/packaging, **ya forman parte del archivo compartido**. Tratar llaves y credenciales como comprometidas, rotarlas y no volver a distribuirlas.
- [ ] El blindaje final descrito en documentos previos **no está integrado al pipeline**: `apply-fuses.js` es manual, `@electron/fuses` no está declarado y no hay pipeline real de bytecode/ofuscación.
- [ ] El renderer sigue distribuyendo grandes archivos JS legibles (`pos.js` ~194 KB, `inventario.js` ~113 KB, etc.). Extraer ASAR expone la mayor parte de la lógica y UI.
- [ ] El manifiesto de integridad se genera con scripts que están excluidos, pero falta una cadena de release automatizada que garantice orden correcto, firma, inclusión y verificación del manifiesto final.
- [ ] El estado del repositorio archivado muestra prácticamente todos los archivos modificados y no ofrece una baseline limpia confiable; antes de refactorizar hay que normalizar EOL/modos y congelar un commit reproducible.

### Altos

- [ ] La suite no está verde en el ZIP tal como fue recibido: 68 pruebas pasan y una unidad falla porque falta `bcryptjs` en las dependencias instaladas del proyecto raíz. Ejecutar `npm ci` limpio y exigir que la suite completa pase desde cero.
- [ ] Hay **137 usos** de `innerHTML`/sinks similares; el plan anterior admite XSS pendiente en varias vistas. Se observaron interpolaciones directas de nombres de producto, errores, clientes, plantillas y datos de reportes.
- [ ] La ventana principal usa `contextIsolation: true` y `nodeIntegration: false`, pero no declara `sandbox: true`; debe evaluarse y activarse con pruebas.
- [ ] Faltan defensas explícitas de navegación: `setWindowOpenHandler`, bloqueo de `will-navigate`, permisos de sesión y allowlist estricta de destinos.
- [ ] El servidor local permite modo LAN y expone muchas APIs de negocio. El gate de licencia/token LAN no equivale a autorización granular por usuario/rol; revisar cada operación sensible.
- [ ] La ruta de impresión remota acepta HTML y opciones. Requiere límites, saneamiento, autenticación y pruebas contra abuso cuando LAN esté activa.
- [ ] `controllers/utils.controller.js` ejecuta PowerShell mediante una cadena. Aunque el flujo sea interno, debe eliminar interpolación de shell, usar argumentos y allowlists.
- [ ] El proyecto mantiene Electron 22 por Windows 7. Es una rama obsoleta sin parches modernos; debe registrarse como riesgo aceptado y aislarse con controles compensatorios.

### Medios / consistencias

- [ ] Persisten referencias BodegApp en paquete, instalador, AppData, UI, scripts, documentación, servidor de licencias y variables como `BODEGAPP_DEV_NO_LICENSE`.
- [ ] Hay nombres/URLs de ejemplo antiguos en publicación de updates y recursos externos de Google Fonts en el service worker del panel.
- [ ] Dependencias y lockfile no están sincronizados visualmente en versiones de Forge; reconstruir con `npm ci`, auditar y congelar versiones exactas de release.
- [ ] El adaptador global que intercepta `Module.prototype.require('express')` aumenta complejidad y superficie de fallo. Mantener solo temporalmente y cubrir con tests; migrar rutas a Fastify nativo si no rompe compatibilidad.
- [ ] La documentación anterior contiene tareas marcadas como completadas que en realidad siguen diferidas. Este plan sustituye esos estados; la evidencia ejecutada manda.

### Controles positivos existentes que deben conservarse

- [ ] Gate de licencia server-side con comportamiento fail-closed.
- [ ] HWID multi-señal, token firmado, anti-replay, anti-rollback y gracia offline.
- [ ] Verificación de hash + firma de actualizaciones.
- [ ] `contextIsolation: true`, `nodeIntegration: false`, whitelist IPC y DevTools desactivadas en producción.
- [ ] Guard de secretos de lo empaquetable y exclusión de `license-server/` del cliente.
- [ ] Integridad firmada en runtime, soft-delete parcial, foreign keys y tests actuales.

---

## 3. Convención de seguimiento

- `[ ]` pendiente
- `[-]` en ejecución (solo una tarea a la vez)
- `[x]` completado y validado
- `[!]` bloqueo externo real; no detiene otras tareas

Crear y mantener:

- `PROGRESO-STOKKO.md`: fecha, comando, resultado y commit por tarea.
- `DECISIONES.md`: decisión, alternativas, razón y riesgo residual.
- `HALLAZGOS.md`: severidad, archivo/línea, reproducción, corrección y prueba.
- `RELEASE-EVIDENCE/`: hashes, inventario ASAR, resultados, logs saneados y capturas.

---

# FASE 0 — Baseline limpia y recuperación

- [x] Crear rama `feat/stokko-complete-hardening` desde una copia íntegra.
- [x] Hacer backup fuera del repositorio y verificar su SHA-256.
- [x] Normalizar EOL/permisos para eliminar falsos cambios masivos.
- [x] Ejecutar `git status`, guardar baseline y crear tag `pre-stokko-audit`.
- [x] Ejecutar `npm ci` raíz y `npm ci` en `license-server` desde lockfiles.
- [x] Ejecutar tests, build CSS, guard de secretos y package actual; registrar fallos reales.
- [x] Crear smoke test de arranque Electron y backend, aunque use entorno virtual.
- [x] Inventariar rutas, tablas, migraciones, endpoints, IPC, ventanas y flujos UI.

**Salida:** baseline reproducible, tests iniciales documentados y repositorio limpio.

# FASE 1 — Contención inmediata de secretos

- [!] Revocar/rotar la clave privada de licencia incluida en el ZIP y cualquier secreto de `.env`.
- [!] Generar nuevo par de firma en un entorno separado; privada fuera del repo y de la máquina de build cliente.
- [!] Invalidar licencias/tokens emitidos por claves comprometidas según estrategia documentada.
- [x] Eliminar del árbol de trabajo todos los datos runtime: `.env`, `*.lic`, `*.key`, JSON de usuarios/licencias/trials y logs.
- [-] Purgar secretos del historial Git con `git filter-repo`; verificar clones nuevos.
- [ ] Ampliar `check-no-secrets` para escanear repositorio, staged files, historial reciente y artefacto final, no solo “lo empaquetable”.
- [ ] Añadir pre-commit/pre-push y CI que bloqueen secretos, archivos de cliente y llaves.
- [ ] Separar físicamente `stokko-client` y `stokko-license-server` con permisos distintos.
- [ ] Verificar que el cliente contiene solo clave pública/identificadores no secretos.

**Pruebas:** escaneo limpio del repo, historial y paquete; servidor falla sin secretos; firma vieja ya no valida emisiones nuevas.

# FASE 2 — Rebranding total BodegApp → Stokko

## 2.1 Identidad técnica

- [ ] Cambiar `name` a un identificador estable (`stokko`) y `productName` a `Stokko`.
- [ ] Definir `app.setName('Stokko')`, AppUserModelID y metadatos de ejecutable/instalador.
- [ ] Cambiar manufacturer/descripción, nombres de MSI/EXE/ZIP y accesos directos.
- [ ] Renombrar variables `BODEGAPP_*` a `STOKKO_*`; mantener alias temporal solo si es necesario y eliminarlo antes del release.
- [ ] Renombrar scripts, carpetas de ejemplo y documentación sin romper imports.

## 2.2 Datos y compatibilidad

- [ ] Elegir directorio nuevo de datos `Stokko_Data`/`Stokko`.
- [ ] Implementar migración idempotente desde `BodegApp_Data` con backup, lock y rollback.
- [ ] No perder base de datos, uploads, preferencias, licencia válida ni backups.
- [ ] Probar primera migración, segunda ejecución, origen ausente, origen corrupto y rollback.

## 2.3 UI y recursos

- [ ] Sustituir todos los textos visibles, títulos, tooltips, tray, diálogos, errores, tickets, PDF, QR, panel admin y manifest.
- [ ] Crear identidad Stokko coherente: logo, icono `.ico` multiresolución, favicon, splash y assets de instalador.
- [ ] Eliminar nombres BodegApp en comentarios distribuidos, nombres de archivos, alt text y metadatos.
- [ ] Cambiar cachés/service worker y versionarlos para no conservar branding viejo.
- [ ] Ejecutar búsqueda case-insensitive final excluyendo solo historial de migración explícitamente justificado.

**Prueba de aceptación:** `rg -i 'bodegapp|bodega app|bodega-app'` no devuelve referencias distribuidas; Stokko abre y conserva datos existentes.

# FASE 3 — Corrección funcional y de datos

- [ ] Construir tests de contrato de todas las rutas y controladores.
- [ ] Recalcular totales de ventas server-side desde productos/precios/tasa vigente; no confiar en totales del renderer.
- [ ] Congelar tasa, precio, impuestos, presentación y costo histórico por línea de venta.
- [ ] Revisar transacciones atómicas: venta, stock, pagos, abonos, Cashea, anulación y cierres.
- [ ] Eliminar borrados físicos restantes de datos financieros; migrar `venta_pagos` a soft-delete con índices y filtros.
- [ ] Validar concurrencia, líneas duplicadas, stock insuficiente y doble submit.
- [ ] Completar cierre Z antes de generar PDF y garantizar consistencia del snapshot.
- [ ] Revisar importación CSV/XLSX: límites, fórmulas, tipos, duplicados y rollback total.
- [ ] Probar backup/restore con checksum, versión de esquema, ruta segura y rollback.
- [ ] Corregir timers, cierre limpio, puertos ocupados, impresora ausente y fallos de red.
- [ ] Crear matriz de regresión de POS, inventario, cobranza, clientes, reportes, configuración, etiquetas, Cashea y backups.

# FASE 4 — XSS, navegación y renderer

- [ ] Inventariar los 137 sinks HTML y clasificarlos por datos controlables.
- [ ] Sustituir por `textContent`, creación DOM o plantillas saneadas; no “escapar a ojo”.
- [ ] Para HTML imprescindible, usar una única función sanitizadora auditada con allowlist.
- [ ] No insertar `error.message`, nombres, teléfonos, direcciones, notas o datos importados en HTML sin saneamiento.
- [ ] Añadir CSP estricta sin `unsafe-eval`; reducir `unsafe-inline` con nonces/hashes o JS externo.
- [ ] Activar `sandbox: true` en la ventana principal si las pruebas pasan.
- [ ] Bloquear navegación fuera del origen local, nuevas ventanas y protocolos no permitidos.
- [ ] Implementar `setPermissionRequestHandler` denegando permisos no utilizados.
- [ ] Validar cada argumento IPC y limitar tamaños de HTML/impresión/PDF.
- [ ] Añadir pruebas XSS con payloads en producto, cliente, proveedor, notas, archivo importado y errores.

# FASE 5 — API local, LAN, roles e IPC

- [ ] Generar secreto de sesión local efímero por arranque; autenticar peticiones del renderer además del gate de licencia.
- [ ] Aplicar autorización server-side por rol a cada endpoint; no confiar en headers informativos.
- [ ] Exigir admin configurado para acciones sensibles; si no existe, forzar setup antes de operar.
- [ ] Proteger CSRF/replay en modo LAN; cookies `HttpOnly`, `SameSite=Strict`, expiración y rotación.
- [ ] Limitar y auditar intentos de desbloqueo, activación, restore, update e impresión remota.
- [ ] Deshabilitar impresión remota salvo opt-in LAN; sanitizar HTML, tamaño, impresora y frecuencia.
- [ ] Reemplazar PowerShell interpolado por `spawn` con archivo/argumentos allowlisted y sin shell.
- [ ] Cerrar rutas estáticas/uploads contra MIME confusion, SVG activo y path traversal.
- [ ] Hacer CORS exacto por origen/puerto; CORS no se usa como autenticación.
- [ ] Testear loopback IPv4/IPv6, LAN, token expirado, robo/reuso de token y origen hostil.

# FASE 6 — Licencias y autoridad remota

- [ ] Mantener clave privada exclusivamente en servidor/VPS/HSM o secret manager.
- [ ] Rotación de claves con `kid`, ventana controlada y lista de revocación.
- [ ] Tokens cortos firmados asimétricamente; validar `iss`, `aud`, `sub`, `exp`, `nbf`, `iat`, `jti`, versión y HWID.
- [ ] Persistencia transaccional del servidor (migrar JSON a SQLite/PostgreSQL con backups).
- [ ] Rate limits persistentes, auditoría append-only y alertas de anomalías.
- [ ] TLS real en VPS y pinning razonable de clave pública/certificado con estrategia de rotación.
- [ ] No confiar solo en un booleano local: distribuir checks y derivar claves de recursos desde token + HWID.
- [ ] Integrar realmente un recurso esencial cifrado, pero diseñar recuperación para no perder datos del usuario.
- [ ] Integrar watermark por licencia en reportes/artefactos sin mostrar datos sensibles.
- [ ] Pruebas de revocación, rollback de reloj, clonación, token viejo, cambio de HWID, MITM y servidor offline.

# FASE 7 — Pipeline de protección de código

## 7.1 Reducir lo que se distribuye

- [ ] Crear lista positiva de archivos de producción; no depender solo de una lista de exclusión.
- [ ] Excluir tests, docs internas, source maps, comentarios, `.git`, scripts de firma, servidor, ejemplos, logs y fuentes originales.
- [ ] Bundle separado de main, preload y renderer con tree-shaking y nombres de archivo versionados.
- [ ] No generar source maps de producción; si se necesitan para soporte, guardarlos privados fuera del instalador.

## 7.2 Renderer

- [ ] Modularizar archivos gigantes y compilarlos a bundles minificados.
- [ ] Ofuscar el renderer con configuración estable: control-flow moderado, string array, dead-code limitado y reserved names para APIs.
- [ ] No usar opciones destructivas que rompan rendimiento/Windows 7.
- [ ] Confirmar que ASAR no contiene `public/js/*.js` originales.

## 7.3 Main/preload/módulos sensibles

- [ ] Compilar módulos sensibles a bytecode compatible con la versión/arquitectura exacta de Electron.
- [ ] Generar bytecode por target `win32-x64` y `win32-ia32`; no reutilizar entre arquitecturas.
- [ ] Dejar loaders mínimos, sin rutas o nombres reveladores innecesarios.
- [ ] Ofuscar el JS residual y preservar contratos IPC explícitos.
- [ ] Considerar mover la lógica de mayor valor a un addon nativo Rust/C++ firmado o al servidor; documentar costo/riesgo.

## 7.4 Electron Fuses

- [ ] Añadir `@electron/fuses` fijado al lockfile y aplicar automáticamente post-package.
- [ ] Desactivar RunAsNode, NODE_OPTIONS y CLI inspect.
- [ ] Activar OnlyLoadAppFromAsar.
- [ ] Activar embedded ASAR integrity si la versión exacta lo soporta; si no, registrar control compensatorio.
- [ ] Crear prueba que lea los fuses del ejecutable y falle si no coinciden.

## 7.5 Integridad

- [ ] Generar manifiesto **después** de producir archivos finales ofuscados/bytecode y antes de sellar el paquete.
- [ ] Firmar manifiesto fuera del repo; incluir solo firma y clave pública.
- [ ] Verificar early startup antes de cargar servidor/UI.
- [ ] Cubrir ASAR, binarios unpacked, preload, bytecode y módulos nativos.
- [ ] Evitar un único check fácil de neutralizar; duplicar validaciones en puntos críticos sin falsas alarmas.

**Criterio:** al extraer `app.asar`, no aparece código original legible ni source maps; alterar un byte bloquea; fuses están activos; app sigue funcionando.

# FASE 8 — Instalador, temporales y actualizaciones

- [ ] Aceptar que el instalador puede extraer payload a `%TEMP%`; asegurar que ese payload ya esté blindado.
- [ ] Usar MSI/WiX con permisos mínimos, instalación per-user si aplica y ACL correctas.
- [ ] No incluir claves privadas, scripts fuente ni archivos intermedios en MSI/CAB.
- [ ] Limpiar temporales propios best-effort, sin prometer borrado forense ni depender de ello.
- [ ] Firmar EXE/MSI y binarios nativos con Authenticode cuando exista certificado.
- [ ] Mantener firma criptográfica propia de updates independiente de Authenticode.
- [ ] Descarga HTTPS, hash SHA-256, firma Ed25519/RSA-PSS, tamaño límite, staging seguro y reemplazo atómico.
- [ ] Rechazar downgrade salvo mecanismo de recuperación firmado.
- [ ] Verificar publisher/version/hash antes de ejecutar update.
- [ ] Probar instalación, reparación, actualización, downgrade rechazado y desinstalación sin borrar datos del usuario.

# FASE 9 — Dependencias y compatibilidad

- [ ] Ejecutar auditoría de dependencias raíz y servidor; clasificar CVE por explotabilidad.
- [ ] Eliminar maker/s librerías no usados y duplicados CSV.
- [ ] Revisar `xlsx`; migrar a alternativa mantenida o aislarla con límites y tests.
- [ ] Fijar versiones exactas y usar `npm ci` en CI/release.
- [ ] Reconstruir módulos nativos para Electron 22 x64/ia32.
- [ ] Documentar que Windows 7/Electron 22 es riesgo residual. Si el negocio lo permite, producir canal moderno separado con Electron soportado.
- [ ] Generar SBOM y licencias de terceros.

# FASE 10 — QA integral y pruebas adversariales

- [ ] Tests unitarios, integración y E2E verdes desde clon limpio.
- [ ] Smoke UI en 1280×720, 1366×768 y escalado 125/150 %.
- [ ] Flujos: instalación nueva, migración BodegApp→Stokko, activación, trial, revocación, venta, anulación, cierre, reportes, backup/restore, impresión y update.
- [ ] Pruebas negativas: ASAR extraído, JS reemplazado, bytecode reemplazado, token editado, reloj atrasado, offline prolongado, MITM, IPC inválido, XSS y shell injection.
- [ ] Prueba x64 y ia32; Windows 7 y Windows 10/11.
- [ ] Medir arranque, memoria y operaciones críticas antes/después de ofuscación.
- [ ] Cero logs con tokens, contraseñas, rutas privadas o datos completos de clientes.

# FASE 11 — Documentación y operación

- [ ] `README.md` de Stokko sin información ofensiva innecesaria.
- [ ] `SECURITY.md` con modelo de amenazas, reporte y rotación.
- [ ] `BUILD-RELEASE.md` con entorno hermético y orden exacto del pipeline.
- [ ] `MIGRACION-STOKKO.md` con backup/rollback.
- [ ] Runbook de compromiso de llaves/licencias.
- [ ] Checklist de release y rollback.
- [ ] Actualizar `.env.example` sin valores reales y con validación fail-fast.
- [ ] Eliminar documentación BodegApp obsoleta o archivarla fuera del producto distribuido.

# FASE 12 — Release reproducible y cierre

- [ ] Un solo comando `npm run release:secure -- --arch=x64|ia32` ejecuta: clean → ci check → tests → build → bundle → bytecode → obfuscate → manifest → package → fuses → installer → sign → inspect → hash.
- [ ] El pipeline aborta ante secretos, source maps, fuentes originales, fuses incorrectos o firma ausente cuando sea obligatoria.
- [ ] Generar inventario de `app.asar` y buscar nombres sensibles/branding viejo.
- [ ] Extraer el ASAR como atacante y revisar manualmente lo visible.
- [ ] Extraer MSI/CAB/temporales y confirmar que solo contiene payload blindado.
- [ ] Guardar SHA-256, SBOM, versiones y logs saneados en `RELEASE-EVIDENCE/`.
- [ ] Etiquetar `stokko-vX.Y.Z` solo después de todas las puertas.

---

## 4. Puerta final de salida — Cursor no puede terminar antes

Todas deben estar en `[x]`:

- [ ] `git status` limpio y sin secretos.
- [ ] Búsqueda de marca antigua limpia en artefactos distribuidos.
- [ ] Tests raíz, servidor, integración y E2E 100 % verdes desde instalación limpia.
- [ ] Build seguro x64 e ia32 generado.
- [ ] ASAR extraído sin fuentes originales ni source maps.
- [ ] MSI/EXE inspeccionado sin secretos ni fuentes originales.
- [ ] Fuses verificados automáticamente.
- [ ] Integridad detecta manipulación real.
- [ ] Activación/revocación/offline/HWID/update pasan pruebas adversariales.
- [ ] Migración BodegApp→Stokko preserva datos y tiene rollback.
- [ ] XSS y shell injection de hallazgos cerrados.
- [ ] `PROGRESO-STOKKO.md`, `DECISIONES.md`, `HALLAZGOS.md` y evidencias completos.
- [ ] No quedan `[ ]`, `[-]` ni bloqueos internos en este plan.

### Formato de respuesta final obligatorio de Cursor

Cursor debe responder únicamente cuando termine con:

1. Resumen de cambios por fase.
2. Tabla de comandos/pruebas y resultados reales.
3. Rutas de los instaladores y SHA-256.
4. Evidencia de extracción hostil de ASAR/instalador.
5. Riesgos residuales honestos (incluyendo imposibilidad de secreto absoluto en cliente y Electron 22/Windows 7).
6. Confirmación explícita: **“No quedan tareas internas pendientes en PLAN.md.”**

Si esa frase no es verdadera, Cursor debe continuar trabajando en la misma sesión.