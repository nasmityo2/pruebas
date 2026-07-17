// src/utils/migrations.js
// Runner de migraciones versionadas e idempotente (Fase 5).
// - Registra cada migración aplicada en la tabla _migrations.
// - SIEMPRE hace un backup de la DB ANTES de aplicar migraciones pendientes.
// - Cada migración corre dentro de una transacción; si falla, se revierte.
const fs = require('fs');
const path = require('path');
const { db } = require('../database');
const { getDataBasePath } = require('./settings');

function ensureMigrationsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT (datetime('now','localtime'))
    );
  `);
}

function isApplied(name) {
  return !!db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name);
}
function markApplied(name) {
  db.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)').run(name);
}

function backupBeforeMigrate(reason) {
  try {
    const dbPath = path.join(getDataBasePath(), 'mi-tienda.db');
    if (!fs.existsSync(dbPath)) return null;
    const backupsDir = path.join(getDataBasePath(), 'backups');
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(backupsDir, `pre-migration-${ts}.db`);
    // Usar la API de backup de SQLite si está disponible; si no, copia de archivo.
    if (typeof db.backup === 'function') {
      // db.backup es asíncrona (promesa); pero para simplicidad hacemos copia de archivo,
      // que es consistente porque no hay escrituras concurrentes en el arranque.
    }
    fs.copyFileSync(dbPath, dest);
    console.log(`[MIGRATION] Backup previo creado: ${dest} (motivo: ${reason})`);
    return dest;
  } catch (e) {
    console.error('[MIGRATION] No se pudo crear backup previo:', e.message);
    // Si no podemos respaldar, NO migramos (fail-safe).
    throw new Error('Backup previo a migración falló; se aborta la migración por seguridad.');
  }
}

function addColumnIfMissing(table, columnDef, columnName) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (e) {
    if (!/duplicate column name/i.test(e.message)) throw e;
  }
}

// Lista ordenada de migraciones versionadas.
const MIGRATIONS = [
  {
    name: '2026_07_01_add_tasa_bcv_to_ventas',
    up() {
      // Congelar la tasa aplicada al momento de la venta.
      addColumnIfMissing('ventas', 'tasa_bcv REAL');
      // Backfill: derivar de los totales guardados (no recalcula nada con tasas nuevas).
      db.exec(`
        UPDATE ventas
        SET tasa_bcv = CASE WHEN total_usd_bcv > 0 THEN total_ves / total_usd_bcv ELSE tasa_bcv END
        WHERE tasa_bcv IS NULL
      `);
    },
  },
  {
    name: '2026_07_02_indices_busqueda',
    up() {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_productos_nombre ON productos(nombre);
        CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria);
        CREATE INDEX IF NOT EXISTS idx_productos_activo ON productos(activo);
        CREATE INDEX IF NOT EXISTS idx_ventas_creado_en ON ventas(creado_en);
        CREATE INDEX IF NOT EXISTS idx_ventas_cliente ON ventas(cliente_id);
        CREATE INDEX IF NOT EXISTS idx_ventas_estado ON ventas(estado_pago);
        CREATE INDEX IF NOT EXISTS idx_venta_productos_venta ON venta_productos(venta_id);
        CREATE INDEX IF NOT EXISTS idx_venta_productos_producto ON venta_productos(producto_id);
        CREATE INDEX IF NOT EXISTS idx_venta_pagos_venta ON venta_pagos(venta_id);
        CREATE INDEX IF NOT EXISTS idx_abonos_venta ON abonos(venta_id);
        CREATE INDEX IF NOT EXISTS idx_abonos_cliente ON abonos(cliente_id);
        CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(nombre);
      `);
    },
  },
  {
    name: '2026_07_17_sale_snapshots_and_payment_soft_delete',
    up() {
      addColumnIfMissing('venta_productos', 'presentacion_id INTEGER', 'presentacion_id');
      addColumnIfMissing('venta_productos', 'presentacion_nombre TEXT', 'presentacion_nombre');
      addColumnIfMissing('venta_productos', 'cantidad_venta REAL', 'cantidad_venta');
      addColumnIfMissing('venta_productos', 'unidades_base REAL NOT NULL DEFAULT 1', 'unidades_base');
      addColumnIfMissing('venta_productos', 'tasa_bcv_momento REAL', 'tasa_bcv_momento');
      addColumnIfMissing('venta_productos', 'impuesto_unitario_ves REAL NOT NULL DEFAULT 0', 'impuesto_unitario_ves');
      addColumnIfMissing('venta_productos', 'precio_origen TEXT', 'precio_origen');
      addColumnIfMissing('venta_productos', 'moneda_precio TEXT', 'moneda_precio');
      addColumnIfMissing('venta_pagos', 'activo INTEGER NOT NULL DEFAULT 1', 'activo');
      addColumnIfMissing('venta_pagos', 'anulado_en DATETIME', 'anulado_en');
      addColumnIfMissing('venta_pagos', 'motivo_anulacion TEXT', 'motivo_anulacion');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_venta_pagos_activo ON venta_pagos(venta_id, activo);
        CREATE TABLE IF NOT EXISTS sale_requests (
          request_id TEXT PRIMARY KEY NOT NULL,
          venta_id INTEGER,
          response_json TEXT,
          creado_en DATETIME DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (venta_id) REFERENCES ventas(id)
        );
      `);
    },
  },
];

function runMigrations() {
  ensureMigrationsTable();
  const pending = MIGRATIONS.filter(m => !isApplied(m.name));
  if (pending.length === 0) {
    return { applied: 0 };
  }
  console.log(`[MIGRATION] ${pending.length} migración(es) pendiente(s).`);
  backupBeforeMigrate(`${pending.length} migraciones pendientes`);

  for (const m of pending) {
    const tx = db.transaction(() => {
      m.up();
      markApplied(m.name);
    });
    tx();
    console.log(`[MIGRATION] Aplicada: ${m.name}`);
  }
  return { applied: pending.length };
}

module.exports = { runMigrations, MIGRATIONS };
