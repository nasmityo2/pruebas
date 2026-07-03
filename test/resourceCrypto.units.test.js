// Pruebas del cifrado de recursos ligado a licencia (Fase 11.6) y watermark (Fase 11.7).
const { test } = require('node:test');
const assert = require('node:assert');
const rc = require('../src/security/resourceCrypto');
const wm = require('../src/security/watermark');

test('deriveResourceKey: determinista y sensible a HWID y k', () => {
  const k1 = rc.deriveResourceKey('HWID-A', 'material-k-1');
  const k2 = rc.deriveResourceKey('HWID-A', 'material-k-1');
  assert.ok(Buffer.isBuffer(k1) && k1.length === 32);
  assert.ok(k1.equals(k2));
  assert.ok(!k1.equals(rc.deriveResourceKey('HWID-B', 'material-k-1')));
  assert.ok(!k1.equals(rc.deriveResourceKey('HWID-A', 'material-k-2')));
});

test('deriveResourceKey: sin material lanza error (no hay clave sin token válido)', () => {
  assert.throws(() => rc.deriveResourceKey('HWID', ''), /MISSING/);
  assert.throws(() => rc.deriveResourceKey('', 'k'), /MISSING/);
});

test('encrypt/decrypt roundtrip con la clave correcta', () => {
  const key = rc.deriveResourceKey('HWID-X', 'k-secreta');
  const plain = Buffer.from('parámetros críticos de negocio', 'utf8');
  const enc = rc.encryptResource(plain, key);
  const dec = rc.decryptResource(enc, key);
  assert.strictEqual(dec.toString('utf8'), 'parámetros críticos de negocio');
});

test('descifrar con clave equivocada (sin licencia válida) FALLA', () => {
  const good = rc.deriveResourceKey('HWID-X', 'k-secreta');
  const bad = rc.deriveResourceKey('HWID-X', 'k-equivocada');
  const enc = rc.encryptResource(Buffer.from('datos'), good);
  assert.throws(() => rc.decryptResource(enc, bad));
});

test('watermark: determinista por licencia y distinto entre licencias', () => {
  assert.strictEqual(wm.licenseWatermark('BGA-AAAA-BBBB'), wm.licenseWatermark('BGA-AAAA-BBBB'));
  assert.notStrictEqual(wm.licenseWatermark('BGA-AAAA-BBBB'), wm.licenseWatermark('BGA-CCCC-DDDD'));
  assert.match(wm.licenseWatermark('BGA-AAAA-BBBB'), /^[0-9A-F]{8}$/);
  assert.strictEqual(wm.licenseWatermark(''), '');
});
