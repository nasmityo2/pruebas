const axios = require('axios');
const { getHardwareId, verifyLicense, getAppStatus, setOnlineLicense } = require('../src/utils/license');
const { loadSettings, saveSettings, getDataBasePath } = require('../src/utils/settings');
const fs = require('fs');
const path = require('path');

// URL del servidor de licencias. Default: servidor LOCAL (sin dominios externos).
// Configurable vía LICENSE_SERVER_URL en .env (ver src/config.js).
const { LICENSE_SERVER_URL } = require('../src/config');
const BASE_DOMAIN = LICENSE_SERVER_URL;
const LICENSE_API_URL = `${BASE_DOMAIN}/admin-licencias/api/check-license`;
const REDEEM_API_URL = `${BASE_DOMAIN}/admin-licencias/api/redeem-token`;
const pkg = require('../package.json');

function isNewerVersion(current, latest) {
    if (!latest) return false;
    const c = current.split('.').map(Number);
    const l = latest.split('.').map(Number);
    for (let i = 0; i < Math.max(c.length, l.length); i++) {
        const v1 = c[i] || 0;
        const v2 = l[i] || 0;
        if (v2 > v1) return true;
        if (v1 > v2) return false;
    }
    return false;
}

async function checkOnlineAndActivate() {
    try {
        const hwid = getHardwareId();
        const settings = loadSettings();
        const systemName = settings.businessName || 'BodegApp Client';

        console.log(`[LICENSE] Verificando en: ${LICENSE_API_URL}`);

        // Timeout corto para no bloquear la UI mucho tiempo si no hay internet
        const response = await axios.post(LICENSE_API_URL, {
            hwid,
            systemName,
            licenseKey: settings.licenseKey,
            clientPhone: settings.clientPhone,
            clientEmail: settings.clientEmail
        }, { timeout: 3500 });

        if (response.data) {
            // Priority 1: Check for explicit BLOCK
            if (response.data.blocked) {
                console.log('Licencia Online: BLOQUEADA POR ADMINISTRADOR');
                setOnlineLicense(false);
                // Si está bloqueada explícitamente, borramos la local para que no pueda entrar offline
                if (settings.licenseKey) {
                    saveSettings({ ...settings, licenseKey: '' });
                }
                return { success: true };
            }

            // Priority 2: Check for Authorization from Server
            if (response.data.authorized) {
                console.log('Licencia Online: AUTORIZADA');
                // Si el servidor nos devuelve una licencia firmada (nueva o recuperación), LA GUARDAMOS
                if (response.data.licenseKey) {
                    if (settings.licenseKey !== response.data.licenseKey) {
                        console.log('Nueva licencia firmada recibida. Actualizando settings...');
                        const newSettings = { ...settings, licenseKey: response.data.licenseKey };
                        const saved = saveSettings(newSettings);
                        if (saved) console.log('Licencia guardada correctamente en business-settings.json');
                        else console.error('Fallo al guardar la licencia en disco.');
                    }
                }
                setOnlineLicense(true);
            }
            // Priority 3: Fallback - Server Pending or Unknown, BUT Local License is Valid
            else if (settings.licenseKey && verifyLicense(settings.licenseKey)) {
                console.log('Servidor respuesta: Pendiente/No Auth. PERO licencia local es válida. Manteniendo acceso.');
                setOnlineLicense(true); 
            }
            else {
                console.log('Licencia Online: NO AUTORIZADA / PENDIENTE');
                setOnlineLicense(false);
            }

            // --- DETECTAR ACTUALIZACIONES ---
            if (response.data.update && !pkg.isModified) {
                const latestVersion = response.data.update.version;
                if (isNewerVersion(pkg.version, latestVersion)) {
                    console.log(`[UPDATE] Nueva versión disponible: ${latestVersion} (Actual: ${pkg.version})`);
                    global.latestUpdate = response.data.update;
                } else {
                    console.log(`[UPDATE] No hay versiones nuevas (Server: ${latestVersion}, Local: ${pkg.version})`);
                }
            }
            return { success: true };
        }
        return { success: false, error: 'Respuesta vacía del servidor' };
    } catch (error) {
        // En caso de error de red (offline), mantenemos el estado actual
        console.warn('No se pudo verificar licencia online (Offline mode? o servidor local no iniciado):', error.message);
        return { success: false, error: error.message };
    }
}

