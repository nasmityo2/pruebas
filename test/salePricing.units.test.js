const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildCanonicalLines,
  buildCanonicalPayments,
} = require('../src/services/salePricing');

const rates = {
  BCV: 40,
  PARALELO: 45,
  COP: 0.01,
  CALC_METHOD: 1,
  IVA_PERCENTAGE: 16,
  IVA_MODE: 'INCLUDED',
};

const products = new Map([
  [1, {
    id: 1,
    nombre: 'Producto A',
    costo: 10,
    moneda_costo: 'BCV',
    porcentaje_ganancia: 25,
    stock: 20,
    exento_iva: 0,
    activo: 1,
  }],
]);
const presentations = new Map([
  [10, {
    id: 10,
    producto_id: 1,
    nombre: 'Caja',
    unidades_base: 4,
    precio: 60,
    moneda: 'BCV',
    precio_ves: 0,
    activo: 1,
  }],
]);

const lookup = {
  getProduct: (id) => products.get(id),
  getPresentation: (id) => presentations.get(id),
};

test('recalcula precio y total en servidor sin confiar en totales renderer', () => {
  const result = buildCanonicalLines({
    cart: [{ id: 1, quantity: 2, priceVes: 1 }],
    rates,
    ...lookup,
    allowPriceOverride: true,
  });
  assert.strictEqual(result.lines[0].unitPriceVes, 1);
  assert.strictEqual(result.totalVes, 2);

  assert.throws(
    () => buildCanonicalLines({
      cart: [{ id: 1, quantity: 2, priceVes: 1 }],
      rates,
      ...lookup,
      allowPriceOverride: false,
    }),
    /precio autorizado/,
  );

  const canonical = buildCanonicalLines({
    cart: [{ id: 1, quantity: 2 }],
    rates,
    ...lookup,
  });
  assert.strictEqual(canonical.lines[0].unitPriceVes, 500);
  assert.strictEqual(canonical.totalVes, 1000);
  assert.strictEqual(canonical.totalUsd, 25);
});

test('congela presentación y descuenta unidades base', () => {
  const result = buildCanonicalLines({
    cart: [{ id: 1, presentationId: 10, quantity: 2, priceVes: 2400 }],
    rates,
    ...lookup,
  });
  assert.strictEqual(result.lines[0].quantity, 8);
  assert.strictEqual(result.lines[0].saleQuantity, 2);
  assert.strictEqual(result.lines[0].unitPriceVes, 600);
  assert.strictEqual(result.lines[0].presentationName, 'Caja');
  assert.strictEqual(result.totalVes, 4800);
});

test('suma líneas duplicadas antes de validar stock', () => {
  assert.throws(
    () => buildCanonicalLines({
      cart: [
        { id: 1, quantity: 12 },
        { id: 1, quantity: 12 },
      ],
      rates,
      ...lookup,
    }),
    /Stock insuficiente/,
  );
});

test('IVA excluido se calcula y agrega server-side', () => {
  const result = buildCanonicalLines({
    cart: [{ id: 1, quantity: 1 }],
    rates: { ...rates, IVA_MODE: 'EXCLUDED' },
    ...lookup,
  });
  assert.strictEqual(result.subtotalVes, 500);
  assert.strictEqual(result.taxTotalVes, 80);
  assert.strictEqual(result.totalVes, 580);
});

test('pagos ignoran amountInVes del cliente y usan método/tasa autorizados', () => {
  const result = buildCanonicalPayments({
    payments: [{ method: 'USD_EFECTIVO', amountReceived: 10, amountInVes: 1 }],
    methods: [{
      key: 'USD_EFECTIVO',
      moneda: 'USD',
      tipo_tasa: 'BCV',
      activo: 1,
    }],
    rates,
  });
  assert.strictEqual(result.payments[0].amountInVes, 400);
  assert.strictEqual(result.payments[0].conversionRate, 40);
  assert.strictEqual(result.totalPaidVes, 400);
});
