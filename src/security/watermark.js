// src/security/watermark.js
// Fase 11.7 — Watermarking por licencia (trazabilidad de fugas).
// Deriva un identificador discreto y estable a partir de la clave de licencia, para
// incrustarlo en artefactos generados (p. ej. un código en PDFs de ticket/reportes).
// Ante una copia filtrada, el dueño mapea el watermark -> licencia/cliente y la revoca.
// Función pura y determinista (misma licencia => mismo watermark).
const crypto = require('crypto');

/**
 * Watermark corto (por defecto 8 hex) derivado de la clave de licencia.
 * @param {string} licenseKey
 * @param {number} [len] - longitud del código (chars hex)
 * @returns {string} código en mayúsculas, o '' si no hay clave
 */
function licenseWatermark(licenseKey, len = 8) {
  if (!licenseKey) return '';
  const h = crypto.createHash('sha256').update('BGA-WM|' + String(licenseKey)).digest('hex');
  return h.slice(0, Math.max(4, Math.min(len, 32))).toUpperCase();
}

module.exports = { licenseWatermark };
