// src/utils/network.js
// Control de acceso LAN/móvil (Fase 3).
// - Por defecto el backend escucha solo en 127.0.0.1 (LAN desactivada).
// - El acceso LAN se activa manualmente y requiere reinicio para reenlazar a 0.0.0.0.
// - Con LAN activa, los dispositivos remotos deben presentar un TOKEN TEMPORAL (del QR).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDataBasePath } = require('./settings');

const NETWORK_FILE = path.join(getDataBasePath(), 'network.json');
const DEFAULTS = { lanEnabled: false };

// A.3: el archivo network.json controla si el backend se expone en la LAN. Se FIRMA con HMAC
// (secreto del cliente) para que editarlo a mano no active la LAN. Si la firma no valida
// (archivo manipulado o de otra instalación), se ignora y se cae a lanEnabled=false (fail-safe).
function networkHmacKey() {
  try {
    const { HIST_SECRET } = require('../config');
    return crypto.createHash('sha256').update('network|' + HIST_SECRET).digest();
  } catch (_) {
    return null; // sin secreto no se puede firmar/verificar => se tratará como no confiable
  }
}
function signConfig(cfg) {
  const key = networkHmacKey();
  if (!key) return null;
  const body = JSON.stringify({ lanEnabled: cfg.lanEnabled === true });
  return crypto.createHmac('sha256', key).update(body).digest('hex');
}

// TTL del token de conexión móvil (minutos).
const LAN_TOKEN_TTL_MS = parseInt(process.env.LAN_TOKEN_TTL_MIN || '15', 10) * 60 * 1000;

function loadNetworkConfig() {
  try {
    if (!fs.existsSync(NETWORK_FILE)) {
      return { ...DEFAULTS };
    }
    const cfg = JSON.parse(fs.readFileSync(NETWORK_FILE, 'utf8'));
    // Verificar la firma HMAC. Si no coincide, el archivo fue manipulado (o es de otra
    // instalación): se ignora `lanEnabled` y se usa el valor seguro por defecto (false).
    const expected = signConfig(cfg);
    if (!expected || !cfg._sig || cfg._sig !== expected) {
      if (cfg.lanEnabled === true) {
        console.warn('[NETWORK] Firma de network.json inválida: se ignora lanEnabled (fail-safe).');
      }
      return { ...DEFAULTS };
    }
    return { lanEnabled: cfg.lanEnabled === true };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function saveNetworkConfig(cfg) {
  const current = loadNetworkConfig();
  const merged = { lanEnabled: (cfg.lanEnabled !== undefined ? cfg.lanEnabled === true : current.lanEnabled) };
  const toWrite = { ...merged, _sig: signConfig(merged) };
  fs.writeFileSync(NETWORK_FILE, JSON.stringify(toWrite, null, 2));
  return merged;
}

function isLanEnabled() {
  return loadNetworkConfig().lanEnabled === true;
}

// ---- Tokens temporales de conexión móvil (en memoria) ----
const lanTokens = new Map(); // token -> expiresAt (epoch ms)

function pruneTokens() {
  const now = Date.now();
  for (const [t, exp] of lanTokens) if (exp < now) lanTokens.delete(t);
}

function createLanToken() {
  pruneTokens();
  const token = crypto.randomBytes(24).toString('base64url');
  lanTokens.set(token, Date.now() + LAN_TOKEN_TTL_MS);
  return { token, ttlMs: LAN_TOKEN_TTL_MS };
}

function verifyLanToken(token) {
  if (!token) return false;
  pruneTokens();
  const exp = lanTokens.get(token);
  return !!exp && exp >= Date.now();
}

function isLoopbackAddress(addr) {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.');
}

module.exports = {
  loadNetworkConfig,
  saveNetworkConfig,
  isLanEnabled,
  createLanToken,
  verifyLanToken,
  isLoopbackAddress,
  LAN_TOKEN_TTL_MS,
};
