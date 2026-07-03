// Pruebas de integración del sistema de licencias (Fase 9).
// Arranca el servidor real y valida: generación protegida, activación+HWID,
// 1 licencia = 1 equipo, revocación remota, expiración y trial.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { startLicenseServer, api } = require('./helpers/licenseServer');

let server;
before(async () => { server = await startLicenseServer(); });
after(() => { if (server) server.stop(); });

function verifySignedToken(token, publicKey) {
  const [body, sig] = token.split('.');
  const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(body), publicKey, fromB64url(sig));
  const payload = JSON.parse(fromB64url(body).toString('utf8'));
  return { ok, payload };
}

async function loginAdmin() {
  const r = await api(server.baseUrl, '/api/login', { method: 'POST', body: { username: server.adminUser, password: server.adminPass } });
  assert.strictEqual(r.status, 200);
  return r.data.token;
}

test('login admin: credenciales válidas devuelven JWT', async () => {
  const token = await loginAdmin();
  assert.ok(token && token.length > 20);
});

test('login admin: credenciales inválidas son rechazadas', async () => {
  const r = await api(server.baseUrl, '/api/login', { method: 'POST', body: { username: 'x', password: 'y' } });
  assert.strictEqual(r.status, 400);
});

test('generar licencia SIN login admin es rechazado', async () => {
  const r = await api(server.baseUrl, '/api/admin/licenses', { method: 'POST', body: { plan: 'PRO' } });
  assert.ok(r.status === 401 || r.status === 403);
});

test('activación vincula HWID y devuelve token firmado válido', async () => {
  const token = await loginAdmin();
  const created = await api(server.baseUrl, '/api/admin/licenses', { method: 'POST', token, body: { plan: 'PRO', dias: 365 } });
  assert.strictEqual(created.status, 200);
  const key = created.data.licenses[0].key;
  assert.match(key, /^BGA-/);

  const hwid = 'HWID-TEST-' + crypto.randomBytes(6).toString('hex');
  const act = await api(server.baseUrl, '/api/activate', { method: 'POST', body: { key, hwid, systemName: 'PC Prueba' } });
  assert.strictEqual(act.status, 200);
  const { ok, payload } = verifySignedToken(act.data.token, server.publicKey);
  assert.ok(ok, 'firma del token válida');
  assert.strictEqual(payload.typ, 'license');
  assert.strictEqual(payload.hwid, hwid);
});

test('1 licencia = 1 equipo: activar en otro HWID es rechazado (409)', async () => {
  const token = await loginAdmin();
  const created = await api(server.baseUrl, '/api/admin/licenses', { method: 'POST', token, body: { plan: 'PRO', dias: 365 } });
  const key = created.data.licenses[0].key;
  const first = await api(server.baseUrl, '/api/activate', { method: 'POST', body: { key, hwid: 'HWID-EQUIPO-A-000000' } });
  assert.strictEqual(first.status, 200);
  const second = await api(server.baseUrl, '/api/activate', { method: 'POST', body: { key, hwid: 'HWID-EQUIPO-B-111111' } });
  assert.strictEqual(second.status, 409);
});

test('heartbeat verify devuelve token mientras esté activa', async () => {
  const token = await loginAdmin();
  const created = await api(server.baseUrl, '/api/admin/licenses', { method: 'POST', token, body: { plan: 'PRO', dias: 365 } });
  const key = created.data.licenses[0].key;
  const hwid = 'HWID-HB-000000';
  await api(server.baseUrl, '/api/activate', { method: 'POST', body: { key, hwid } });
  const v = await api(server.baseUrl, '/api/verify', { method: 'POST', body: { key, hwid } });
  assert.strictEqual(v.status, 200);
  assert.strictEqual(v.data.status, 'activa');
  assert.ok(v.data.token);
});

test('revocación remota bloquea el verify (403 revocada)', async () => {
  const token = await loginAdmin();
  const created = await api(server.baseUrl, '/api/admin/licenses', { method: 'POST', token, body: { plan: 'PRO', dias: 365 } });
  const key = created.data.licenses[0].key;
  const hwid = 'HWID-REV-000000';
  await api(server.baseUrl, '/api/activate', { method: 'POST', body: { key, hwid } });
  const rev = await api(server.baseUrl, '/api/admin/licenses/revoke', { method: 'POST', token, body: { key } });
  assert.strictEqual(rev.status, 200);
  const v = await api(server.baseUrl, '/api/verify', { method: 'POST', body: { key, hwid } });
  assert.strictEqual(v.status, 403);
  assert.strictEqual(v.data.status, 'revocada');
});

