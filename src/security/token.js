// src/security/token.js
// Fase 11.5 — Lógica PURA de anti-replay del token de licencia.
// El servidor firma cada token con `jti` (único) e `iat` (segundos epoch). El cliente
// guarda el mayor `iat` aceptado; un token con `iat` MENOR al último aceptado es un token
// viejo re-inyectado (capturado por sniffing/copia) y debe rechazarse.
// Módulo puro (sin I/O ni Electron) para poder probarlo aislado y ofuscarlo en Fase 13.

/**
 * ¿El token entrante es un replay (más viejo que el último aceptado)?
 * @param {Object} p
 * @param {number} p.incomingIat       - iat (epoch s) del token que llega
 * @param {number} [p.lastAcceptedIat] - mayor iat aceptado y persistido
 * @returns {boolean} true si debe rechazarse por replay
 */
function isReplay({ incomingIat, lastAcceptedIat = 0 }) {
  if (!Number.isFinite(incomingIat)) return true; // sin iat válido => no confiar
  const last = Number.isFinite(lastAcceptedIat) ? lastAcceptedIat : 0;
  return incomingIat < last;
}

/**
 * Nuevo mayor iat a persistir tras aceptar un token (monótono, nunca retrocede).
 */
function nextAcceptedIat({ incomingIat, lastAcceptedIat = 0 }) {
  const last = Number.isFinite(lastAcceptedIat) ? lastAcceptedIat : 0;
  if (!Number.isFinite(incomingIat)) return last;
  return Math.max(last, incomingIat);
}

module.exports = { isReplay, nextAcceptedIat };
