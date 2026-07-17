const { test, before } = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('node:stream');

let db;
let reportsController;

before(() => {
  const database = require('../src/database');
  database.initializeDB();
  db = database.db;
  reportsController = require('../controllers/reports.controller');
  const sale = db.prepare(`
    INSERT INTO ventas (
      total_ves, total_usd_bcv, estado_pago, monto_pendiente_usd, impuesto_total, archivado, tasa_bcv
    ) VALUES (100, 2.5, 'PAGADO', 0, 0, 1, 40)
  `).run();
  db.prepare(`
    INSERT INTO venta_pagos (
      venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento, activo
    ) VALUES (?, 'VES_EFECTIVO', 100, 100, 1, 1)
  `).run(sale.lastInsertRowid);
});

function pdfResponse() {
  const stream = new PassThrough();
  stream.headers = {};
  stream.setHeader = (name, value) => { stream.headers[name] = value; };
  stream.status = (code) => { stream.statusCode = code; return stream; };
  stream.json = (payload) => { stream.payload = payload; stream.end(JSON.stringify(payload)); return stream; };
  stream.send = (payload) => { stream.payload = payload; stream.end(String(payload)); return stream; };
  stream.resume();
  return stream;
}

test('cierre Z congela snapshot server-side antes de completar el PDF', async () => {
  const res = pdfResponse();
  const finished = new Promise((resolve, reject) => {
    res.once('finish', resolve);
    res.once('error', reject);
  });
  reportsController.printCierreZ({
    body: {
      summaryData: [{ metodo: 'FALSO', total_ves: 999999 }],
      totals: { sistemaVes: 999999, sistemaUsd: 999999, manualVes: 90, manualUsd: 0 },
      notes: 'Conteo físico',
    },
  }, res);

  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM cierres_caja').get().count, 1);
  const closure = db.prepare('SELECT * FROM cierres_z ORDER BY id DESC LIMIT 1').get();
  const raw = JSON.parse(closure.raw_json);
  assert.strictEqual(closure.total_sistema_ves, 100);
  assert.strictEqual(raw.totals.sistemaVes, 100);
  assert.notStrictEqual(raw.summaryData[0].metodo, 'FALSO');
  await finished;
  assert.match(res.headers['Content-Type'], /pdf/);
});

test('cierre Z revierte la marca simple si falla el snapshot detallado', () => {
  const simpleBefore = db.prepare('SELECT COUNT(*) AS count FROM cierres_caja').get().count;
  const historyBefore = db.prepare('SELECT COUNT(*) AS count FROM cierres_z').get().count;
  db.exec(`
    CREATE TRIGGER fail_cierre_z_test
    BEFORE INSERT ON cierres_z
    BEGIN
      SELECT RAISE(ABORT, 'forced snapshot failure');
    END;
  `);
  try {
    const res = pdfResponse();
    reportsController.printCierreZ({
      body: { totals: { manualVes: 0, manualUsd: 0 } },
    }, res);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM cierres_caja').get().count, simpleBefore);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM cierres_z').get().count, historyBefore);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_cierre_z_test');
  }
});
