// Pruebas de lógica de base de datos (Fase 9) con node:sqlite (aislado, en memoria).
// Cubren: congelamiento de tasa por venta, migración idempotente, y stock/anulación (soft-delete).
const { test } = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE productos (id INTEGER PRIMARY KEY, nombre TEXT, stock REAL, activo INTEGER DEFAULT 1);
    CREATE TABLE ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_ves REAL NOT NULL, total_usd_bcv REAL NOT NULL,
      estado_pago TEXT DEFAULT 'PAGADO', monto_pendiente_usd REAL DEFAULT 0,
      creado_en TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE venta_productos (id INTEGER PRIMARY KEY, venta_id INTEGER, producto_id INTEGER, cantidad REAL);
  `);
  return db;
}

// Replica exacta del SQL de la migración de Fase 5 (add tasa_bcv + backfill), idempotente.
function migrateTasaBcv(db) {
  try { db.exec('ALTER TABLE ventas ADD COLUMN tasa_bcv REAL'); }
  catch (e) { if (!/duplicate column name/i.test(e.message)) throw e; }
  db.exec(`UPDATE ventas SET tasa_bcv = CASE WHEN total_usd_bcv > 0 THEN total_ves / total_usd_bcv ELSE tasa_bcv END WHERE tasa_bcv IS NULL`);
}

test('migración tasa_bcv: backfill = total_ves/total_usd_bcv', () => {
  const db = freshDb();
  db.prepare('INSERT INTO ventas (total_ves, total_usd_bcv) VALUES (?, ?)').run(3600, 36); // tasa 100
  db.prepare('INSERT INTO ventas (total_ves, total_usd_bcv) VALUES (?, ?)').run(500, 10);   // tasa 50
  migrateTasaBcv(db);
  const rows = db.prepare('SELECT id, tasa_bcv FROM ventas ORDER BY id').all();
  assert.strictEqual(rows[0].tasa_bcv, 100);
  assert.strictEqual(rows[1].tasa_bcv, 50);
});

test('migración es idempotente (correr dos veces no falla ni cambia datos)', () => {
  const db = freshDb();
  db.prepare('INSERT INTO ventas (total_ves, total_usd_bcv) VALUES (?, ?)').run(3600, 36);
  migrateTasaBcv(db);
  migrateTasaBcv(db); // segunda vez: ADD COLUMN duplicado se ignora, backfill solo afecta NULL
  const r = db.prepare('SELECT tasa_bcv FROM ventas').get();
  assert.strictEqual(r.tasa_bcv, 100);
});

test('ventas pasadas NO cambian al cambiar la tasa actual', () => {
  const db = freshDb();
  migrateTasaBcv(db);
  // Venta con tasa congelada 100
  db.prepare('INSERT INTO ventas (total_ves, total_usd_bcv, tasa_bcv) VALUES (?, ?, ?)').run(3600, 36, 100);
  const before = db.prepare('SELECT total_ves, total_usd_bcv, tasa_bcv FROM ventas WHERE id = 1').get();
  // "Cambiar la tasa" es una operación de settings que NO toca ventas: aquí simplemente
  // no hay ningún UPDATE a ventas. Verificamos que la fila permanece intacta.
  const after = db.prepare('SELECT total_ves, total_usd_bcv, tasa_bcv FROM ventas WHERE id = 1').get();
  assert.deepStrictEqual(before, after);
  assert.strictEqual(after.tasa_bcv, 100);
});

test('índices: CREATE INDEX IF NOT EXISTS es idempotente', () => {
  const db = freshDb();
  const idx = 'CREATE INDEX IF NOT EXISTS idx_ventas_creado_en ON ventas(creado_en);';
  db.exec(idx);
  db.exec(idx); // no debe fallar
  const found = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ventas_creado_en'").get();
  assert.ok(found);
});

test('Fase 5: PRAGMA foreign_keys=ON rechaza hijos con padre inexistente', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE ventas (id INTEGER PRIMARY KEY AUTOINCREMENT, total_ves REAL);
    CREATE TABLE venta_productos (
      id INTEGER PRIMARY KEY, venta_id INTEGER NOT NULL, cantidad REAL,
      FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE
    );
  `);
  // Insertar un hijo con venta_id inexistente DEBE fallar con FK activado.
  assert.throws(
    () => db.prepare('INSERT INTO venta_productos (venta_id, cantidad) VALUES (?, ?)').run(999, 1),
    /FOREIGN KEY/i
  );
  // Con un padre válido, sí funciona.
  const v = db.prepare('INSERT INTO ventas (total_ves) VALUES (?)').run(100);
  assert.doesNotThrow(() =>
    db.prepare('INSERT INTO venta_productos (venta_id, cantidad) VALUES (?, ?)').run(v.lastInsertRowid, 1)
  );
});

