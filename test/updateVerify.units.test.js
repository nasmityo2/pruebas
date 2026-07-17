// Pruebas de la verificación de actualizaciones firmadas (Fase 12, anti-RCE).
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const uv = require('../src/security/updateVerify');
const { getEphemeralSigningKeys } = require('./helpers/signingKeys');

const { privateKey: PRIVATE_KEY, publicKey: PUBLIC_KEY } = getEphemeralSigningKeys();

function signBuf(buf) {
  return crypto.sign('RSA-SHA256', buf, PRIVATE_KEY).toString('base64');
}

test('verifyUpdateFile: binario correcto (hash + firma) se acepta', () => {
  const fileBuffer = Buffer.from('contenido-del-instalador-v2', 'utf8');
  const expectedSha256 = uv.sha256Hex(fileBuffer);
  const signatureB64 = signBuf(fileBuffer);
  const r = uv.verifyUpdateFile({ fileBuffer, expectedSha256, signatureB64, publicKey: PUBLIC_KEY });
  assert.strictEqual(r.ok, true);
});

test('verifyUpdateFile: binario manipulado (hash no coincide) se rechaza', () => {
  const fileBuffer = Buffer.from('instalador-legitimo', 'utf8');
  const signatureB64 = signBuf(fileBuffer);
  const expectedSha256 = uv.sha256Hex(fileBuffer);
  const tampered = Buffer.from('instalador-con-malware', 'utf8');
  const r = uv.verifyUpdateFile({ fileBuffer: tampered, expectedSha256, signatureB64, publicKey: PUBLIC_KEY });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /hash/);
});

test('verifyUpdateFile: firma inválida (otra clave) se rechaza', () => {
  const fileBuffer = Buffer.from('instalador', 'utf8');
  const expectedSha256 = uv.sha256Hex(fileBuffer);
  // Firmar con una clave distinta (atacante).
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const evilSig = crypto.sign('RSA-SHA256', fileBuffer, privateKey).toString('base64');
  const r = uv.verifyUpdateFile({ fileBuffer, expectedSha256, signatureB64: evilSig, publicKey: PUBLIC_KEY });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /firma/);
});

test('verifyUpdateFile: sin firma o sin hash se rechaza', () => {
  const fileBuffer = Buffer.from('x', 'utf8');
  assert.strictEqual(uv.verifyUpdateFile({ fileBuffer, expectedSha256: 'abc', publicKey: PUBLIC_KEY }).ok, false);
  assert.strictEqual(uv.verifyUpdateFile({ fileBuffer, signatureB64: 'zzz', publicKey: PUBLIC_KEY }).ok, false);
});
