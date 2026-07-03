// Pruebas unitarias del anti-rollback de reloj (Fase 11.2) — lógica pura.
const { test } = require('node:test');
const assert = require('node:assert');
const clock = require('../src/security/clock');

const HOUR = 3600;
const DAY = 24 * HOUR;

test('isClockRolledBack: reloj normal (avanza) NO es rollback', () => {
  const now = 1_000_000_000;
  assert.strictEqual(clock.isClockRolledBack({ now, lastSeenEpoch: now - HOUR }), false);
});

test('isClockRolledBack: atraso dentro de la tolerancia (husos) NO es rollback', () => {
  const now = 1_000_000_000;
  // atrasado 12h respecto al último visto, con tolerancia 24h => permitido
  assert.strictEqual(clock.isClockRolledBack({ now, lastSeenEpoch: now + 12 * HOUR }), false);
});

test('isClockRolledBack: atraso mayor a la tolerancia SÍ es rollback', () => {
  const now = 1_000_000_000;
  // el último visto está 3 días en el futuro respecto a "ahora" => reloj atrasado
  assert.strictEqual(clock.isClockRolledBack({ now, lastSeenEpoch: now + 3 * DAY }), true);
});

test('isClockRolledBack: sin lastSeen previo nunca es rollback', () => {
  assert.strictEqual(clock.isClockRolledBack({ now: 1_000_000_000 }), false);
  assert.strictEqual(clock.isClockRolledBack({ now: 1_000_000_000, lastSeenEpoch: 0 }), false);
});

test('nextLastSeen: es monótono (nunca retrocede)', () => {
  assert.strictEqual(clock.nextLastSeen({ now: 100, lastSeenEpoch: 200 }), 200); // no retrocede
  assert.strictEqual(clock.nextLastSeen({ now: 300, lastSeenEpoch: 200 }), 300); // avanza
  assert.strictEqual(clock.nextLastSeen({ now: 150 }), 150);
});

test('maxLastSeen: toma el máximo de varias fuentes persistidas', () => {
  assert.strictEqual(clock.maxLastSeen(10, 999, 42, undefined, null), 999);
  assert.strictEqual(clock.maxLastSeen(), 0);
});
