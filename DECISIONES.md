# Decisiones de ingeniería de Stokko

## D-001 — Baseline y material recibido

- Fecha: 2026-07-17
- Decisión: conservar el estado inicial mediante tag Git y backup externo verificado; no versionar ni distribuir los ZIP recibidos.
- Alternativas: commitear todo el árbol recibido; eliminar inmediatamente el material sin copia.
- Razón: el tag permite volver al código conocido y el backup conserva cambios/datos no versionados sin introducir secretos ni binarios de entrega en Git.
- Riesgo residual: el backup externo contiene material potencialmente comprometido y requiere control de acceso y eliminación segura cuando venza su retención.

## D-002 — Política de finales de línea

- Fecha: 2026-07-17
- Decisión: LF para texto, CRLF únicamente para scripts nativos de Windows y clasificación binaria explícita para artefactos.
- Alternativas: depender de `core.autocrlf`; convertir todo a CRLF.
- Razón: produce diffs reproducibles entre plataformas sin romper `.bat`, `.cmd` ni `.ps1`.
- Riesgo residual: herramientas externas que ignoren `.gitattributes` pueden mostrar finales distintos, pero Git mantiene el contenido canónico.

## D-003 — Compatibilidad Windows heredada

- Fecha: 2026-07-17
- Decisión: mantener Electron 22.3.27 mientras Windows 7/ia32 sea requisito explícito y añadir controles compensatorios, además de documentar su obsolescencia.
- Alternativas: actualizar Electron y abandonar Windows 7; mantener Electron 22 sin endurecimiento adicional.
- Razón: preserva el requisito de compatibilidad sin presentar una rama EOL como segura por sí sola.
- Riesgo residual: Electron 22 y Chromium asociado no reciben todos los parches modernos; ningún control local elimina por completo ese riesgo.

## D-004 — Retirar el addon de impresión no reproducible

- Fecha: 2026-07-17
- Decisión: retirar `@thesusheer/electron-printer` y usar `webContents.getPrintersAsync()`/`webContents.print()` de Electron para inventario e impresión.
- Alternativas: instalar ClangCL globalmente; conservar un addon nativo no mantenido; invocar PowerShell para imprimir.
- Razón: `npm ci` fallaba de forma reproducible por el toolset ClangCL, el addon añadía superficie nativa para x64/ia32 y el repositorio no consumía impresión RAW binaria. Electron ya ofrece la capacidad necesaria sin shell.
- Riesgo residual: la impresión RAW binaria queda rechazada explícitamente; impresoras que dependan exclusivamente de comandos ESC/POS sin driver requieren un adaptador nativo separado y firmado, no código shell.

## D-005 — Reescritura obligatoria del historial

- Fecha: 2026-07-17
- Decisión: usar `git-filter-repo` sobre todas las referencias, retirar rutas runtime/credenciales y reemplazar marcadores comprometidos; verificar desde clon nuevo.
- Alternativas: borrar solo del working tree; confiar en `.gitignore`; dejar la historia y rotar únicamente.
- Razón: un secreto borrado del último commit sigue recuperable desde objetos Git. El backup externo y el tag permiten recuperación controlada.
- Riesgo residual: clones/remotos anteriores conservan la historia vieja hasta ser eliminados o reescritos; publicar el nuevo historial requiere coordinación explícita.

## D-006 — Autoridad separada del cliente

- Fecha: 2026-07-17
- Decisión: mantener `stokko-license-server/` como paquete desplegable independiente con lockfile, dependencias y ACL propios; excluirlo completamente del ASAR.
- Alternativas: compartir dependencias raíz; incluir servidor en el cliente pero ignorar la privada; depender solo de ASAR.
- Razón: reduce superficie y evita que el proceso de build cliente tenga una razón técnica para acceder a autoridad, datos o clave privada.
- Riesgo residual: el repositorio fuente aún contiene el código público del servicio para desarrollo coordinado; producción debe desplegarlo con cuenta/secret manager independientes.

## D-007 — Claves de prueba efímeras

- Fecha: 2026-07-17
- Decisión: generar pares RSA de prueba en memoria y escribirlos solo en directorios temporales aislados para integración.
- Alternativas: versionar una privada de fixture; reutilizar la privada recibida; omitir pruebas criptográficas.
- Razón: conserva pruebas reales de firma/verificación sin introducir una clave privada, aunque sea de test, en el repositorio o artefacto.
- Riesgo residual: los tests validan el protocolo criptográfico, no la custodia HSM de producción.
