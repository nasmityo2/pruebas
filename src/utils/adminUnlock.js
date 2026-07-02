// src/utils/adminUnlock.js
// "Desbloqueo admin" de corta duración para acciones sensibles.
// Tras verificar la contraseña admin, se emite un token corto que viaja en una cookie
// HttpOnly del mismo origen. El servidor exige ese token para las operaciones sensibles,
// de modo que la protección es del LADO SERVIDOR (no solo del cliente).
const crypto = require('crypto');

const TTL_MS = parseInt(process.env.ADMIN_UNLOCK_TTL_SEC || '120', 10) * 1000;
const tokens = new Map(); // token -> expiresAt

function prune() {
  const now = Date.now();
  for (const [t, exp] of tokens) if (exp < now) tokens.delete(t);
}

function issueUnlock() {
  prune();
  const token = crypto.randomBytes(24).toString('base64url');
  tokens.set(token, Date.now() + TTL_MS);
  return { token, ttlMs: TTL_MS };
}

function verifyUnlock(token) {
  if (!token) return false;
  prune();
  const exp = tokens.get(token);
  return !!exp && exp >= Date.now();
}

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function tokenFromReq(req) {
  const headers = req.headers || {};
  return (
    (headers['x-admin-unlock']) ||
    (req.body && req.body.adminUnlock) ||
    parseCookie(headers.cookie, 'adminUnlock') ||
    null
  );
}

// Identidad del operador (para auditoría). El cliente puede enviarla en 'x-operator'.
function operatorFromReq(req) {
  const headers = req.headers || {};
  const raw = headers['x-operator'] || (req.body && req.body.__operator) || '';
  const value = String(raw || '').trim();
  return value || 'sistema';
}

/**
 * Exige desbloqueo admin para una acción sensible, del lado servidor.
 * - Si NO hay contraseña admin configurada, no hay gate (comportamiento actual).
 * - Si hay contraseña, exige un token de desbloqueo válido (cookie adminUnlock o header).
 * Devuelve true si puede continuar; si no, responde 403 y devuelve false.
 */
function ensureUnlocked(req, res) {
  // Requerimos aquí para evitar ciclos de carga.
  const { loadSettings } = require('./settings');
  const adminConfigured = !!loadSettings().adminPasswordHash;
  if (!adminConfigured) return true;

  if (verifyUnlock(tokenFromReq(req))) return true;

  if (res && typeof res.status === 'function') {
    res.status(403).json({ error: 'Se requiere verificación de administrador.', adminRequired: true });
  }
  return false;
}

module.exports = {
  issueUnlock,
  verifyUnlock,
  ensureUnlocked,
  tokenFromReq,
  operatorFromReq,
  ADMIN_UNLOCK_TTL_MS: TTL_MS,
};
