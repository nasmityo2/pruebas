// Pruebas del self-check de integridad (Fase 11.8).
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const integrity = require('../src/security/integrity');
const licenseUtil = require('../src/utils/license');

const PRIVATE_KEY = fs.readFileSync(path.join(__dirname, '..', 'license-server', 'private.key'), 'utf8');
const PUBLIC_KEY = licenseUtil.getPublicKey();

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bga-integ-'));
}
function signManifest(manifest) {
  return crypto.sign('RSA-SHA256', Buffer.from(integrity.canonical(manifest), 'utf8'), PRIVATE_KEY).toString('base64');
}

test('runSelfCheck: build íntegro y firmado pasa', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'a.js'), 'console.log(1)');
    fs.writeFileSync(path.join(dir, 'b.js'), 'console.log(2)');
    const manifest = integrity.buildManifest(dir, ['a.js', 'b.js']);
    fs.writeFileSync(path.join(dir, integrity.MANIFEST_NAME), JSON.stringify(manifest));
    fs.writeFileSync(path.join(dir, integrity.MANIFEST_NAME + '.sig'), signManifest(manifest));
    const r = integrity.runSelfCheck({ baseDir: dir, publicKey: PUBLIC_KEY });
    assert.strictEqual(r.ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runSelfCheck: archivo manipulado tras firmar se detecta', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'a.js'), 'original');
    const manifest = integrity.buildManifest(dir, ['a.js']);
    fs.writeFileSync(path.join(dir, integrity.MANIFEST_NAME), JSON.stringify(manifest));
    fs.writeFileSync(path.join(dir, integrity.MANIFEST_NAME + '.sig'), signManifest(manifest));
    // Manipular el archivo después de firmar.
    fs.writeFileSync(path.join(dir, 'a.js'), 'PARCHEADO POR ATACANTE');
    const r = integrity.runSelfCheck({ baseDir: dir, publicKey: PUBLIC_KEY });
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.mismatches, ['a.js']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runSelfCheck: firma del manifiesto de otra clave se rechaza', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'a.js'), 'x');
    const manifest = integrity.buildManifest(dir, ['a.js']);
    fs.writeFileSync(path.join(dir, integrity.MANIFEST_NAME), JSON.stringify(manifest));
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const evilSig = crypto.sign('RSA-SHA256', Buffer.from(integrity.canonical(manifest), 'utf8'), privateKey).toString('base64');
    fs.writeFileSync(path.join(dir, integrity.MANIFEST_NAME + '.sig'), evilSig);
    const r = integrity.runSelfCheck({ baseDir: dir, publicKey: PUBLIC_KEY });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /firma/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runSelfCheck: manifiesto ausente se rechaza', () => {
  const dir = tmpDir();
  try {
    const r = integrity.runSelfCheck({ baseDir: dir, publicKey: PUBLIC_KEY });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /ausente/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
