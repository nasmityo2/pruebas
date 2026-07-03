// src/security/updateVerify.js
// Fase 12 — Verificación de actualizaciones firmadas (anti-RCE).
// Un binario de actualización SOLO se ejecuta si su hash coincide con el publicado por el
// dueño Y su firma RSA (con la clave privada del servidor) valida contra la clave pública
// embebida. Sin firma válida => no se ejecuta. Módulo puro/testeable.
const crypto = require('crypto');

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Verifica la firma RSA-SHA256 sobre los bytes del binario.
 * @param {Buffer} dataBuffer
 * @param {string} signatureB64 - firma en base64 (crypto.sign('RSA-SHA256', ...))
 * @param {string} publicKey    - PEM
 * @returns {boolean}
 */
function verifySignature(dataBuffer, signatureB64, publicKey) {
  try {
    if (!dataBuffer || !signatureB64 || !publicKey) return false;
    return crypto.verify('RSA-SHA256', dataBuffer, publicKey, Buffer.from(String(signatureB64), 'base64'));
  } catch (_) {
    return false;
  }
}

/**
 * Verificación completa de un artefacto de actualización: hash esperado + firma válida.
 * @param {Object} p
 * @param {Buffer} p.fileBuffer      - contenido del .exe descargado
 * @param {string} p.expectedSha256  - hash hex publicado por el dueño
 * @param {string} p.signatureB64    - firma del binario
 * @param {string} p.publicKey       - clave pública embebida
 * @returns {{ok: boolean, reason?: string}}
 */
function verifyUpdateFile({ fileBuffer, expectedSha256, signatureB64, publicKey }) {
  if (!fileBuffer || !fileBuffer.length) return { ok: false, reason: 'archivo vacío' };
  if (!expectedSha256) return { ok: false, reason: 'falta hash esperado' };
  if (!signatureB64) return { ok: false, reason: 'falta firma' };
  if (!publicKey) return { ok: false, reason: 'falta clave pública' };

  const actual = sha256Hex(fileBuffer);
  if (actual.toLowerCase() !== String(expectedSha256).toLowerCase()) {
    return { ok: false, reason: 'hash no coincide' };
  }
  if (!verifySignature(fileBuffer, signatureB64, publicKey)) {
    return { ok: false, reason: 'firma inválida' };
  }
  return { ok: true };
}

module.exports = { sha256Hex, verifySignature, verifyUpdateFile };
