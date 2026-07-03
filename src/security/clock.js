// src/security/clock.js
// Fase 11.1 + 11.2 — Lógica PURA de anti-rollback del reloj del sistema.
// Aislada aquí (carpeta src/security/) para poder probarla y, en la Fase 13,
// compilar/ofuscar selectivamente. Sin dependencias de Electron ni de estado global,
// para que sea 100% testeable. La INTEGRACIÓN en la caché de licencia (persistir
// lastSeenEpoch en lic.dat + registro de Windows) se hace en la capa que consume esto.

// Tolerancia por husos horarios / ajustes legítimos del reloj (24h por defecto).
const DEFAULT_TOLERANCE_SEC = 24 * 3600;

/**
 * Detecta si el reloj del sistema fue atrasado de forma sospechosa.
 * @param {Object} p
 * @param {number} p.now            - epoch en segundos "ahora" (Date.now()/1000)
 * @param {number} [p.lastSeenEpoch]- mayor epoch visto y persistido (arranques/heartbeats)
 * @param {number} [p.toleranceSec] - tolerancia permitida hacia atrás
 * @returns {boolean} true si se detecta rollback (now < lastSeen - tolerancia)
 */
function isClockRolledBack({ now, lastSeenEpoch = 0, toleranceSec = DEFAULT_TOLERANCE_SEC }) {
  if (!Number.isFinite(now)) return false;
  const last = Number.isFinite(lastSeenEpoch) ? lastSeenEpoch : 0;
  return now < last - toleranceSec;
}

/**
 * Calcula el nuevo lastSeenEpoch a persistir: nunca retrocede (monótono).
 * Toma el máximo entre el valor previo y "ahora".
 */
function nextLastSeen({ now, lastSeenEpoch = 0 }) {
  const last = Number.isFinite(lastSeenEpoch) ? lastSeenEpoch : 0;
  if (!Number.isFinite(now)) return last;
  return Math.max(last, now);
}

/**
 * Combina varias fuentes persistidas de lastSeen (p. ej. archivo + registro de Windows)
 * y devuelve el máximo, para que borrar una fuente no resetee el anti-rollback.
 */
function maxLastSeen(...values) {
  return values.reduce((acc, v) => (Number.isFinite(v) && v > acc ? v : acc), 0);
}

module.exports = {
  DEFAULT_TOLERANCE_SEC,
  isClockRolledBack,
  nextLastSeen,
  maxLastSeen,
};
