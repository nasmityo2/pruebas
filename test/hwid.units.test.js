// Pruebas unitarias del HWID robusto (Fase 11.4) — lógica pura de combinación.
const { test } = require('node:test');
const assert = require('node:assert');
const hwid = require('../src/security/hwid');

test('combineSignals: con una señal fuerte produce SHA-256 hex de 64 chars', () => {
  const id = hwid.combineSignals({ machineId: 'abc123def456', cpuModel: 'Intel', hostArch: 'win32-ia32' });
  assert.ok(id);
  assert.match(id, /^[a-f0-9]{64}$/);
});

test('combineSignals: sin señales fuertes devuelve null (fail-safe, no ID copiable)', () => {
  assert.strictEqual(hwid.combineSignals({ cpuModel: 'Intel', hostArch: 'win32-ia32' }), null);
  assert.strictEqual(hwid.combineSignals({}), null);
});

test('combineSignals: descarta placeholders de BIOS OEM como señal fuerte', () => {
  assert.strictEqual(
    hwid.combineSignals({ boardSerial: 'To be filled by O.E.M.', biosSerial: 'Default string' }),
    null
  );
  // Con un serial real sí produce id.
  assert.ok(hwid.combineSignals({ boardSerial: 'REALSERIAL-7788' }));
});

test('combineSignals: es determinista (mismas señales => mismo id)', () => {
  const s = { machineId: 'm1', machineGuid: 'g1', boardSerial: 'b1', cpuModel: 'cpu', hostArch: 'a' };
  assert.strictEqual(hwid.combineSignals(s), hwid.combineSignals({ ...s }));
});

test('combineSignals: distintas señales => distinto id', () => {
  const a = hwid.combineSignals({ machineId: 'machine-aaaa-1111' });
  const b = hwid.combineSignals({ machineId: 'machine-bbbb-2222' });
  assert.ok(a && b);
  assert.notStrictEqual(a, b);
});

test('isMeaningful: valida longitud y descarta basura', () => {
  assert.ok(hwid.isMeaningful('serial-1234'));
  assert.ok(!hwid.isMeaningful(''));
  assert.ok(!hwid.isMeaningful('0'));
  assert.ok(!hwid.isMeaningful('none'));
});
