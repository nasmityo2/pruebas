#!/usr/bin/env node
// scripts/sign-update.js
// Fase 12 — Firma un binario de actualización con la clave PRIVADA del servidor de licencias
// e imprime el sha256 + firma que se deben publicar en /api/update/publish.
//
// Uso:
//   node scripts/sign-update.js <ruta-al-exe> [ruta-private.key]
//
// La clave privada NUNCA se commitea (gitignored). Este script se corre en la máquina del
// dueño al preparar un release. El cliente verifica sha256 + firma con la clave pública
// embebida antes de ejecutar el instalador (anti-RCE).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const file = process.argv[2];
const keyPath = process.argv[3] || path.join(__dirname, '..', 'license-server', 'private.key');

if (!file) {
  console.error('Uso: node scripts/sign-update.js <ruta-al-exe> [ruta-private.key]');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error('[ERROR] No existe el archivo:', file);
  process.exit(1);
}
if (!fs.existsSync(keyPath)) {
  console.error('[ERROR] No existe la clave privada:', keyPath);
  console.error('        Genérala con: node license-server/generate-keys.js');
  process.exit(1);
}

const buf = fs.readFileSync(file);
const privateKey = fs.readFileSync(keyPath, 'utf8');
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
const signature = crypto.sign('RSA-SHA256', buf, privateKey).toString('base64');

console.log('--- Datos para publicar la actualización (POST /api/update/publish) ---');
console.log(JSON.stringify({ sha256, signature }, null, 2));
console.log('\nsha256   :', sha256);
console.log('signature:', signature);
