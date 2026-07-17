#!/usr/bin/env node
// scripts/gen-integrity-manifest.js
// Fase 11.8 / 13.4 — Genera el manifiesto de integridad firmado que consume el self-check
// en runtime (src/security/integrity.js). Se corre como paso del BUILD (release), NO en
// desarrollo. Hashea los archivos críticos y firma el manifiesto con la clave privada.
//
// Uso:
//   node scripts/gen-integrity-manifest.js [baseDir] <ruta-private.key>
// La ruta también puede inyectarse con STOKKO_INTEGRITY_PRIVATE_KEY.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const integrity = require('../src/security/integrity');

const baseDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..');
const keyPath = process.argv[3] || process.env.STOKKO_INTEGRITY_PRIVATE_KEY;

if (!keyPath || !fs.existsSync(keyPath)) {
  console.error('[ERROR] Falta una clave privada externa para firmar el manifiesto.');
  process.exit(1);
}

// Archivos críticos a proteger (código sensible + entradas principales).
const CRITICAL = [
  'main.js',
  'preload.js',
  'server.js',
  'src/utils/license.js',
  'src/security/clock.js',
  'src/security/token.js',
  'src/security/offline.js',
  'src/security/hwid.js',
  'src/security/updateVerify.js',
  'src/security/resourceCrypto.js',
  'src/security/integrity.js',
].filter((rel) => fs.existsSync(path.join(baseDir, rel)));

const manifest = integrity.buildManifest(baseDir, CRITICAL);
const privateKey = fs.readFileSync(keyPath, 'utf8');
const signature = crypto.sign('RSA-SHA256', Buffer.from(integrity.canonical(manifest), 'utf8'), privateKey).toString('base64');

const manifestPath = path.join(baseDir, integrity.MANIFEST_NAME);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
fs.writeFileSync(manifestPath + '.sig', signature);

console.log(`[OK] Manifiesto de integridad escrito: ${manifestPath} (${CRITICAL.length} archivos)`);
console.log(`[OK] Firma: ${manifestPath}.sig`);
