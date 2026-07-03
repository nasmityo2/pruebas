// Pruebas unitarias del bloqueo por offline prolongado (Fase 11.3) — lógica pura.
const { test } = require('node:test');
const assert = require('node:assert');
const offline = require('../src/security/offline');

const HOUR = 3600;

test('dentro de la ventana de gracia offline NO bloquea', () => {
  const now = 1_000_000_000;
  assert.strictEqual(
    offline.isOfflineGraceExceeded({ now, lastSuccessfulVerify: now - 10 * HOUR, graceHours: 72 }),
    false
  );
});

test('superada la ventana de gracia offline SÍ bloquea', () => {
  const now = 1_000_000_000;
  assert.strictEqual(
    offline.isOfflineGraceExceeded({ now, lastSuccessfulVerify: now - 80 * HOUR, graceHours: 72 }),
    true
  );
});

test('sin verificación previa (0) no bloquea por este criterio', () => {
  assert.strictEqual(offline.isOfflineGraceExceeded({ now: 1_000_000_000, lastSuccessfulVerify: 0 }), false);
});

test('respeta graceHours personalizado', () => {
  const now = 1_000_000_000;
  assert.strictEqual(offline.isOfflineGraceExceeded({ now, lastSuccessfulVerify: now - 5 * HOUR, graceHours: 3 }), true);
  assert.strictEqual(offline.isOfflineGraceExceeded({ now, lastSuccessfulVerify: now - 2 * HOUR, graceHours: 3 }), false);
});
