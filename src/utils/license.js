// src/utils/license.js
// Modelo de licencia (Fase 2): la VERDAD vive en el servidor.
// El cliente solo guarda una caché CIFRADA y ligada al HWID de un token FIRMADO por el servidor.
// - El cliente NO puede firmar tokens (solo tiene la clave pública).
// - Copiar la caché a otro equipo no sirve: la clave de cifrado se deriva del HWID local.
// - Sin token válido (licencia o trial) => la app se bloquea (ver getAppStatus()).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDataBasePath } = require('./settings');
const { HIST_SECRET } = require('../config');
const clock = require('../security/clock');
const replay = require('../security/token');
const offline = require('../security/offline');
const hwidModule = require('../security/hwid');

// Llave pública NUEVA (rotada en Fase 1). Solo verifica firmas; nunca puede firmar.
// Fase 11.4 (🟡 obfuscation-safe): NO se deja como bloque PEM literal evidente; se guarda
// codificada (base64) y se reconstruye en runtime. No es secreto (es pública), pero
// dificulta el análisis/parcheo automatizado que busca el marcador "BEGIN PUBLIC KEY".
const _pkEnc = 'LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUF0UFJtZmZmWnlmdnNsQUZuVUN5WQpNbjEra0dWMTROL0xpMW1YLzJtY2FzaG9ObnY4MHdSTTNyZFhRRUg3TGk4R3RZSGdudmIxMTMwd3hJb2pNelNwCkhYbFA5QTd3NEE4czgyS0hpOFVKK3BGQStTVjR2dzRZSHF6OEg2SXdDSXlMaGFuOTRuVkE5VmpaWm4zb20rQnMKcUliZU44NTFLOXI3RDdqZHJ4eVRRUjUrZHQ0bjNHZFUvM3l5WXRvb3d4clMzZllMSno1ZC9tRVgwYUlteEVlWgoreXNpRVZHS1JQNGxPLzZBaFNnTUNKazhUS09CcFZpMEJNbU5Kd3R2eTdoU0VWYnh2RGZYMFQvd2VRUVJrOFhRCmVIOGJnajQvVGtnQ3p0cm9XUWV0Q2ptQTFXVkMzbzUvdmNHa21DSkZ4ZnVuREw2L0E1Y0ZuakRtQUJMTnU3cysKUXdJREFRQUIKLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==';
const PUBLIC_KEY = Buffer.from(_pkEnc, 'base64').toString('utf8');

// ------------------------------------------------------------------
// HWID (huella del equipo). Fase 11.4: múltiples señales del SO, SIN archivo portátil.
// Si no hay ninguna señal fuerte, getHardwareId devuelve null (fail-safe): el cliente
// no puede activar/validar y debe pedir activación online, en vez de fabricar un ID copiable.
// ------------------------------------------------------------------
let cachedHwid = null;
function getHardwareId() {
  if (cachedHwid) return cachedHwid;
  cachedHwid = hwidModule.computeHardwareId(); // hash hex de 64 chars, o null
  return cachedHwid;
}

// ------------------------------------------------------------------
// Verificación de tokens firmados por el servidor (RSA-SHA256)
// ------------------------------------------------------------------
function fromB64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const ok = crypto.verify('RSA-SHA256', Buffer.from(body), PUBLIC_KEY, fromB64url(sig));
    if (!ok) return null;
    const payload = JSON.parse(fromB64url(body).toString('utf8'));

    // El token debe pertenecer a ESTE equipo.
    if (payload.hwid !== getHardwareId()) return null;
    // Expiración (segundos epoch).
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ------------------------------------------------------------------
// Caché local CIFRADA (AES-256-GCM) y ligada al HWID
// ------------------------------------------------------------------
function cacheFilePath() {
  const dir = path.join(getDataBasePath(), 'uploads', '.sys');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'lic.dat');
}

function cacheKey() {
  // La clave de cifrado depende del HWID => la caché no es portable entre equipos.
  return crypto.createHash('sha256').update(getHardwareId() + '|' + HIST_SECRET).digest();
}

