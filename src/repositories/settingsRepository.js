// src/repositories/settingsRepository.js
// Capa de repositorio única para lectura de tasas/ajustes (Fase 7).
// Centraliza los SELECT de la tabla `settings` que estaban duplicados en varios controladores.
const { db } = require('../database');

const RATE_KEYS = ['BCV', 'PARALELO', 'COP', 'CALC_METHOD', 'AUTO_BCV', 'IVA_PERCENTAGE', 'IVA_MODE', 'ENABLE_CASHEA'];

const stmt = db.prepare(
  `SELECT key, value FROM settings WHERE key IN (${RATE_KEYS.map(() => '?').join(',')})`
);

// Devuelve un objeto con las tasas/ajustes tipados. CALC_METHOD como entero (default 1),
// el resto numérico (default 0). Los valores no numéricos (p.ej. IVA_MODE) quedan como estén.
function getRates() {
  const rows = stmt.all(...RATE_KEYS);
  const out = {};
  for (const row of rows) {
    if (row.key === 'CALC_METHOD') {
      const n = parseInt(row.value, 10);
      out.CALC_METHOD = Number.isNaN(n) ? 1 : n;
    } else if (row.key === 'IVA_MODE') {
      out.IVA_MODE = row.value;
    } else {
      const n = parseFloat(row.value);
      out[row.key] = Number.isNaN(n) ? 0 : n;
    }
  }
  return out;
}

module.exports = { getRates, RATE_KEYS };