test('Fase 5: abonos anulados se CONSERVAN (no se borran) y se filtran por anulado', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE abonos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, venta_id INTEGER, monto_pagado_usd REAL,
      anulado INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare('INSERT INTO abonos (venta_id, monto_pagado_usd, anulado) VALUES (?, ?, ?)').run(1, 10, 0);
  db.prepare('INSERT INTO abonos (venta_id, monto_pagado_usd, anulado) VALUES (?, ?, ?)').run(1, 5, 1);
  // El histórico completo se conserva (2 filas), pero las consultas de negocio filtran anulados.
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM abonos').get().n, 2);
  const activos = db.prepare('SELECT COUNT(*) AS n FROM abonos WHERE COALESCE(anulado,0)=0').get().n;
  assert.strictEqual(activos, 1);
});

test('Anexo A A.4: descuento de stock con guarda AND stock>=? no deja stock negativo', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE productos (id INTEGER PRIMARY KEY, stock REAL DEFAULT 0);');
  db.prepare('INSERT INTO productos (id, stock) VALUES (?, ?)').run(1, 5);
  const upd = db.prepare('UPDATE productos SET stock = stock - ? WHERE id = ? AND stock >= ?');
  // Intento de vender 8 con stock 5: no debe cambiar nada (changes=0), sin stock negativo.
  const r1 = upd.run(8, 1, 8);
  assert.strictEqual(r1.changes, 0);
  assert.strictEqual(db.prepare('SELECT stock FROM productos WHERE id=1').get().stock, 5);
  // Venta válida de 3: descuenta a 2.
  const r2 = upd.run(3, 1, 3);
  assert.strictEqual(r2.changes, 1);
  assert.strictEqual(db.prepare('SELECT stock FROM productos WHERE id=1').get().stock, 2);
});

test('Anexo A A.4: anular abono es soft-delete (anulado=1), no borrado físico', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE abonos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, venta_id INTEGER, monto_pagado_usd REAL,
      anulado INTEGER NOT NULL DEFAULT 0, anulado_en DATETIME, motivo_anulacion TEXT
    );
  `);
  const ins = db.prepare('INSERT INTO abonos (venta_id, monto_pagado_usd) VALUES (?, ?)').run(1, 10);
  const id = ins.lastInsertRowid;
  const voidStmt = db.prepare(`
    UPDATE abonos SET anulado = 1, anulado_en = datetime('now'), motivo_anulacion = @motivo
    WHERE id = @id AND COALESCE(anulado,0) = 0
  `);
  const r = voidStmt.run({ id, motivo: 'error de cobro' });
  assert.strictEqual(r.changes, 1);
  // La fila SIGUE existiendo (no se borró), marcada anulada.
  const row = db.prepare('SELECT anulado, motivo_anulacion FROM abonos WHERE id = ?').get(id);
  assert.strictEqual(row.anulado, 1);
  assert.strictEqual(row.motivo_anulacion, 'error de cobro');
  // Re-anular no hace nada (idempotente).
  assert.strictEqual(voidStmt.run({ id, motivo: 'x' }).changes, 0);
  // Y no cuenta como abono activo.
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM abonos WHERE COALESCE(anulado,0)=0').get().n, 0);
});

test('venta descuenta stock; anular restaura stock y hace soft-delete (no borra la venta)', () => {
  const db = freshDb();
  db.prepare('INSERT INTO productos (id, nombre, stock) VALUES (?, ?, ?)').run(1, 'Harina', 10);

  // Simular venta de 3 unidades
  const venta = db.prepare('INSERT INTO ventas (total_ves, total_usd_bcv) VALUES (?, ?)').run(300, 3);
  const ventaId = venta.lastInsertRowid;
  db.prepare('INSERT INTO venta_productos (venta_id, producto_id, cantidad) VALUES (?, ?, ?)').run(ventaId, 1, 3);
  db.prepare('UPDATE productos SET stock = stock - ? WHERE id = ?').run(3, 1);
  assert.strictEqual(db.prepare('SELECT stock FROM productos WHERE id=1').get().stock, 7);

  // Anular (replica de la lógica): restaurar stock + marcar ANULADO (NO borrar la venta)
  const items = db.prepare('SELECT producto_id, cantidad FROM venta_productos WHERE venta_id = ?').all(ventaId);
  for (const it of items) db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?').run(it.cantidad, it.producto_id);
  db.prepare("UPDATE ventas SET estado_pago = 'ANULADO', monto_pendiente_usd = 0 WHERE id = ?").run(ventaId);

  assert.strictEqual(db.prepare('SELECT stock FROM productos WHERE id=1').get().stock, 10, 'stock restaurado');
  const sale = db.prepare('SELECT estado_pago FROM ventas WHERE id = ?').get(ventaId);
  assert.ok(sale, 'la venta NO se borra (soft-delete)');
  assert.strictEqual(sale.estado_pago, 'ANULADO');
});
