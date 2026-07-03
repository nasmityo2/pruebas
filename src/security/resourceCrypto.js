// src/security/resourceCrypto.js
// Fase 11.6 — Cifrado de recursos ligado a la licencia (la defensa clave sin addon nativo).
// La clave de descifrado se deriva de: HWID + `k` (material que SOLO llega dentro del token
// firmado por el servidor al activar/verificar). Sin token válido => no hay `k` => no hay
// clave => el recurso esencial no se descifra => la app no puede operar (no queda "gratis").
//
// Este módulo son las PRIMITIVAS puras (derivación + AES-256-GCM), testeables. La selección
// del recurso esencial y su uso repartido por el flujo se integran en la capa de negocio.
const crypto = require('crypto');

const MAGIC = Buffer.from('BGRC1\n'); // cabecera de recurso cifrado

/**
 * Deriva la clave AES-256 del recurso a partir del HWID y del material `k` del token.
 * @param {string} hwid
 * @param {string} k - tokenPayload.k (solo presente en un token válido del servidor)
 * @returns {Buffer} clave de 32 bytes
 */
function deriveResourceKey(hwid, k) {
  if (!hwid || !k) throw new Error('RESOURCE_KEY_MATERIAL_MISSING');
  return crypto.createHash('sha256').update(String(hwid) + '|' + String(k)).digest();
}

function encryptResource(plaintextBuffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, enc]);
}

function decryptResource(payloadBuffer, key) {
  if (!payloadBuffer.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('RESOURCE_FORMAT_INVALID');
  }
  const iv = payloadBuffer.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = payloadBuffer.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const enc = payloadBuffer.subarray(MAGIC.length + 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

module.exports = { deriveResourceKey, encryptResource, decryptResource };