test('licencia expirada no activa (403 expirada)', async () => {
  const token = await loginAdmin();
  const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const created = await api(server.baseUrl, '/api/admin/licenses', { method: 'POST', token, body: { plan: 'PRO', fechaExpiracion: past } });
  const key = created.data.licenses[0].key;
  const act = await api(server.baseUrl, '/api/activate', { method: 'POST', body: { key, hwid: 'HWID-EXP-000000' } });
  assert.strictEqual(act.status, 403);
  assert.strictEqual(act.data.status, 'expirada');
});

test('clave inexistente es rechazada (404 desconocida)', async () => {
  const act = await api(server.baseUrl, '/api/activate', { method: 'POST', body: { key: 'BGA-XXXXX-XXXXX-XXXXX-XXXXX', hwid: 'HWID-NA-000000' } });
  assert.strictEqual(act.status, 404);
});

test('trial firmado y ligado a HWID', async () => {
  const hwid = 'HWID-TRIAL-' + crypto.randomBytes(4).toString('hex');
  const r = await api(server.baseUrl, '/api/trial', { method: 'POST', body: { hwid, systemName: 'Prueba' } });
  assert.strictEqual(r.status, 200);
  const { ok, payload } = verifySignedToken(r.data.token, server.publicKey);
  assert.ok(ok);
  assert.strictEqual(payload.typ, 'trial');
  assert.strictEqual(payload.hwid, hwid);
});

// ---- Fase 14: anti-bypass por clave de prototipo (__proto__) ----
test('Fase 14: activar con key "__proto__" NO emite token (404)', async () => {
  const act = await api(server.baseUrl, '/api/activate', { method: 'POST', body: { key: '__proto__', hwid: 'HWID-PWN-000000' } });
  assert.strictEqual(act.status, 404);
  assert.ok(!act.data.token, 'no debe entregar token');
});

test('Fase 14: activar con key "constructor" NO emite token (404)', async () => {
  const act = await api(server.baseUrl, '/api/activate', { method: 'POST', body: { key: 'constructor', hwid: 'HWID-PWN-000001' } });
  assert.strictEqual(act.status, 404);
  assert.ok(!act.data.token);
});

test('Fase 14: verify con key "__proto__" es rechazado (404)', async () => {
  const v = await api(server.baseUrl, '/api/verify', { method: 'POST', body: { key: '__proto__', hwid: 'HWID-PWN-000002' } });
  assert.strictEqual(v.status, 404);
  assert.ok(!v.data.token);
});

test('Fase 14: trial con hwid "__proto__" es rechazado', async () => {
  const r = await api(server.baseUrl, '/api/trial', { method: 'POST', body: { hwid: '__proto__' } });
  assert.ok(r.status === 400 || r.status === 403);
  assert.ok(!r.data || !r.data.token);
});

test('Fase 2 refuerzo: el token de licencia incluye jti (anti-replay) y k (material de clave)', async () => {
  const token = await loginAdmin();
  const created = await api(server.baseUrl, '/api/admin/licenses', { method: 'POST', token, body: { plan: 'PRO', dias: 365 } });
  const key = created.data.licenses[0].key;
  const hwid = 'HWID-JTIK-000000';
  const act = await api(server.baseUrl, '/api/activate', { method: 'POST', body: { key, hwid } });
  assert.strictEqual(act.status, 200);
  const { ok, payload } = verifySignedToken(act.data.token, server.publicKey);
  assert.ok(ok, 'firma válida');
  assert.ok(payload.jti && payload.jti.length > 10, 'incluye jti único');
  assert.ok(payload.k && payload.k.length >= 32, 'incluye material de clave k');
  // Un segundo verify emite un jti DISTINTO (no reutilizable).
  const v = await api(server.baseUrl, '/api/verify', { method: 'POST', body: { key, hwid } });
  const p2 = verifySignedToken(v.data.token, server.publicKey).payload;
  assert.notStrictEqual(p2.jti, payload.jti, 'jti cambia entre emisiones');
  assert.strictEqual(p2.k, payload.k, 'k es estable por licencia');
});

test('Fase 14: verify de licencia pendiente (nunca activada) no reemite token', async () => {
  const token = await loginAdmin();
  const created = await api(server.baseUrl, '/api/admin/licenses', { method: 'POST', token, body: { plan: 'PRO', dias: 365 } });
  const key = created.data.licenses[0].key;
  // Sin activar: estado 'pendiente', hwid null.
  const v = await api(server.baseUrl, '/api/verify', { method: 'POST', body: { key, hwid: 'HWID-PENDIENTE-0000' } });
  assert.notStrictEqual(v.status, 200);
  assert.ok(!v.data.token);
});
