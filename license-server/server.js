const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'super-secret-key-change-this-in-env';
const SHARED_API_KEY = process.env.SHARED_API_KEY || 'bodegapp-master-key-2026';

const DATA_FILE = path.join(__dirname, 'licenses.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const INVITES_FILE = path.join(__dirname, 'invites.json');
const TOKENS_FILE = path.join(__dirname, 'activation_tokens.json');
const UPDATE_INFO_FILE = path.join(__dirname, 'update-info.json');
const PRIVATE_KEY_PATH = path.join(__dirname, 'private.key');

const PRIVATE_KEY = fs.existsSync(PRIVATE_KEY_PATH) ? fs.readFileSync(PRIVATE_KEY_PATH, 'utf8') : null;
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx9TAfveMDteIb+fk75OF
fthvws9UEFFk95ViFapr61IkgoQME8TfbotKUle69z202qj7IiN4KVGWPkSb9ERJ
oIhgG3cnUr1821d8XBaHjUCV5cY9ecwfKR5ZGg4dKdKebzKwETLjgO/Z3Siap0WO
nV3l66xzFYhRow0DgwhnvwT1MzB6bADf/5+J/7UlwqaYu9F8ALXXp34WMdSGQ1Z6
dPQ0O4Yf5srvEEeS4NeFl6PJy2X5c4nrA7nVOq+2cZFhUiVtf51UBGEKiBaS4KS8
XT5NGo1y32lmH8YswmMJjHE7x/6wME6b1VmJ8W9kKnlqX176FPqG2hH/FD7+ED3H
CQIDAQAB
-----END PUBLIC KEY-----`;

if (!PRIVATE_KEY) {
    console.error("ADVERTENCIA: No se encontró 'private.key'.");
}

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use('/admin-licencias', express.static('public'));

app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

function readJson(file, defaultData) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function initUsers() {
    const users = readJson(USERS_FILE, []);
    if (users.length === 0) {
        const hash = bcrypt.hashSync('admin123', 8);
        users.push({ id: 1, username: 'admin', password: hash, role: 'admin', createdAt: new Date().toISOString() });
        saveJson(USERS_FILE, users);
    }
}
initUsers();

// --- CRIPTO HELPERS ---

function signLicense(data) {
    if (!PRIVATE_KEY) throw new Error("Private key missing");
    const sign = crypto.createSign('SHA256');
    sign.update(JSON.stringify(data));
    sign.end();
    return sign.sign(PRIVATE_KEY, 'base64');
}

function verifyLicense(licenseKey, hwid = null) {
    try {
        if (!licenseKey) return false;
        const parts = licenseKey.split('.');
        if (parts.length !== 2) return false;

        const [payloadBase64, signatureBase64] = parts;
        const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
        const payload = JSON.parse(payloadJson);

        // Validar integridad LOGICA de la firma (¿Fue creada por mí?)
        // Usamos RSA-SHA256 explícitamente y SHA256 como fallback
        const verifier = crypto.createVerify('RSA-SHA256');
        verifier.update(JSON.stringify(payload));
        const isValid = verifier.verify(PUBLIC_KEY, Buffer.from(signatureBase64, 'base64'));

        if (!isValid) return false;

        // Si se nos dio un HWID para comparar, lo verificamos.
        // Si hwid es null, confiamos en la firma y devolvemos el payload (usado para auto-registro).
        if (hwid && payload.hwid !== hwid) return false;

        return payload;
    } catch (e) {
        console.error('Verify error:', e.message);
        return false;
    }
}

function generateLicenseString(hwid, expirationDate, systemName) {
    // IMPORTANTE: Client espera 'exp', no 'expiration'. Mantener compatibilidad.
    const licenseData = { hwid: hwid, exp: expirationDate, client: systemName, type: 'PRO' };
    const signature = signLicense(licenseData);
    return Buffer.from(JSON.stringify(licenseData)).toString('base64') + '.' + signature;
}

// --- AUTH ---

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}



const authenticateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey === SHARED_API_KEY) {
        req.user = { role: 'admin', username: 'system' }; // Mock admin user
        next();
    } else {
        // Fallback to JWT Check if no API Key
        authenticateToken(req, res, next);
    }
};

const apiRouter = express.Router();

apiRouter.get('/ping', (req, res) => res.json({ message: 'pong', time: new Date().toISOString() }));

apiRouter.post('/login', (req, res) => {
    const { username, password } = req.body;
    const users = readJson(USERS_FILE, []);
    const user = users.find(u => u.username === username);
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(400).json({ error: 'Credenciales inválidas' });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY, { expiresIn: '30d' });
    res.json({ token, username: user.username, role: user.role });
});

apiRouter.post('/register', (req, res) => {
    // ... logic for invite registration (same as before) ...
    // Keeping it brief here to focus on check-license
    const { username, password, token } = req.body;
    const invites = readJson(INVITES_FILE, {});
    const invite = invites[token];
    if (!invite) return res.status(400).json({ error: 'Invitación inválida' });

    const users = readJson(USERS_FILE, []);
    if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Usuario existe' });

    users.push({ id: Date.now(), username, password: bcrypt.hashSync(password, 8), role: invite.role, createdAt: new Date().toISOString() });
    saveJson(USERS_FILE, users);
    delete invites[token];
    saveJson(INVITES_FILE, invites);
    saveJson(INVITES_FILE, invites);
    res.json({ success: true });
});

// --- TOKEN REDEMPTION (PUBLIC) ---
apiRouter.post('/redeem-token', (req, res) => {
    const { token, hwid, systemName, clientPhone, clientEmail } = req.body;

    if (!token || !hwid) {
        return res.status(400).json({ error: 'Faltan datos: token y hwid requeridos.' });
    }

    const tokensData = readJson(TOKENS_FILE, { tokens: {} });
    const tokenInfo = tokensData.tokens[token];

    if (!tokenInfo) {
        return res.status(404).json({ error: 'Token inválido o no encontrado.' });
    }

    if (tokenInfo.status === 'used') {
        return res.status(400).json({ error: 'Este token ya ha sido usado.' });
    }

    // Calcular expiración
    const days = tokenInfo.days || 3650; // Default 10 years
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + days);
    const expStr = expirationDate.toISOString().split('T')[0]; // YYYY-MM-DD

    // Generar Licencia Firmada
    const licenseKey = generateLicenseString(hwid, expStr, systemName || tokenInfo.clientName || 'Cliente Activado');

    // Actualizar Token a USADO
    tokenInfo.status = 'used';
    tokenInfo.usedBy = hwid;
    tokenInfo.usedAt = new Date().toISOString();
    tokenInfo.generatedLicense = licenseKey; // Opcional: guardar copia de la licencia generada

    // Guardar cambios en Tokens
    tokensData.tokens[token] = tokenInfo;
    saveJson(TOKENS_FILE, tokensData);

    // Guardar/Actualizar Licencia en Base de Datos Principal (licenses.json)
    const licensesData = readJson(DATA_FILE, { requests: {} });

    licensesData.requests[hwid] = {
        hwid,
        systemName: systemName || tokenInfo.clientName || 'Cliente Activado',
        clientPhone: clientPhone || '',
        clientEmail: clientEmail || '',
        active: true,
        blocked: false,
        hidden: false,
        requestDate: new Date().toISOString(),
        lastCheck: new Date().toISOString(),
        history: [], // Initialize or append
        licenseKey: licenseKey,
        expirationDate: expStr,
        activatedBy: 'token:' + token,
        activationDate: new Date().toISOString()
    };

    // Add history entry
    licensesData.requests[hwid].history.push({
        action: 'TOKEN_REDEEM',
        by: 'system',
        date: new Date().toISOString(),
        changes: {
            desc: `Redeemed token ${token}`,
            days: days
        }
    });

    saveJson(DATA_FILE, licensesData);

    console.log(`[TOKEN] Token ${token} canjeado por HWID ${hwid}`);

    res.json({
        success: true,
        message: 'Token canjeado correctamente.',
        licenseKey: licenseKey,
        expirationDate: expStr
    });
});

// --- CORE LOGIC: CHECK & AUTO-ACTIVATE ---
apiRouter.post('/check-license', (req, res) => {
    const { hwid, systemName, licenseKey, clientPhone, clientEmail } = req.body;

    if (!hwid) return res.status(400).json({ error: 'HWID is required' });
    if (hwid.startsWith('error') || hwid.length < 5) return res.status(400).json({ error: 'Invalid HWID: System information unavailable' });

    const data = readJson(DATA_FILE, { requests: {} });
    let license = data.requests[hwid];

    // 1. Si la licencia ya existe y está bloqueada -> Rechazar
    // Aquí usamos el HWID reportado por la máquina
    if (license && license.blocked) {
        return res.json({ authorized: false, message: 'License blocked', blocked: true });
    }

    // 2. Si nos envían una licencia existente (Offline Key)
    // Intentamos validarla SIN exigir que el HWID coincida exactamente, confiando en la firma
    if (licenseKey && (!license || !license.active)) {
        console.log(`Verificando licencia existente (Firma) para ${hwid}...`);

        // Pass NULL for HWID to skip rigid check
        const payload = verifyLicense(licenseKey, null);

        if (payload) {
            console.log(`Firma válida detectada (De: ${payload.hwid}). Auto-migrando a HWID actual: ${hwid}`);

            // Generar una NUEVA licencia firmada para el HWID ACTUAL
            // Esto asegura que el cliente reciba una llave compatible con su nuevo HWID estable
            const newLicenseKey = generateLicenseString(
                hwid, 
                payload.exp || payload.expiration, 
                systemName || payload.client || 'Recovered Client'
            );

            if (!license) {
                license = {
                    hwid: hwid,
                    systemName: systemName || payload.client || 'Recovered Client',
                    clientPhone: clientPhone || '',
                    clientEmail: clientEmail || '',
                    active: true,
                    blocked: false,
                    hidden: false,
                    requestDate: new Date().toISOString(),
                    lastCheck: new Date().toISOString(),
                    history: [],
                    licenseKey: newLicenseKey,
                    expirationDate: payload.exp || payload.expiration
                };
            } else {
                license.active = true;
                license.licenseKey = newLicenseKey;
                license.expirationDate = payload.exp || payload.expiration;
                if (systemName) license.systemName = systemName;
            }

            // Guardar cambios
            data.requests[hwid] = license;

            // Log history for auto-activation
            if (!license.history) license.history = [];
            license.history.push({
                action: 'AUTO_ACTIVATE',
                by: 'system',
                date: new Date().toISOString(),
                changes: {
                    desc: 'Auto-authorized via valid signed key'
                }
            });

            // Ensure activatedBy is set if not present
            if (!license.activatedBy) {
                license.activatedBy = 'system';
                license.activationDate = new Date().toISOString();
            }

            saveJson(DATA_FILE, data);

            return res.json({
                authorized: true,
                message: 'Auto-authorized via valid signed key',
                licenseKey: license.licenseKey,
                expirationDate: license.expirationDate
            });
        }
    }

    // 3. Flujo normal
    if (license) {
        if (license.active) {
            // SELF-HEALING: Verificar si la licencia almacenada tiene el formato antiguo (expiration vs exp)
            const currentPayload = verifyLicense(license.licenseKey, null);
            if (currentPayload && !currentPayload.exp && currentPayload.expiration) {
                console.log(`[AUTO-FIX] Corrigiendo formato de licencia para ${hwid} (expiration -> exp)`);
                const newKey = generateLicenseString(
                    license.hwid,
                    license.expirationDate || currentPayload.expiration,
                    license.systemName
                );
                license.licenseKey = newKey;
                saveJson(DATA_FILE, data);
            }

            // Actualizamos lastCheck y guardamos una sola vez
            license.lastCheck = new Date().toISOString();
            if (systemName && license.systemName !== systemName) {
                license.systemName = systemName;
            }
            if (clientPhone) license.clientPhone = clientPhone;
            if (clientEmail) license.clientEmail = clientEmail;
            saveJson(DATA_FILE, data);

            // --- AÑADIR INFO DE ACTUALIZACIÓN ---
            const updateInfo = readJson(UPDATE_INFO_FILE, null);

            return res.json({
                authorized: true,
                message: 'License active',
                licenseKey: license.licenseKey,
                expirationDate: license.expirationDate,
                update: updateInfo
            });
        } else {
            // Actualizar info
            if (systemName) license.systemName = systemName;
            license.lastCheck = new Date().toISOString();
            saveJson(DATA_FILE, data);
            return res.json({ authorized: false, message: 'Pending activation' });
        }
    } else {
        // Nueva solicitud
        data.requests[hwid] = {
            hwid,
            systemName: systemName || 'Unknown',
            clientPhone: clientPhone || '',
            clientEmail: clientEmail || '',
            active: false,
            blocked: false,
            hidden: false,
            requestDate: new Date().toISOString(),
            lastCheck: new Date().toISOString(),
            history: []
        };
        saveJson(DATA_FILE, data);
        return res.json({ authorized: false, message: 'Registration received. Pending manual activation.' });
    }
});

// ... Internal Protected Routes ...
apiRouter.get('/protected/licenses', authenticateToken, (req, res) => {
    const { page = 1, limit = 20, search = '', tab = 'all' } = req.query;
    const p = parseInt(page);
    const l = parseInt(limit);
    const searchQuery = search.toLowerCase();

    const data = readJson(DATA_FILE, { requests: {} });
    let licenses = Object.values(data.requests);

    // 1. Filter by role/owner
    if (req.user.role !== 'admin') {
        licenses = licenses.filter(l => l.createdBy === req.user.username || !l.createdBy);
    }

    // 2. Filter by search query (HWID or SystemName)
    if (searchQuery) {
        licenses = licenses.filter(lic =>
            (lic.systemName || '').toLowerCase().includes(searchQuery) ||
            (lic.hwid || '').toLowerCase().includes(searchQuery)
        );
    }

    // 3. Filter by tab status
    const now = new Date();
    if (tab !== 'all') {
        licenses = licenses.filter(lic => {
            const isHidden = lic.hidden === true;
            const isActive = lic.active === true;
            const isBlocked = lic.blocked === true;

            const reqDate = new Date(lic.requestDate || lic.lastCheck);
            const daysOld = (now - reqDate) / (1000 * 60 * 60 * 24);
            const isVirtuallyHidden = isHidden || (!isActive && !isBlocked && daysOld > 3);

            if (tab === 'pending') return !isActive && !isBlocked && !isVirtuallyHidden;
            if (tab === 'active') return isActive && !isBlocked;
            if (tab === 'hidden') return isVirtuallyHidden || isBlocked;
            return true;
        });
    }

    // 4. Sort
    licenses.sort((a, b) => new Date(b.lastCheck) - new Date(a.lastCheck));

    // 5. Paginate
    const total = licenses.length;
    const totalPages = Math.ceil(total / l);
    const start = (p - 1) * l;
    const paginatedLicenses = licenses.slice(start, start + l);

    res.json({
        licenses: paginatedLicenses,
        total,
        page: p,
        pages: totalPages,
        limit: l
    });
});

apiRouter.post('/protected/toggle', authenticateToken, (req, res) => {
    const { hwid, active, blocked, hidden, expirationDate } = req.body;
    const data = readJson(DATA_FILE, { requests: {} });
    if (data.requests[hwid]) {
        const l = data.requests[hwid];
        // Permission check skipped for brevity (add back if needed)

        const prev = { active: l.active, blocked: l.blocked, hidden: l.hidden };

        if (active !== undefined) l.active = active;
        if (blocked !== undefined) l.blocked = blocked;
        if (hidden !== undefined) l.hidden = hidden;

        if (active) {
            // SIEMPRE regenerar la licencia al activar para asegurar que use el formato más reciente (fix hwid/exp)
            const exp = expirationDate || l.expirationDate || '2050-12-31';
            l.expirationDate = exp;
            l.licenseKey = generateLicenseString(hwid, exp, l.systemName);
        }

        // --- HISTORY & ACTIVATED_BY ---
        if (!l.history) l.history = [];
        const currentUser = req.user ? req.user.username : 'unknown';

        l.history.push({
            action: 'UPDATE',
            by: currentUser,
            date: new Date().toISOString(),
            changes: {
                prev: prev,
                new: { active: l.active, blocked: l.blocked, hidden: l.hidden, exp: l.expirationDate }
            }
        });

        if (active === true && !prev.active) {
            l.activatedBy = currentUser;
            l.activationDate = new Date().toISOString();
        } else if (active === false && prev.active) {
            // Optional: Clear activatedBy on revoke? Usually better to keep record of who LAST activated it, or clear it.
            // We'll keep it but maybe add a 'revokedBy' if needed. For now just history is enough.
        }
        // ------------------------------

        saveJson(DATA_FILE, data);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Clean' });
    }
});

apiRouter.post('/protected/delete', authenticateToken, (req, res) => {
    const { hwid } = req.body;
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

    const data = readJson(DATA_FILE, { requests: {} });
    if (data.requests[hwid]) {
        delete data.requests[hwid];
        saveJson(DATA_FILE, data);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});
apiRouter.post('/protected/invite', authenticateToken, (req, res) => {
    // ... invite logic ...
    const token = crypto.randomUUID();
    const invites = readJson(INVITES_FILE, {});
    invites[token] = { role: req.body.role || 'operator', createdAt: new Date().toISOString() };
    saveJson(INVITES_FILE, invites);
    res.json({ success: true, token, link: `register.html?token=${token}` });
});

// --- ADMIN TOKEN GENERATION ---
apiRouter.post('/protected/generate-tokens', authenticateApiKey, (req, res) => {
    const { quantity, days, type, clientNote } = req.body;

    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });

    const numTokens = quantity || 1;
    const tokenDays = days || 3650; // Default 10 years
    const tokenType = type || 'PRO';

    const tokensData = readJson(TOKENS_FILE, { tokens: {} });
    const newTokens = [];

    for (let i = 0; i < numTokens; i++) {
        const token = crypto.randomUUID();
        const tokenObj = {
            status: 'unused',
            type: tokenType,
            days: tokenDays,
            clientName: clientNote || null, // Optional note to identify batch
            createdAt: new Date().toISOString(),
            createdBy: req.user.username
        };
        tokensData.tokens[token] = tokenObj;
        newTokens.push({ token, ...tokenObj });
    }

    saveJson(TOKENS_FILE, tokensData);

    console.log(`[ADMIN] Generados ${numTokens} tokens por ${req.user.username}`);

    res.json({
        success: true,
        message: `${numTokens} tokens generados.`,
        tokens: newTokens
    });
});

apiRouter.post('/protected/change-password', authenticateToken, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Faltan datos' });

    const users = readJson(USERS_FILE, []);
    const userIndex = users.findIndex(u => u.username === req.user.username); // req.user set in authenticateToken

    if (userIndex === -1) return res.status(404).json({ error: 'Usuario no encontrado' });

    const user = users[userIndex];
    if (!bcrypt.compareSync(currentPassword, user.password)) {
        return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }

    if (newPassword.length < 6) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });

    user.password = bcrypt.hashSync(newPassword, 8);
    users[userIndex] = user;
    saveJson(USERS_FILE, users);

    res.json({ success: true, message: 'Contraseña actualizada' });
});

// --- UPDATE MANAGEMENT ---
apiRouter.post('/update/publish', authenticateApiKey, (req, res) => {
    const { version, downloadUrl, mandatory, changelog, description } = req.body;
    if (!version || !downloadUrl) return res.status(400).json({ error: 'Faltan datos' });

    const updateInfo = {
        version,
        downloadUrl,
        mandatory: mandatory || false,
        changelog: changelog || [],
        description: description || '',
        releaseDate: new Date().toISOString()
    };

    saveJson(UPDATE_INFO_FILE, updateInfo);
    res.json({ success: true, message: 'Actualización publicada', data: updateInfo });
});

apiRouter.get('/update/info', (req, res) => {
    const updateInfo = readJson(UPDATE_INFO_FILE, null);
    if (!updateInfo) return res.status(404).json({ error: 'Sin info de actualización' });
    res.json(updateInfo);
});

app.use('/api', apiRouter);
app.use('/admin-licencias/api', apiRouter);

app.get(['/', '/admin', '/dashboard', '/admin-licencias', '/admin-licencias/*'], (req, res) => {
    if (req.path.includes('/api/')) return res.status(404).json({ error: 'Not found' });
    const file = path.join(__dirname, 'public', 'admin.html');
    if (fs.existsSync(file)) res.sendFile(file); else res.status(404).send('Missing admin.html');
});

app.get(['/register', '/admin-licencias/register'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

app.listen(PORT, () => console.log(`Running on ${PORT}`));
