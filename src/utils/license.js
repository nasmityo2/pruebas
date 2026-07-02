// src/utils/license.js
// Modelo de licencia (Fase 2): la VERDAD vive en el servidor.
// El cliente solo guarda una caché CIFRADA y ligada al HWID de un token FIRMADO por el servidor.
// - El cliente NO puede firmar tokens (solo tiene la clave pública).
// - Copiar la caché a otro equipo no sirve: la clave de cifrado se deriva del HWID local.
// - Sin token válido (licencia o trial) => la app se bloquea (ver getAppStatus()).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { machineIdSync } = require('node-machine-id');
const { getDataBasePath } = require('./settings');
const { HIST_SECRET } = require('../config');

// Llave pública NUEVA (rotada en Fase 1). Solo verifica firmas; nunca puede firmar.
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt8Lk4fcZR2HJaymGwmtB
tugbL+Qs8UP1lNhDh1SCGBU6BJhlKaX4+WL45aFbAJ20/pGMz9l/kmAMe5/o4svI
w8oFwnfmx9l/jvy91qBTWJZ8CJsf8ciQDNJQnX+F2o3YgrB0W+OmZhJG5lAE7fvs
Ykg/pACFpg4XHzVhgNqc19SyuxVgz2DeAFMM/nXihbipZZsEwZI0VmPlWAndAP/v
8evqNs/cEZ/B1fSIdlNzpuH2yVpXuBjnIVpt6DFE7ekNXe62pUgkLsJJcVBEUIkS
9+24EiqCERdjr91grmrPY5smGu65NsZ4DlJaC3/9yTz/r1YMgCV5Om+9XVJquye1
hwIDAQAB
-----END PUBLIC KEY-----`;

// ------------------------------------------------------------------
// HWID (huella del equipo). Un único identificador canónico y estable.
// ------------------------------------------------------------------
const FALLBACK_ID_FILE = 'device.id';

function getFallbackHardwareId() {
  try {
    const filePath = path.join(getDataBasePath(), FALLBACK_ID_FILE);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8').trim();
    const newId = crypto.randomUUID();
    fs.writeFileSync(filePath, newId, 'utf8');
    return newId;
  } catch (e) {
    return 'error-fallback-id';
  }
}

let cachedHwid = null;
function getHardwareId() {
  if (cachedHwid) return cachedHwid;
  let baseId = '';
  try {
    baseId = machineIdSync({ original: true });
  } catch (e) {
    baseId = getFallbackHardwareId();
  }
  let extra = '';
  try {
    const cpus = os.cpus();
    if (cpus && cpus.length > 0) extra += cpus[0].model;
    if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        let serial = '';
        try {
          serial = execSync('powershell -NoProfile -NonInteractive -Command "(Get-WmiObject Win32_BaseBoard).SerialNumber"', { encoding: 'utf8', timeout: 5000 }).trim();
        } catch (_) {
          try {
            serial = execSync('powershell -NoProfile -NonInteractive -Command "(Get-WmiObject Win32_BIOS).SerialNumber"', { encoding: 'utf8', timeout: 5000 }).trim();
          } catch (_) { /* noop */ }
        }
        if (serial && serial !== 'To be filled by O.E.M.' && serial.length > 2) extra += serial;
      } catch (_) { /* noop */ }
    }
  } catch (_) { /* noop */ }

  cachedHwid = crypto.createHash('sha256').update(baseId + extra).digest('hex');
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
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', cacheKey(), iv);
    const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
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
  return verifyToken(cache.token);
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
};
