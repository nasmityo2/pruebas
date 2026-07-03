// src/security/offline.js
// Fase 11.3 — Política de bloqueo por offline prolongado (lógica pura).
// "Servidor no responde" NO es "licencia válida". Se permite operar sin conexión solo
// durante una ventana corta desde la última verificación EXITOSA contra el servidor;
// superada esa ventana, la app se bloquea aunque el token todavía no haya expirado.
// Esto impide que bloquear el tráfico al servidor (firewall/hosts) dé uso indefinido.

// Ventana de gracia offline por defecto (horas). Configurable por entorno.
const DEFAULT_GRACE_OFFLINE_HOURS = parseInt(process.env.GRACE_OFFLINE_HOURS || '72', 10);

/**
 * ¿Se superó la ventana de gracia offline desde la última verificación exitosa?
 * @param {Object} p
 * @param {number} p.now                   - epoch s "ahora"
 * @param {number} [p.lastSuccessfulVerify]- epoch s de la última verificación online OK
 * @param {number} [p.graceHours]          - ventana de gracia en horas
 * @returns {boolean} true si debe bloquearse por offline prolongado
 */
function isOfflineGraceExceeded({ now, lastSuccessfulVerify = 0, graceHours = DEFAULT_GRACE_OFFLINE_HOURS }) {
  if (!Number.isFinite(now)) return false;
  const last = Number.isFinite(lastSuccessfulVerify) ? lastSuccessfulVerify : 0;
  if (last <= 0) return false; // sin dato previo confiable, no bloquear por este criterio
  const graceSec = (Number.isFinite(graceHours) ? graceHours : DEFAULT_GRACE_OFFLINE_HOURS) * 3600;
  return (now - last) > graceSec;
}

module.exports = {
  DEFAULT_GRACE_OFFLINE_HOURS,
  isOfflineGraceExceeded,
};