function saveLicenseCache(obj) {
  try {
    // Fase 11.2: sello de tiempo MONOTÓNICO. Se guarda el mayor epoch visto (arranques y
    // heartbeats exitosos). Atrasar el reloj luego NO extiende licencia/trial (ver getCachedPayload).
    const now = Math.floor(Date.now() / 1000);
    const prevCache = (() => { try { return readLicenseCache(); } catch (_) { return null; } })();
    const prevSeen = (prevCache && prevCache.lastSeenEpoch) || 0;
    const prevIat = (prevCache && prevCache.lastAcceptedIat) || 0;
    // Fase 11.5: registrar el mayor `iat` aceptado (anti-replay). El token guardado no puede
    // ser más viejo que el último aceptado.
    let tokenIat = 0;
    try { const p = verifyToken(obj.token); if (p && Number.isFinite(p.iat)) tokenIat = p.iat; } catch (_) { /* noop */ }
    const toStore = {
      ...obj,
      lastSeenEpoch: clock.nextLastSeen({ now, lastSeenEpoch: prevSeen }),
      lastAcceptedIat: replay.nextAcceptedIat({ incomingIat: tokenIat, lastAcceptedIat: prevIat }),
    };
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', cacheKey(), iv);
    const plaintext = Buffer.from(JSON.stringify(toStore), 'utf8');
    const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, tag, enc]).toString('base64');
    fs.writeFileSync(cacheFilePath(), payload, 'utf8');
    return true;
  } catch (e) {
    console.error('Error guardando caché de licencia:', e.message);
    return false;
  }
}

function readLicenseCache() {
  try {
    const p = cacheFilePath();
    if (!fs.existsSync(p)) return null;
    const raw = Buffer.from(fs.readFileSync(p, 'utf8'), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', cacheKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch (e) {
    // Caché corrupta o de otro equipo => se ignora.
    return null;
  }
}

function clearLicenseCache() {
  try {
    const p = cacheFilePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) { /* noop */ }
}

// ------------------------------------------------------------------
// Estado de la app (fuente para el bloqueo total del cliente)
// ------------------------------------------------------------------
function getCachedPayload() {
  const cache = readLicenseCache();
  if (!cache || !cache.token) return null;
  // Fase 11.2: si el reloj del sistema fue atrasado por debajo del último sello visto
  // (menos la tolerancia por husos), tratamos la caché como NO confiable y exigimos
  // re-verificación online (no se concede licencia/trial con el reloj manipulado).
  const now = Math.floor(Date.now() / 1000);
  if (clock.isClockRolledBack({ now, lastSeenEpoch: cache.lastSeenEpoch || 0 })) {
    return null;
  }
  // Fase 11.3: si pasó demasiado tiempo desde la última verificación EXITOSA contra el
  // servidor (bloqueo de red/firewall prolongado), se bloquea aunque el token no haya
  // expirado. `lastSeenEpoch` solo se actualiza tras un contacto exitoso con el servidor.
  if (offline.isOfflineGraceExceeded({ now, lastSuccessfulVerify: cache.lastSeenEpoch || 0 })) {
    return null;
  }
  const payload = verifyToken(cache.token);
  if (!payload) return null;
  // Fase 11.5: rechazar un token cacheado más viejo que el último aceptado (posible
  // re-inyección de un token capturado). El token legítimo más reciente nunca es replay.
  if (replay.isReplay({ incomingIat: payload.iat, lastAcceptedIat: cache.lastAcceptedIat || 0 })) {
    return null;
  }
  return payload;
}

function getAppStatus() {
  const payload = getCachedPayload();
  if (payload && payload.typ === 'license') {
    return { status: 'LICENSED', message: 'Licencia activa.', plan: payload.plan || 'PRO' };
  }
  if (payload && payload.typ === 'trial') {
    const hoursLeft = Math.max(0, (payload.exp - Math.floor(Date.now() / 1000)) / 3600);
    return { status: 'TRIAL', message: `Prueba activa. Quedan ${hoursLeft.toFixed(1)} horas.`, plan: 'TRIAL' };
  }
  return { status: 'EXPIRED', message: 'Se requiere activar una licencia válida.', plan: null };
}

module.exports = {
  getHardwareId,
  verifyToken,
  saveLicenseCache,
  readLicenseCache,
  clearLicenseCache,
  getAppStatus,
  // Fase 12: la misma clave pública embebida se usa para verificar la firma de updates.
  getPublicKey: () => PUBLIC_KEY,
};
