#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SENTINEL = '[STOKKO_ELECTRON_SMOKE_OK]';

function safeDiagnostic(value) {
  return String(value)
    .replace(/(token|secret|password|license[_-]?key)\s*[=:]\s*[^\s]+/gi, '$1=***')
    .replace(/[A-Za-z0-9_-]{80,}/g, '[REDACTED]')
    .slice(-4000);
}

async function main() {
  const electronPath = require('electron');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stokko-electron-smoke-'));
  let output = '';
  let timedOut = false;

  try {
    const child = spawn(electronPath, [ROOT], {
      cwd: ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        APPDATA: path.join(tempRoot, 'appdata'),
        PROGRAMDATA: path.join(tempRoot, 'programdata'),
        NODE_ENV: 'test',
        STOKKO_ELECTRON_SMOKE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const collect = (chunk) => {
      output = (output + chunk.toString('utf8')).slice(-64 * 1024);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
      setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 30000).unref();
    });

    if (timedOut) throw new Error('Electron no terminó el smoke en 30 segundos.');
    if (exitCode !== 0) {
      throw new Error(`Electron terminó con código ${exitCode}.\n${safeDiagnostic(output)}`);
    }
    if (!output.includes(SENTINEL)) {
      throw new Error(`Electron no emitió el centinela de arranque.\n${safeDiagnostic(output)}`);
    }
    console.log(SENTINEL);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[STOKKO_ELECTRON_SMOKE_FAILED]', error.message);
  process.exitCode = 1;
});
