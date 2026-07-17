# Inventario ejecutable de baseline

Fecha: 2026-07-17

## Procesos y entradas

- Electron main: `main.js`.
- Preload: `preload.js`.
- Backend Fastify embebido: `server.js`.
- Base de datos SQLite: `src/database.js`, ruta actual `%APPDATA%\BodegApp_Data\mi-tienda.db`.
- Servidor de licencias separado: `license-server/server.js`.
- Empaquetado: Electron Forge + WiX en `forge.config.js`.

## Ventanas y capacidades Electron

- Ventana principal sin frame, actualmente `1200x800`, sirve el origen loopback del backend.
- Ventanas ocultas sandboxed para impresión HTML y PDF.
- Ventana aislada de smoke, solo en desarrollo.
- Tray con abrir/salir.
- Canales IPC explícitos (9): `printer:getPrinters`, `printer:printText`, `printer:printHTML`, `printer:savePDF`, `app:restart`, `shell:openExternal`, `window:minimize`, `window:maximize`, `window:close`.
- `preload.js` expone puentes separados para impresión, shell y controles de ventana; el puente genérico solo permite `app:restart`.

## API local

Se inventariaron 112 rutas adaptadas desde los routers y 2 rutas Fastify directas.

- `/api/products` (15): listar, crear, exportar, plantilla, importar, bultos, búsquedas por barcode/id, actualizar, stock, barcode, imagen, eliminar, eliminación masiva y ganancia masiva.
- `/api/backup` (9): crear/listar/configurar/restaurar local; backup/status/token/retirar token/restaurar cloud.
- `/api/utils` (8): IP local, QR, progreso/descarga/ejecución de update, firewall y estado/activación LAN.
- `/api/license` (6): info, estado/consulta de update, activar, trial y sincronizar contacto.
- `/api/print-settings` (2): obtener y guardar.
- `/api/admin` (5): CRUD de usuarios y auditoría.
- `/api/settings` (9): tasas, negocio, impresión, contraseña admin y contacto.
- `/api/sales` (4): procesar, recibo, detalle y vuelto.
- `/api/reports` (20): cierres/rangos/exportaciones/pagos/búsqueda/resumen/anulación/dashboard/caja/PDFs/historial Z.
- `/api/custom-rates` (3): listar, crear y eliminar.
- `/api/presentations` (6): listar, crear, barcode, detalle, actualizar y eliminar.
- `/api/payment-methods` (3): listar, crear y eliminar.
- `/api/categories` (3): listar, actualizar y eliminar.
- `/api/clients` (9): CRUD, deudas, deudas con productos, pagos individual/masivo y anulación.
- `/api/cashea` (7): crear, ventas por cliente, cuotas, pagar, próximas, pendientes y reconciliar.
- `/api/auth` (3): estado, configurar y verificar.
- Fastify directo: `POST /api/print/remote` y `GET /`.

## Tablas persistentes

`settings`, `productos`, `presentaciones`, `categorias`, `clientes`, `ventas`, `venta_productos`, `venta_pagos`, `abonos`, `retiros_caja`, `aperturas_caja`, `cierres_caja`, `cashea_ventas`, `cashea_cuotas`, `tasas_personalizadas`, `metodos_pago`, `usuarios`, `auditoria`, `_migrations`.

Las tablas con sufijo `_temp` y `_write_test` son transitorias durante migraciones/verificación.

## Migraciones

- `src/database.js`: migraciones legacy idempotentes, reconstrucciones de tablas y activación final de foreign keys.
- `src/utils/migrations.js`: runner versionado con backup previo y transacción.
- Versionadas actuales: `2026_07_01_add_tasa_bcv_to_ventas`, `2026_07_02_indices_busqueda`.
- `src/utils/migration.js`: migración legacy de `%PROGRAMDATA%\BodegApp_Data` a `%APPDATA%\BodegApp_Data`; debe sustituirse por la migración Stokko con backup/lock/rollback.

## Superficies UI

- Shell: `index.html`, `sidebar.html`, `topbar.html`.
- Activación: `activacion.html`.
- POS: `pos.html` + `public/js/pos.js`.
- Inventario/productos/presentaciones/importación/etiquetas: `inventario.html`, `consultar_producto.html`, `etiqueta.html`.
- Cobranza/clientes: `cobranza.html`.
- Reportes/detalle/indicadores: `reports.html`, `detalles_venta.html`, `indicadores.html`.
- Configuración/backup cloud: `configuracion.html`, `config_cloud.html`.

## Flujos críticos

Activación/trial/revocación/offline; setup de negocio/admin; venta y pagos; Cashea; anulación y abonos; stock/importación; apertura/retiro/avance/cierre Z; reportes/PDF/Excel; impresión; backups local/cloud; LAN/firewall; updates.

## Comandos de inventario

- `rg "router\.(get|post|put|delete|patch)\(" routes`
- `rg "fastify\.(get|post|put|delete|patch)\(|registerExpressRouter\(" server.js`
- `rg "CREATE TABLE|ALTER TABLE" src`
- `rg "ipcMain\.(handle|on)\(|ipcRenderer\.(invoke|send|on)\("`
- `rg "new BrowserWindow\(|loadURL\(|new Tray\("`
