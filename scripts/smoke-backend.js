#!/usr/bin/env node
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stokko-backend-smoke-'));
  process.env.APPDATA = path.join(tempRoot, 'appdata');
  process.env.PROGRAMDATA = path.join(tempRoot, 'programdata');
  process.env.NODE_ENV = 'test';
  process.env.DOTENV_CONFIG_QUIET = 'true';
  process.env.TRIAL_SECRET_KEY ||= 'stokko-smoke-trial-key-32-bytes-minimum';
  process.env.HIST_SECRET ||= 'stokko-smoke-history-key-32-bytes-minimum';
  process.env.HASH_SECRET ||= 'stokko-smoke-password-key-32-bytes-minimum';

  let backend;
  try {
    const port = await reservePort();
    backend = require('../server');
    const printHandlers = {
      getPrinters: async () => ({ ok: true, printers: [] }),
      printText: async () => ({ ok: true }),
      printHTML: async () => ({ ok: true }),
    };
    const activePort = await backend.start(port, printHandlers);
    const response = await fetch(`http://127.0.0.1:${activePort}/api/license/info`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`El endpoint de licencia respondió HTTP ${response.status}.`);
    }
    const payload = await response.json();
    if (!payload || typeof payload !== 'object') {
      throw new Error('El backend no devolvió un objeto JSON válido.');
    }
    console.log('[STOKKO_BACKEND_SMOKE_OK]');
  } finally {
    if (backend && typeof backend.stop === 'function') {
      await backend.stop();
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[STOKKO_BACKEND_SMOKE_FAILED]', error.message);
  process.exitCode = 1;
});
