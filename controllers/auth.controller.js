const { loadSettings, saveSettings } = require('../src/utils/settings');
const { hashPassword, verifyPassword, isLegacyAdminHash } = require('../src/utils/auth');
const { issueUnlock, ADMIN_UNLOCK_TTL_MS, operatorFromReq, isLockedOut, recordFailure, resetFailures } = require('../src/utils/adminUnlock');
const { logAction } = require('../src/utils/audit');

const getAuthStatus = (req, res) => {
    try {
        const settings = loadSettings();
        res.json({
            isPasswordEnabled: !!settings.adminPasswordHash,
            isLegacyHash: isLegacyAdminHash(),
        });
    } catch (error) {
        console.error('Error al obtener estado de autenticación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

const setAdminPassword = (req, res) => {
    const { currentPassword, newPassword } = req.body;

    try {
        const settings = loadSettings();

        // Si ya hay una contraseña vigente y NO es legacy, exige la actual.
        if (settings.adminPasswordHash && !isLegacyAdminHash()) {
            const isVerified = verifyPassword(currentPassword);
            if (!isVerified) {
                return res.status(403).json({ error: 'La contraseña actual es incorrecta.' });
            }
        }

        if (newPassword && String(newPassword).length < 4) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres.' });
        }

        const newHash = hashPassword(newPassword);
        const newSettings = { ...settings, adminPasswordHash: newHash };

        if (saveSettings(newSettings)) {
            logAction({
                usuario: operatorFromReq(req), rol: 'admin',
                accion: newHash ? 'ADMIN_PASSWORD_SET' : 'ADMIN_PASSWORD_CLEAR',
                entidad: 'settings', ip: req.ip,
            });
            const message = newHash ? 'Contraseña de administrador actualizada.' : 'Contraseña de administrador eliminada.';
            res.json({ success: true, message });
        } else {
            throw new Error('No se pudo guardar la configuración.');
        }
    } catch (error) {
        console.error('Error al establecer la contraseña:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

const verifyAdminPassword = (req, res) => {
    const { password } = req.body;
    if (!password) {
        return res.status(400).json({ error: 'Se requiere contraseña.' });
    }
    // A.3: límite de intentos por IP contra fuerza bruta del desbloqueo admin.
    if (isLockedOut(req.ip)) {
        logAction({ usuario: operatorFromReq(req), accion: 'ADMIN_UNLOCK_LOCKED', entidad: 'auth', ip: req.ip });
        return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.' });
    }
    try {
        const isVerified = verifyPassword(password);
        if (!isVerified) {
            recordFailure(req.ip);
            logAction({ usuario: operatorFromReq(req), accion: 'ADMIN_UNLOCK_FAIL', entidad: 'auth', ip: req.ip });
            return res.status(403).json({ error: 'Contraseña incorrecta.' });
        }
        resetFailures(req.ip);
        // Emitir desbloqueo admin de corta duración (cookie HttpOnly del mismo origen).
        const { token } = issueUnlock();
        res.setHeader('Set-Cookie', `adminUnlock=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ADMIN_UNLOCK_TTL_MS / 1000)}`);
        res.json({ success: true, message: 'Verificación exitosa.', unlockToken: token, ttlMs: ADMIN_UNLOCK_TTL_MS });
    } catch (error) {
        console.error('Error al verificar la contraseña:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

module.exports = {
    getAuthStatus,
    setAdminPassword,
    verifyAdminPassword,
};
