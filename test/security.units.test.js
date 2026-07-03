// Pruebas unitarias de módulos de seguridad puros (Fase 9) — sin DB nativa.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { decideAccess } = require('../src/utils/accessGate');
const network = require('../src/utils/network');
const adminUnlock = require('../src/utils/adminUnlock');
const authUtil = require('../src/utils/auth');
const localBackup = require('../src/utils/localBackup');

// ---------- Access gate (bloqueo total + LAN) ----------
test('gate: local licenciado permite módulos', () => {
  assert.strictEqual(decideAccess({ isLocal: true, pathname: '/inventario.html', lanEnabled: false, licensed: true }).type, 'continue');
});
test('gate: local sin licencia redirige a activación', () => {
  assert.strictEqual(decideAccess({ isLocal: true, pathname: '/inventario.html', lanEnabled: false, licensed: false }).type, 'redirect');
});
test('gate: local sin licencia bloquea API de negocio (403)', () => {
  const d = decideAccess({ isLocal: true, pathname: '/api/products', lanEnabled: false, licensed: false });
  assert.strictEqual(d.type, 'deny');
  assert.strictEqual(d.code, 403);
});
test('gate: /api/license permitido sin licencia (recuperación)', () => {
  assert.strictEqual(decideAccess({ isLocal: true, pathname: '/api/license/info', lanEnabled: false, licensed: false }).type, 'continue');
});
test('gate: remoto con LAN apagado se rechaza (403)', () => {
  assert.strictEqual(decideAccess({ isLocal: false, pathname: '/inventario.html', lanEnabled: false, licensed: true }).code, 403);
});
test('gate: remoto con LAN y sin token exige token (401)', () => {
  assert.strictEqual(decideAccess({ isLocal: false, pathname: '/inventario.html', lanEnabled: true, licensed: true, tokenValidCookie: false, tokenValidQuery: false }).code, 401);
});
test('gate: remoto con cookie válida y licenciado continúa', () => {
  assert.strictEqual(decideAccess({ isLocal: false, pathname: '/inventario.html', lanEnabled: true, licensed: true, tokenValidCookie: true }).type, 'continue');
});
test('gate: remoto no puede tocar rutas solo-locales aunque tenga token', () => {
  const d = decideAccess({ isLocal: false, pathname: '/api/backup/local/create', lanEnabled: true, licensed: true, tokenValidCookie: true });
  assert.strictEqual(d.type, 'deny');
  assert.strictEqual(d.code, 403);
});

// ---------- LAN tokens ----------
test('LAN token: se crea y verifica; basura no valida', () => {
  const { token } = network.createLanToken();
  assert.ok(network.verifyLanToken(token));
  assert.ok(!network.verifyLanToken('no-existe'));
});
test('LAN: detección de loopback', () => {
  assert.ok(network.isLoopbackAddress('127.0.0.1'));
  assert.ok(network.isLoopbackAddress('::1'));
  assert.ok(!network.isLoopbackAddress('192.168.1.20'));
});

// ---------- Admin unlock ----------
test('adminUnlock: emitir/verificar + extraer de cookie', () => {
  const { token } = adminUnlock.issueUnlock();
  assert.ok(adminUnlock.verifyUnlock(token));
  assert.strictEqual(adminUnlock.tokenFromReq({ headers: { cookie: `x=1; adminUnlock=${token}` } }), token);
  assert.strictEqual(adminUnlock.operatorFromReq({ headers: { 'x-operator': 'Ana' } }), 'Ana');
  assert.strictEqual(adminUnlock.operatorFromReq({ headers: {} }), 'sistema');
});

// ---------- Anti fuerza-bruta del desbloqueo admin (A.3) ----------
test('adminUnlock: bloquea la IP tras MAX_FAILS intentos y se resetea al acertar', () => {
  const ip = '10.0.0.99';
  adminUnlock.resetFailures(ip);
  assert.ok(!adminUnlock.isLockedOut(ip));
  for (let i = 0; i < adminUnlock.ADMIN_UNLOCK_MAX_FAILS; i++) adminUnlock.recordFailure(ip);
  assert.ok(adminUnlock.isLockedOut(ip), 'debe quedar bloqueada tras el máximo de fallos');
  adminUnlock.resetFailures(ip);
  assert.ok(!adminUnlock.isLockedOut(ip), 'un acierto/limpieza resetea el bloqueo');
});

// ---------- Hash admin (bcrypt) ----------
test('auth: hashPassword produce bcrypt y compara bien', () => {
  const h = authUtil.hashPassword('clave-super-1');
  assert.ok(authUtil.isBcryptHash(h));
  const bcrypt = require('bcryptjs');
  assert.ok(bcrypt.compareSync('clave-super-1', h));
  assert.ok(!bcrypt.compareSync('otra', h));
});
test('auth: hash HMAC antiguo se detecta como legacy (no bcrypt)', () => {
  assert.ok(!authUtil.isBcryptHash('a'.repeat(64)));
});

// ---------- Backups locales cifrados ----------
test('backup: cifra token de nube en reposo y lo recupera', () => {
  const enc = localBackup.encryptSecretAtRest('token-123');
  assert.ok(enc.startsWith('enc:'));
  assert.strictEqual(localBackup.decryptSecretAtRest(enc), 'token-123');
  assert.strictEqual(localBackup.decryptSecretAtRest('claro'), 'claro');
});
test('backup: crea respaldo cifrado y descifra a SQLite válido', () => {
  const info = localBackup.createLocalBackup('test');
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const { getDataBasePath } = require('../src/utils/settings');
    const p = path.join(getDataBasePath(), 'backups', 'local', info.file);
    const buf = fs.readFileSync(p);
    const key = localBackup.getBackupKey();
    const MAGIC = Buffer.from('BGAB1\n');
    const iv = buf.subarray(MAGIC.length, MAGIC.length + 12);
    const tag = buf.subarray(MAGIC.length + 12, MAGIC.length + 28);
    const data = buf.subarray(MAGIC.length + 28);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    const plain = Buffer.concat([d.update(data), d.final()]);
    assert.strictEqual(plain.subarray(0, 15).toString(), 'SQLite format 3');
    fs.unlinkSync(p);
  } catch (e) {
    // Si no hay DB local (entorno CI), el test no aplica.
    if (!/Base de datos no encontrada/.test(e.message)) throw e;
  }
});