async function checkUpdateOnline(req, res) {
    try {
        // Limpiar para forzar consulta en tiempo real
        global.latestUpdate = null;
        const result = await checkOnlineAndActivate();
        
        if (!result || !result.success) {
            return res.status(503).json({ 
                success: false, 
                error: result ? result.error : 'No se pudo conectar al servidor de licencias' 
            });
        }

        if (global.latestUpdate) {
            return res.json({ hasUpdate: true, update: global.latestUpdate });
        } else {
            return res.json({ hasUpdate: false });
        }
    } catch (error) {
        console.error('[UPDATER] Error en checkUpdateOnline:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

async function checkAndRedeemToken() {
    try {
        const potentialPaths = [
            'activation.key',
            path.join(process.cwd(), 'activation.key'),
            path.join(path.dirname(process.execPath), 'activation.key')
        ];

        let tokenFile = null;
        for (const p of potentialPaths) {
            if (fs.existsSync(p)) {
                tokenFile = p;
                break;
            }
        }

        if (!tokenFile) return;

        console.log('Archivo de activación encontrado:', tokenFile);
        const token = fs.readFileSync(tokenFile, 'utf8').trim();

        if (!token || token.length < 5) {
            console.warn('Token vacío o inválido en archivo.');
            return;
        }

        const hwid = getHardwareId();
        const settings = loadSettings();

        console.log(`Intentando canjear token: ${token} para HWID: ${hwid}`);

        const response = await axios.post(REDEEM_API_URL, {
            token,
            hwid,
            systemName: settings.businessName || 'Cliente Auto-Activado',
            clientPhone: settings.clientPhone,
            clientEmail: settings.clientEmail
        });

        if (response.data && response.data.success) {
            console.log('¡Token canjeado con éxito!');
            const newSettings = { ...settings, licenseKey: response.data.licenseKey };
            saveSettings(newSettings);
            setOnlineLicense(true);

            try {
                fs.renameSync(tokenFile, tokenFile + '.used');
                console.log('Archivo activation.key renombrado a .used');
            } catch (err) {
                console.error('No se pudo renombrar el archivo de activación:', err.message);
            }
        } else {
            console.error('Error al canjear token:', response.data.error || 'Desconocido');
        }

    } catch (error) {
        console.error('Error en proceso de auto-activación con token:', error.message);
    }
}

async function checkAndApplyOfflineLicense() {
    try {
        const potentialPaths = [
            'licencia.lic',
            path.join(process.cwd(), 'licencia.lic'),
            path.join(path.dirname(process.execPath), 'licencia.lic')
        ];

        let licenseFile = null;
        for (const p of potentialPaths) {
            if (fs.existsSync(p)) {
                licenseFile = p;
                break;
            }
        }

        if (!licenseFile) return;

        const licenseKey = fs.readFileSync(licenseFile, 'utf8').trim();

        if (verifyLicense(licenseKey)) {
            console.log('¡Licencia offline validada con éxito!');
            const settings = loadSettings();
            if (settings.licenseKey !== licenseKey) {
                const newSettings = { ...settings, licenseKey };
                saveSettings(newSettings);
            }
            setOnlineLicense(true);
            try {
                fs.renameSync(licenseFile, licenseFile + '.aplicada');
            } catch (err) {}
        }
    } catch (error) {}
}

const getLicenseInfo = async (req, res) => {
    try {
        const hardwareId = getHardwareId();
        const settings = loadSettings(); 

        if (settings.licenseKey && verifyLicense(settings.licenseKey)) {
            Promise.all([
                checkOnlineAndActivate().catch(e => console.error('Background online check failed:', e.message)),
                checkAndRedeemToken().catch(e => console.error('Background token check failed:', e.message)),
                checkAndApplyOfflineLicense().catch(e => console.error('Background offline license check failed:', e.message))
            ]);

            return res.json({
                hardwareId,
                status: 'LICENSED',
                message: 'Licencia activa.'
            });
        }

        await checkAndApplyOfflineLicense();
        await checkAndRedeemToken();
        await checkOnlineAndActivate();

        const appStatus = getAppStatus();
        res.json({
            hardwareId: hardwareId,
            status: appStatus.status,
            message: appStatus.message
        });
    } catch (error) {
        console.error('Error getting license info:', error);
        res.status(500).json({ error: 'Error interno obteniendo información de licencia.' });
    }
};

async function redeemTokenString(token, hwid, settings) {
    try {
        const response = await axios.post(REDEEM_API_URL, {
            token, hwid,
            systemName: settings.businessName || 'Cliente Auto-Activado',
            clientPhone: settings.clientPhone,
            clientEmail: settings.clientEmail
        });
        if (response.data && response.data.success && response.data.licenseKey) return response.data.licenseKey;
    } catch (error) {}
    return null;
}

const activateLicense = async (req, res) => {
    const { licenseKey } = req.body;
    if (!licenseKey) return res.status(400).json({ success: false, message: 'El archivo está vacío.' });

    try {
        let finalLicense = null;
        const normalizedInput = licenseKey.trim();
        if (verifyLicense(normalizedInput)) {
            finalLicense = normalizedInput;
        } else {
            const hwid = getHardwareId();
            const settings = loadSettings();
            finalLicense = await redeemTokenString(normalizedInput, hwid, settings);
        }

        if (finalLicense) {
            const currentSettings = loadSettings();
            saveSettings({ ...currentSettings, licenseKey: finalLicense });
            setOnlineLicense(true);
            return res.json({ success: true, message: '¡Sistema activado con éxito!' });
        } else {
            return res.status(401).json({ success: false, message: 'Inválido.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error interno.' });
    }
};

const syncLicenseContact = async (req, res) => {
    try {
        await checkOnlineAndActivate();
        res.json({ success: true, message: 'Información sincronizada' });
    } catch (error) {
        res.json({ success: true, message: 'Guardado localmente (Offline)' });
    }
};

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
    syncLicenseContact,
    checkUpdateStatus,
    checkOnlineAndActivate,
    checkUpdateOnline
};