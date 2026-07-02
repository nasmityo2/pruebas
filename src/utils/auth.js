// src/utils/auth.js
// Contraseña admin local para acciones sensibles. Migrada a bcrypt (Fase 4).
// Los hashes bcrypt empiezan por "$2". Un hash antiguo (HMAC hex de 64 chars) se
// considera LEGACY: no valida, y se pide restablecer la contraseña admin.
const bcrypt = require('bcryptjs');
const { loadSettings } = require('./settings');

const BCRYPT_ROUNDS = 12;

function isBcryptHash(hash) {
    return typeof hash === 'string' && /^\$2[aby]\$/.test(hash);
}

function hashPassword(password) {
    if (!password) return null;
    return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

function verifyPassword(inputPassword) {
    const settings = loadSettings();
    const storedHash = settings.adminPasswordHash;

    // Sin contraseña configurada: no hay gate (se pedirá configurarla).
    if (!storedHash) return true;

    if (!inputPassword) return false;

    // Hash legacy (HMAC): no es válido bajo bcrypt; forzar restablecimiento.
    if (!isBcryptHash(storedHash)) {
        console.warn('[AUTH] Hash de admin en formato antiguo. Debe restablecerse la contraseña admin.');
        return false;
    }

    try {
        return bcrypt.compareSync(inputPassword, storedHash);
    } catch (e) {
        return false;
    }
}

// ¿El hash almacenado es legacy (requiere que el dueño restablezca la clave)?
function isLegacyAdminHash() {
    const settings = loadSettings();
    const storedHash = settings.adminPasswordHash;
    return !!storedHash && !isBcryptHash(storedHash);
}

module.exports = {
    hashPassword,
    verifyPassword,
    isLegacyAdminHash,
    isBcryptHash,
};
