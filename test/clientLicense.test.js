// Verificación del lado CLIENTE del token firmado (Fase 9).
// Firma un token con la privada real y comprueba que el cliente valida firma + HWID + expiración.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const licenseUtil = require('../src/utils/license');
const { getEphemeralSigningKeys } = require('./helpers/signingKeys');

const { privateKey: PRIVATE_KEY, publicKey: PUBLIC_KEY } = getEphemeralSigningKeys();

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(body), PRIVATE_KEY);
  return `${body}.${b64url(sig)}`;
}

const hwid = licenseUtil.getHardwareId();
const now = Math.floor(Date.now() / 1000);

test('cliente valida token de licencia correcto (firma + HWID + no expirado)', () => {
  const token = sign({ v: 1, typ: 'license', key: 'BGA-TEST', hwid, plan: 'PRO', iat: now, exp: now + 3600 });
  const payload = licenseUtil.verifyToken(token, PUBLIC_KEY);
  assert.ok(payload, 'token válido');
  assert.strictEqual(payload.typ, 'license');
});

test('cliente rechaza token con HWID de otro equipo', () => {
  const token = sign({ v: 1, typ: 'license', hwid: 'OTRO-EQUIPO', plan: 'PRO', iat: now, exp: now + 3600 });
  assert.strictEqual(licenseUtil.verifyToken(token, PUBLIC_KEY), null);
});

test('cliente rechaza token expirado', () => {
  const token = sign({ v: 1, typ: 'license', hwid, plan: 'PRO', iat: now - 7200, exp: now - 3600 });
  assert.strictEqual(licenseUtil.verifyToken(token, PUBLIC_KEY), null);
});

test('cliente rechaza token con firma manipulada', () => {
  const token = sign({ v: 1, typ: 'license', hwid, plan: 'PRO', iat: now, exp: now + 3600 });
  const tampered = token.slice(0, -4) + 'AAAA';
  assert.strictEqual(licenseUtil.verifyToken(tampered, PUBLIC_KEY), null);
});

test('cliente rechaza payload alterado (firma no coincide)', () => {
  const [body, sig] = sign({ v: 1, typ: 'trial', hwid, plan: 'TRIAL', iat: now, exp: now + 3600 }).split('.');
  const evil = b64url(JSON.stringify({ v: 1, typ: 'license', hwid, plan: 'PRO', iat: now, exp: now + 999999 }));
  assert.strictEqual(licenseUtil.verifyToken(`${evil}.${sig}`, PUBLIC_KEY), null);
});
