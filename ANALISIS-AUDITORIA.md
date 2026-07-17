# Auditoría inicial — BodegApp → Stokko

## Alcance revisado

Se extrajo y revisó el ZIP recibido: estructura Electron/Fastify/SQLite, empaquetado Forge/WiX, proceso principal, preload, servidor local, licencias, scripts de seguridad, documentación previa, pruebas, referencias de marca y sinks HTML.

## Conclusión ejecutiva

El proyecto ya tiene buenas defensas parciales (gate de licencia server-side, whitelist IPC, firma de updates, HWID, anti-replay/rollback, guard de secretos e integridad), pero **todavía no está blindado para distribución**. ASAR sigue conteniendo JavaScript legible; fuses/bytenode/ofuscación son pasos manuales o pendientes; hay XSS por cerrar; y el ZIP compartido incluyó secretos y datos runtime que deben considerarse comprometidos.

## Evidencia observada

- 1.042 archivos extraídos, aproximadamente 16 MB.
- Electron 22.3.27, Fastify, better-sqlite3, Forge/WiX.
- ASAR está activado, pero eso no evita extracción.
- `apply-fuses.js` existe, aunque no está automatizado en el release ni la dependencia está fijada.
- Los JS del renderer se distribuyen en archivos grandes y legibles (`pos.js`, `inventario.js`, `cobranza.js`, etc.).
- Se localizaron 137 asignaciones `innerHTML`/sinks relacionados; varias interpolan datos o errores.
- El rebranding afecta paquete, AppData, instalador, tray, UI, panel, scripts, docs, variables y assets.
- El ZIP contiene `.env`, llaves del servidor, licencia y JSON/logs runtime. Git puede ignorarlos y el empaquetador puede excluirlos, pero el archivo ya los divulgó.
- `npm run check:secrets` pasa para el conjunto empaquetable.
- La suite ejecutó 69 tests: 68 pasaron y 1 falló porque `bcryptjs` no estaba instalado en la raíz del ZIP. Debe validarse con `npm ci` desde cero.
- La ventana principal tiene `contextIsolation: true` y `nodeIntegration: false`; sandbox y políticas de navegación requieren refuerzo.
- El servidor escucha en loopback por defecto y LAN es opt-in, pero falta una revisión completa de autorización por endpoint y de impresión remota.

## Riesgo clave sobre código fuente

No es posible garantizar secreto absoluto del código que se ejecuta en el equipo del cliente. La protección extrema razonable consiste en **no empaquetar el fuente original**: bundle/minificación, ofuscación, bytecode por arquitectura, fuses, integridad firmada, cero source maps, lógica sensible remota/nativa y validación ofensiva del ASAR/instalador.

Limpiar `%TEMP%` solo es una defensa secundaria: un atacante puede copiar archivos durante la instalación o extraer el MSI/CAB sin instalar. El payload del instalador debe estar blindado antes de llegar a temporales.

## Prioridades

1. Rotar y purgar secretos expuestos.
2. Obtener baseline limpia y suite verde con instalación reproducible.
3. Completar rebranding con migración de datos BodegApp→Stokko.
4. Cerrar bugs financieros, XSS, autorización LAN/IPC y shell execution.
5. Automatizar pipeline seguro: bundle → bytecode/ofuscación → integridad → ASAR → fuses → instalador → firma → inspección hostil.
6. Probar x64/ia32 y documentar el riesgo residual de Windows 7/Electron 22.

El detalle ejecutable, las casillas y las puertas de aceptación están en `PLAN.md`. El texto listo para pegar en Cursor está en `PROMPT-MAESTRO-CURSOR.md`.
