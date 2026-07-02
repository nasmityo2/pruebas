// src/utils/accessGate.js
// Lógica PURA de control de acceso (LAN + gate de licencia), sin dependencias de Fastify,
// para poder probarla de forma aislada. server.js la usa desde el hook onRequest.

// Rutas que SOLO puede invocar la máquina local (nunca un dispositivo LAN/móvil),
// aunque presente un token de conexión válido.
const LOCALHOST_ONLY_PREFIXES = [
  '/api/utils/download-update',
  '/api/utils/execute-update',
  '/api/utils/configure-firewall',
  '/api/utils/lan-enable',
  '/api/backup',
];

// Cuando NO hay licencia válida, solo se permiten estos recursos (activación + assets).
const ALLOWED_PREFIXES_WHEN_UNLICENSED = ['/css/', '/js/', '/images/', '/uploads/', '/fonts/', '/api/license'];
const ALLOWED_EXACT_WHEN_UNLICENSED = new Set(['/activacion.html', '/favicon.ico', '/images/favicon.ico']);

function isLocalhostOnly(pathname) {
  return LOCALHOST_ONLY_PREFIXES.some(p => pathname.startsWith(p));
}
function isAllowedWhenUnlicensed(pathname) {
  if (ALLOWED_EXACT_WHEN_UNLICENSED.has(pathname)) return true;
  return ALLOWED_PREFIXES_WHEN_UNLICENSED.some(p => pathname.startsWith(p));
}

/**
 * Decide qué hacer con una petición.
 * @param {Object} ctx
 * @param {boolean} ctx.isLocal        - la petición viene de loopback (equipo principal)
 * @param {string}  ctx.pathname       - ruta sin query
 * @param {boolean} ctx.lanEnabled     - modo LAN activado
 * @param {boolean} ctx.tokenValidCookie - cookie lanToken válida
 * @param {boolean} ctx.tokenValidQuery  - query ?lt válido
 * @param {string}  [ctx.lanToken]     - token a fijar en cookie si viene por query
 * @param {boolean} ctx.licensed       - hay licencia/trial válido
 * @returns {Object} decisión: { type: 'continue'|'deny'|'redirect', code?, body?, html?, location?, setCookie? }
 */
function decideAccess(ctx) {
  const { isLocal, pathname, lanEnabled, tokenValidCookie, tokenValidQuery, licensed, lanToken } = ctx;
  const isApi = pathname.startsWith('/api/');
  let setCookie = null;

  // 1) Control de acceso remoto (LAN/móvil)
  if (!isLocal) {
    if (!lanEnabled) {
      return { type: 'deny', code: 403, body: { error: 'Acceso remoto desactivado.' } };
    }
    if (isLocalhostOnly(pathname)) {
      return { type: 'deny', code: 403, body: { error: 'Operación permitida solo desde el equipo principal.' } };
    }
    if (tokenValidCookie) {
      // conexión ya autorizada
    } else if (tokenValidQuery) {
      setCookie = lanToken;
      if (!isApi) {
        // Fijar cookie y limpiar el token de la URL.
        return { type: 'redirect', location: pathname, setCookie };
      }
      // API con token en query: fijamos cookie y seguimos evaluando la licencia.
    } else {
      if (isApi) {
        return { type: 'deny', code: 401, body: { error: 'Token de conexión requerido o expirado.' } };
      }
      return {
        type: 'deny', code: 401,
        html: '<h2 style="font-family:sans-serif;text-align:center;margin-top:3rem">Conexión no autorizada</h2><p style="text-align:center">Vuelve a escanear el código QR desde la app en el equipo principal.</p>',
      };
    }
  }

  // 2) Gate de licencia (aplica a local y remoto)
  if (!licensed && !isAllowedWhenUnlicensed(pathname)) {
    if (isApi) {
      return { type: 'deny', code: 403, body: { error: 'Licencia requerida', licenseRequired: true }, setCookie };
    }
    return { type: 'redirect', location: '/activacion.html', setCookie };
  }

  return { type: 'continue', setCookie };
}

module.exports = {
  decideAccess,
  isLocalhostOnly,
  isAllowedWhenUnlicensed,
  LOCALHOST_ONLY_PREFIXES,
};
