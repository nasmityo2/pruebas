const axios = require('axios');
const {
    getHardwareId,
    verifyToken,
    saveLicenseCache,
    readLicenseCache,
    clearLicenseCache,
    getAppStatus,
} = require('../src/utils/license');
const { loadSettings, saveSettings } = require('../src/utils/settings');
const { LICENSE_SERVER_URL } = require('../src/config');
const { ensureUnlocked, operatorFromReq } = require('../src/utils/adminUnlock');
const { logAction } = require('../src/utils/audit');
const pkg = require('../package.json');

const BASE = LICENSE_SERVER_URL.replace(/\/+$/, '');
const ACTIVATE_URL = `${BASE}/api/activate`;
const VERIFY_URL = `${BASE}/api/verify`;
const TRIAL_URL = `${BASE}/api/trial`;

function isNewerVersion(current, latest) {
    if (!latest) return false;
    const c = String(current).split('.').map(Number);
    const l = String(latest).split('.').map(Number);
    for (let i = 0; i < Math.max(c.length, l.length); i++) {
        const v1 = c[i] || 0;
        const v2 = l[i] || 0;
        if (v2 > v1) return true;
        if (v1 > v2) return false;
    }
    return false;
}

// Heartbeat: revalida contra el servidor y refresca (o invalida) el token cacheado.
async function heartbeat() {
    const cache = readLicenseCache();
    if (!cache || !cache.key) return { ok: false, reason: 'no-cache' };
    const hwid = getHardwareId();
    try {
        const { data } = await axios.post(VERIFY_URL, { key: cache.key, hwid }, { timeout: 4000 });
        if (data && data.ok && data.token) {
            saveLicenseCache({ key: cache.key, token: data.token, plan: data.plan });
            handleUpdateInfo(data.update);
            return { ok: true, status: 'activa' };
        }
        return { ok: false, reason: 'not-authorized' };
    } catch (error) {
        const status = error.response && error.response.data && error.response.data.status;
        // El servidor marcó la licencia como revocada/expirada/otro equipo => bloquear.
        if (['revocada', 'expirada', 'otro_equipo', 'desconocida'].includes(status)) {
            clearLicenseCache();
            return { ok: false, reason: status, blocked: true };
        }
        // Error de red (offline): mantenemos el token cacheado hasta que expire su ventana de gracia.
        return { ok: false, reason: 'offline', error: error.message };
    }
}

function handleUpdateInfo(update) {
    if (update && !pkg.isModified) {
        if (isNewerVersion(pkg.version, update.version)) {
            global.latestUpdate = update;
        }
    }
}

async function tryStartTrial() {
    const hwid = getHardwareId();
    const settings = loadSettings();
    try {
        const { data } = await axios.post(TRIAL_URL, {
            hwid,
            systemName: settings.businessName || 'BodegApp',
        }, { timeout: 4000 });
        if (data && data.ok && data.token) {
            saveLicenseCache({ key: null, token: data.token, plan: 'TRIAL' });
            return true;
        }
    } catch (_) { /* sin trial (offline o expirado) */ }
    return false;
}

// Verificación de arranque: refresca licencia o intenta trial si no hay nada válido.
async function checkOnlineAndActivate() {
    const status = getAppStatus();
    if (status.status === 'LICENSED') {
        // En background refrescamos el token para captar revocaciones.
        await heartbeat();
        return { success: true };
    }
    // Sin licencia válida: intentamos heartbeat (por si el token expiró su gracia) y, si no, trial.
    const hb = await heartbeat();
    if (hb.ok) return { success: true };
    if (getAppStatus().status === 'EXPIRED') {
        await tryStartTrial();
    }
    return { success: true };
}

// GET /api/license/info  -> { hardwareId, status, message, plan }
const getLicenseInfo = async (req, res) => {
    try {
        const hardwareId = getHardwareId();
        // Refresco no bloqueante.
        checkOnlineAndActivate().catch(() => {});
        const appStatus = getAppStatus();
        res.json({ hardwareId, status: appStatus.status, message: appStatus.message, plan: appStatus.plan });
    } catch (error) {
        console.error('Error getting license info:', error);
        res.status(500).json({ error: 'Error interno obteniendo información de licencia.' });
    }
};

// POST /api/license/activate  { licenseKey }
const activateLicense = async (req, res) => {
    const { licenseKey } = req.body || {};
    if (!licenseKey || !licenseKey.trim()) {
        return res.status(400).json({ success: false, message: 'Ingresa una clave de licencia.' });
    }
    // Cambiar la licencia estando YA licenciado requiere clave admin (si está configurada).
    // La activación de recuperación (app bloqueada/sin licencia) NO se gatea, para no bloquear al dueño.
    if (getAppStatus().status === 'LICENSED' && !ensureUnlocked(req, res)) return;
    const key = licenseKey.trim().toUpperCase();
    const hwid = getHardwareId();
    const settings = loadSettings();
    try {
        const { data } = await axios.post(ACTIVATE_URL, {
            key,
            hwid,
            systemName: settings.businessName || 'BodegApp',
            clientPhone: settings.clientPhone,
            clientEmail: settings.clientEmail,
        }, { timeout: 6000 });

        if (data && data.ok && data.token && verifyToken(data.token)) {
            saveLicenseCache({ key, token: data.token, plan: data.plan });
            // Guardamos también la clave en settings para referencia (no es la fuente de verdad).
            saveSettings({ ...settings, licenseKey: key });
            if (global.__invalidateLicenseGate) global.__invalidateLicenseGate();
            logAction({ usuario: operatorFromReq(req), rol: 'admin', accion: 'LICENSE_ACTIVATE', entidad: 'licencia', detalle: { plan: data.plan }, ip: req.ip });
            return res.json({ success: true, message: '¡Sistema activado con éxito!' });
        }
        return res.status(401).json({ success: false, message: 'No se pudo activar la licencia.' });
    } catch (error) {
        const resp = error.response && error.response.data;
        const msg = resp && resp.error ? resp.error : 'No se pudo contactar el servidor de licencias.';
        return res.status(error.response ? error.response.status : 503).json({ success: false, message: msg });
    }
};

// POST /api/license/start-trial
const startTrial = async (req, res) => {
    const ok = await tryStartTrial();
    const appStatus = getAppStatus();
    if (ok || appStatus.status === 'TRIAL') {
        if (global.__invalidateLicenseGate) global.__invalidateLicenseGate();
        return res.json({ success: true, message: 'Prueba iniciada.', status: appStatus.status });
    }
    return res.status(400).json({ success: false, message: 'No se pudo iniciar la prueba (¿ya usada o servidor no disponible?).' });
};

const syncLicenseContact = async (req, res) => {
    try {
        await heartbeat();
        res.json({ success: true, message: 'Información sincronizada' });
    } catch (error) {
        res.json({ success: true, message: 'Guardado localmente (Offline)' });
    }
};

async function checkUpdateOnline(req, res) {
    try {
        global.latestUpdate = null;
        await heartbeat();
        if (global.latestUpdate) return res.json({ hasUpdate: true, update: global.latestUpdate });
        return res.json({ hasUpdate: false });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

const checkUpdateStatus = async (req, res) => {
    try {
        if (global.latestUpdate) return res.json({ hasUpdate: true, update: global.latestUpdate });
        res.json({ hasUpdate: false });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getLicenseInfo,
    activateLicense,
    startTrial,
    syncLicenseContact,
    checkUpdateStatus,
    checkOnlineAndActivate,
    checkUpdateOnline,
    heartbeat,
};
