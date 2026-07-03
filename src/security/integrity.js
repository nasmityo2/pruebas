// src/security/integrity.js
// Fase 11.8 — Self-check de integridad en runtime.
// En el BUILD se genera un manifiesto firmado con el SHA-256 de los archivos críticos
// (ver scripts/gen-integrity-manifest.js). Al iniciar (SOLO en producción), la app
// recalcula los hashes y los compara con el manifiesto, cuya firma valida con la clave
// pública embebida. Si algo no cuadra (archivo manipulado o firma inválida) → la app se
// bloquea. En Win7/ia32, este self-check propio es la garantía de integridad portable
// (los fuses de asar-integrity pueden no estar soportados — ver notas de compatibilidad).
//
// Las funciones de verificación son puras/testeables; el hashing de archivos hace I/O.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MANIFEST_NAME = 'integrity-manifest.json';

function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hashFile(filePath) {
  return hashBuffer(fs.readFileSync(filePath));
}

/**
 * Construye el objeto manifiesto (sin firmar) a partir de una lista de archivos.
 * @param {string} baseDir
 * @param {string[]} relFiles - rutas relativas a baseDir
 * @returns {{version:number, files:Object<string,string>}}
 */
function buildManifest(baseDir, relFiles) {
  const files = {};
  for (const rel of relFiles) {
    const abs = path.join(baseDir, rel);
    files[rel.replace(/\\/g, '/')] = hashFile(abs);
  }
  return { version: 1, files };
}

/**
 * Verifica la firma RSA-SHA256 del manifiesto (canonicalizado como JSON estable).
 * @returns {boolean}
 */
function verifyManifestSignature(manifest, signatureB64, publicKey) {
  try {
    if (!manifest || !signatureB64 || !publicKey) return false;
    const data = Buffer.from(canonical(manifest), 'utf8');
    return crypto.verify('RSA-SHA256', data, publicKey, Buffer.from(String(signatureB64), 'base64'));
  } catch (_) {
    return false;
  }
}

// JSON canónico (claves de `files` ordenadas) para que firma/verificación coincidan.
function canonical(manifest) {
  const files = manifest.files || {};
  const ordered = {};
  for (const k of Object.keys(files).sort()) ordered[k] = files[k];
  return JSON.stringify({ version: manifest.version || 1, files: ordered });
}

/**
 * Compara los hashes del manifiesto contra los archivos reales en disco.
 * @returns {string[]} lista de rutas que no coinciden o faltan (vacío = todo OK)
 */
function findMismatches(manifest, baseDir) {
  const mismatches = [];
  const files = (manifest && manifest.files) || {};
  for (const rel of Object.keys(files)) {
    const abs = path.join(baseDir, rel);
    try {
      if (!fs.existsSync(abs) || hashFile(abs) !== files[rel]) mismatches.push(rel);
    } catch (_) {
      mismatches.push(rel);
    }
  }
  return mismatches;
}

/**
 * Self-check completo (para el arranque en producción).
 * @returns {{ok:boolean, reason?:string, mismatches?:string[]}}
 */
function runSelfCheck({ baseDir, publicKey }) {
  try {
    const manifestPath = path.join(baseDir, MANIFEST_NAME);
    const sigPath = manifestPath + '.sig';
    if (!fs.existsSync(manifestPath) || !fs.existsSync(sigPath)) {
      return { ok: false, reason: 'manifiesto de integridad ausente' };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const signatureB64 = fs.readFileSync(sigPath, 'utf8').trim();
    if (!verifyManifestSignature(manifest, signatureB64, publicKey)) {
      return { ok: false, reason: 'firma del manifiesto inválida' };
    }
    const mismatches = findMismatches(manifest, baseDir);
    if (mismatches.length) return { ok: false, reason: 'archivos manipulados', mismatches };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = {
  MANIFEST_NAME,
  hashBuffer,
  hashFile,
  buildManifest,
  canonical,
  verifyManifestSignature,
  findMismatches,
  runSelfCheck,
};
