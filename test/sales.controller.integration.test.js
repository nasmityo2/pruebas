const { test, before } = require('node:test');
const assert = require('node:assert');

let db;
let salesController;
let createdSaleId;

before(() => {
  const database = require('../src/database');
  database.initializeDB();
  db = database.db;
  db.prepare("UPDATE settings SET value = 40 WHERE key = 'BCV'").run();
  db.prepare("UPDATE settings SET value = 1 WHERE key = 'CALC_METHOD'").run();
  db.prepare("UPDATE settings SET value = 16 WHERE key = 'IVA_PERCENTAGE'").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('IVA_MODE', 'INCLUDED')").run();
  db.prepare(`
    INSERT INTO productos (
      nombre, costo, moneda_costo, porcentaje_ganancia, stock, categoria,
      tipo_venta, proveedor, barcode, costo_bulto, unidades_bulto, activo, exento_iva
    ) VALUES ('Producto contrato', 10, 'BCV', 25, 20, 'Test', 'UNIDAD', '', 'SALE-TEST-1', 0, 1, 1, 1)
  `).run();
  salesController = require('../controllers/sales.controller');
});

function responseCapture() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function saleRequest(overrides = {}) {
  return {
    headers: { 'x-idempotency-key': overrides.requestId || 'sale-integration-0001' },
    body: {
      requestId: overrides.requestId || 'sale-integration-0001',
      cart: overrides.cart || [{ id: 1, quantity: 2, priceVes: 500 }],
      payments: overrides.payments || [{
        method: 'USD_EFECTIVO',
        amountReceived: 25,
        amountInVes: 1,
      }],
      totalVes: 1,
      totalUsd: 999999,
      cliente_id: null,
    },
  };
}

test('venta recalcula totales/pagos, congela snapshots y descuenta stock atómicamente', () => {
  const res = responseCapture();
  salesController.processSale(saleRequest(), res);
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.payload.total_ves, 1000);
  assert.strictEqual(res.payload.total_usd, 25);

  const sale = db.prepare('SELECT * FROM ventas WHERE id = ?').get(res.payload.saleId);
  const line = db.prepare('SELECT * FROM venta_productos WHERE venta_id = ?').get(res.payload.saleId);
  const payment = db.prepare('SELECT * FROM venta_pagos WHERE venta_id = ?').get(res.payload.saleId);
  const product = db.prepare('SELECT stock FROM productos WHERE id = 1').get();
  createdSaleId = res.payload.saleId;
  assert.strictEqual(sale.total_ves, 1000);
  assert.strictEqual(sale.total_usd_bcv, 25);
  assert.strictEqual(sale.tasa_bcv, 40);
  assert.strictEqual(line.precio_unitario_ves, 500);
  assert.strictEqual(line.costo_unitario_ves, 400);
  assert.strictEqual(line.cantidad_venta, 2);
  assert.strictEqual(line.tasa_bcv_momento, 40);
  assert.strictEqual(payment.monto_en_ves, 1000);
  assert.strictEqual(payment.tasa_bcv_momento, 40);
  assert.strictEqual(product.stock, 18);
});

test('reintento con misma idempotency key no duplica venta ni stock', () => {
  const beforeCount = db.prepare('SELECT COUNT(*) AS count FROM ventas').get().count;
  const beforeStock = db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock;
  const res = responseCapture();
  salesController.processSale(saleRequest(), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.payload.replayed, true);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM ventas').get().count, beforeCount);
  assert.strictEqual(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, beforeStock);
});

test('precio manipulado sin autorización se rechaza', () => {
  const res = responseCapture();
  salesController.processSale(saleRequest({
    requestId: 'sale-integration-price-tamper',
    cart: [{ id: 1, quantity: 1, priceVes: 1 }],
  }), res);
  assert.strictEqual(res.statusCode, 403);
  assert.match(res.payload.error, /precio autorizado/);
});

test('líneas duplicadas que exceden stock se rechazan sin escritura parcial', () => {
  const beforeCount = db.prepare('SELECT COUNT(*) AS count FROM ventas').get().count;
  const res = responseCapture();
  salesController.processSale(saleRequest({
    requestId: 'sale-integration-duplicate-stock',
    cart: [
      { id: 1, quantity: 10, priceVes: 500 },
      { id: 1, quantity: 10, priceVes: 500 },
    ],
  }), res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.payload.error, /Stock insuficiente/);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM ventas').get().count, beforeCount);
});

test('anulación conserva pagos con soft-delete y restaura stock atómicamente', () => {
  const reportsController = require('../controllers/reports.controller');
  const res = responseCapture();
  reportsController.voidSale({
    params: { saleId: createdSaleId },
    body: {},
    headers: {},
    ip: '127.0.0.1',
  }, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(db.prepare('SELECT estado_pago FROM ventas WHERE id = ?').get(createdSaleId).estado_pago, 'ANULADO');
  const payment = db.prepare('SELECT activo, anulado_en FROM venta_pagos WHERE venta_id = ?').get(createdSaleId);
  assert.strictEqual(payment.activo, 0);
  assert.ok(payment.anulado_en);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM venta_pagos WHERE venta_id = ?').get(createdSaleId).count, 1);
  assert.strictEqual(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 20);
});
