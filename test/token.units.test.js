// Pruebas unitarias del anti-replay del token (Fase 11.5) — lógica pura.
const { test } = require('node:test');
const assert = require('node:assert');
const token = require('../src/security/token');

test('isReplay: un token con iat menor al último aceptado es replay', () => {
  assert.strictEqual(token.isReplay({ incomingIat: 100, lastAcceptedIat: 200 }), true);
});

test('isReplay: un token con iat >= último aceptado NO es replay', () => {
  assert.strictEqual(token.isReplay({ incomingIat: 200, lastAcceptedIat: 200 }), false);
  assert.strictEqual(token.isReplay({ incomingIat: 300, lastAcceptedIat: 200 }), false);
});

test('isReplay: sin último aceptado previo, no es replay', () => {
  assert.strictEqual(token.isReplay({ incomingIat: 100 }), false);
});

test('isReplay: iat inválido se rechaza (no confiar)', () => {
  assert.strictEqual(token.isReplay({ incomingIat: undefined, lastAcceptedIat: 10 }), true);
  assert.strictEqual(token.isReplay({ incomingIat: NaN, lastAcceptedIat: 10 }), true);
});

test('nextAcceptedIat: es monótono (nunca retrocede)', () => {
  assert.strictEqual(token.nextAcceptedIat({ incomingIat: 100, lastAcceptedIat: 200 }), 200);
  assert.strictEqual(token.nextAcceptedIat({ incomingIat: 300, lastAcceptedIat: 200 }), 300);
  assert.strictEqual(token.nextAcceptedIat({ incomingIat: 150 }), 150);
});
