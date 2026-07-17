#!/usr/bin/env node
/**
 * Genera un par de llaves RSA nuevo para firmar licencias.
 *
 * - La PRIVADA se escribe en stokko-license-server/private.key (gitignored). NUNCA se commitea.
 * - La PÚBLICA se imprime por consola y debe embeberse en:
 *     - stokko-license-server/server.js  (PUBLIC_KEY, para verificar)
 *     - src/utils/license.js       (PUBLIC_KEY del cliente)
 *
 * Uso:
 *   node stokko-license-server/generate-keys.js            (no sobrescribe si ya existe)
 *   node stokko-license-server/generate-keys.js --force     (rota: sobrescribe la privada)
 *
 * Tras rotar, todas las licencias firmadas con la llave anterior quedan inválidas
 * (esperado: no hay clientes reales todavía).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRIVATE_KEY_PATH = path.join(__dirname, 'private.key');
const PUBLIC_KEY_PATH = path.join(__dirname, 'public.key');
const force = process.argv.includes('--force');

if (fs.existsSync(PRIVATE_KEY_PATH) && !force) {
  console.error('[ABORT] Ya existe private.key. Usa --force para rotarla (invalidará licencias previas).');
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
fs.writeFileSync(PUBLIC_KEY_PATH, publicKey);

console.log('[OK] Nueva llave privada escrita en:', PRIVATE_KEY_PATH, '(gitignored)');
console.log('[OK] Nueva llave pública escrita en:', PUBLIC_KEY_PATH, '(gitignored)');
console.log('\n--- COPIA ESTA LLAVE PÚBLICA EN server.js y src/utils/license.js ---\n');
console.log(publicKey);
