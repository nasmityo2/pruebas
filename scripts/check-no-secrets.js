#!/usr/bin/env node
// scripts/check-no-secrets.js
// Guard anti-filtraciones (Fase 10): recorre lo que SE VA A EMPAQUETAR (aplicando el mismo
// predicado de exclusión que forge) y ABORTA el build si encuentra secretos/llaves/DB/tokens.
// Uso: node scripts/check-no-secrets.js   (exit 1 si detecta algo peligroso)
const fs = require('fs');
const path = require('path');
const { shouldIgnore } = require('./packaging-ignore');

const ROOT = path.join(__dirname, '..');

// Patrones de NOMBRE de archivo prohibidos en el paquete.
const FORBIDDEN_NAME = [
  /^private\.key$/i, /^public\.key$/i, /\.key$/i, /\.pem$/i,
  /^\.env$/i, /^\.env\.(?!example).+/i,
  /\.lic$/i, /\.db$/i, /\.sqlite3?$/i,
  /^licenses\.json$/i, /^users\.json$/i, /^invites\.json$/i,
  /^activation_tokens\.json$/i, /^trials\.json$/i, /^backup\.key$/i,
];

// Patrones de CONTENIDO sospechoso (secretos hardcodeados que NO deben viajar).
const FORBIDDEN_CONTENT = [
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
  /[REMOVED-COMPROMISED-SECRET]/,
  /[REMOVED-COMPROMISED-SECRET]/,
];

const SCAN_CONTENT_EXT = new Set(['.js', '.json', '.html', '.txt', '.env', '.cfg', '.ini']);

const findings = [];

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (shouldIgnore(full, ROOT)) continue;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue; // deps: no escaneamos su contenido masivo
      walk(full);
    } else if (entry.isFile()) {
      const base = entry.name;
      if (FORBIDDEN_NAME.some(rx => rx.test(base))) {
        findings.push(`ARCHIVO PROHIBIDO: ${path.relative(ROOT, full)}`);
        continue;
      }
      const ext = path.extname(base).toLowerCase();
      if (SCAN_CONTENT_EXT.has(ext) && base !== '.env.example') {
        let content = '';
        try { content = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
        for (const rx of FORBIDDEN_CONTENT) {
          if (rx.test(content)) findings.push(`CONTENIDO SOSPECHOSO (${rx}) en: ${path.relative(ROOT, full)}`);
        }
      }
    }
  }
}

console.log('[check-no-secrets] Escaneando lo que se empaquetaría...');
walk(ROOT);

if (findings.length > 0) {
  console.error('\n❌ BUILD ABORTADO: se detectaron secretos/artefactos que NO deben empaquetarse:\n');
  for (const f of findings) console.error('   - ' + f);
  console.error('\nQuita/gitignora esos archivos o ajusta scripts/packaging-ignore.js antes de empaquetar.');
  process.exit(1);
}

console.log('✅ Sin secretos en lo que se va a empaquetar.');
process.exit(0);
