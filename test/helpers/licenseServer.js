// test/helpers/licenseServer.js
// Arranca el servidor de licencias real en un proceso hijo, aislado (DATA_DIR temporal),
// para pruebas de integración. Las llaves son efímeras y nunca se escriben en el repo.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { getEphemeralSigningKeys } = require('./signingKeys');

const SERVER_DIR = path.join(__dirname, '..', '..', 'stokko-license-server');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function startLicenseServer() {
  const port = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgatest-'));
  const adminUser = 'testadmin';
  const adminPass = 'test-password-123';
  const { privateKey, publicKey: generatedPublicKey } = getEphemeralSigningKeys();
  fs.writeFileSync(path.join(dataDir, 'private.key'), privateKey, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'public.key'), generatedPublicKey, { mode: 0o644 });

  const env = {
    ...process.env,
    DATA_DIR: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    SECRET_KEY: 'test-secret-key-para-jwt-1234567890',
    SHARED_API_KEY: 'test-shared-api-key-unused',
    ADMIN_USERNAME: adminUser,
    ADMIN_PASSWORD: adminPass,
    NODE_NO_WARNINGS: '1',
  };

  const child = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env });

  const baseUrl = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('Timeout arrancando stokko-license-server')), 15000);
    let out = '';
    const onData = (d) => {
      out += d.toString();
      if (/escuchando/i.test(out)) { clearTimeout(to); child.stdout.off('data', onData); resolve(); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('exit', (code) => { clearTimeout(to); reject(new Error('stokko-license-server salió (code ' + code + '):\n' + out)); });
  });

  const publicKey = fs.readFileSync(
    fs.existsSync(path.join(SERVER_DIR, 'public.key')) ? path.join(SERVER_DIR, 'public.key') : path.join(dataDir, 'public.key'),
    'utf8'
  );

  return {
    baseUrl, adminUser, adminPass, publicKey, dataDir,
    stop() {
      try { child.kill(); } catch (_) {}
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
    },
  };
}

async function api(baseUrl, pathname, { method = 'GET', body, token } = {}) {
  const res = await fetch(baseUrl + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  return { status: res.status, data };
}

module.exports = { startLicenseServer, api };
