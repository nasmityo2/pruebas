require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// --- Fail-fast de configuración: sin fallback inseguro ---
function requireEnv(name) {
    const value = process.env[name];
    if (!value || !value.trim()) {
        console.error(`[FATAL] Falta la variable de entorno obligatoria: ${name}. Configúrala en license-server/.env (ver .env.example). El servidor NO arrancará sin ella.`);
        process.exit(1);
    }
    return value.trim();
}

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = (process.env.HOST || '127.0.0.1').trim();
const SECRET_KEY = requireEnv('SECRET_KEY');
// Fase 14: la firma JWT del panel autentica la generación/revocación de licencias.
// Un secreto débil permitiría forjar un JWT admin offline; exigir robustez mínima.
if (SECRET_KEY.length < 32) {
    console.error('[FATAL] SECRET_KEY debe tener al menos 32 caracteres (usa 48+ bytes aleatorios).');
    process.exit(1);
}

// ------------------------------------------------------------------
// Fase 14: acceso SEGURO a mapas de objetos planos.
// Buscar con `map[key]` permite que key="__proto__"/"constructor" devuelva
// Object.prototype (truthy) y se trate como una "licencia"/"trial" real => bypass.
// Estas helpers usan hasOwnProperty y rechazan claves reservadas del prototipo.
// ------------------------------------------------------------------
const RESERVED_MAP_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
function isUnsafeMapKey(k) {
    return typeof k !== 'string' || k.length === 0 || RESERVED_MAP_KEYS.has(k);
}
function safeMapGet(map, key) {
    if (!map || isUnsafeMapKey(key)) return undefined;
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

// DATA_DIR permite aislar los datos (útil para tests). Por defecto, la carpeta del servidor.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'licenses.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TRIALS_FILE = path.join(DATA_DIR, 'trials.json');
const UPDATE_INFO_FILE = path.join(DATA_DIR, 'update-info.json');
const ACCESS_LOG_FILE = path.join(DATA_DIR, 'access.log');
// Las llaves se buscan primero en DATA_DIR y, si no, en la carpeta del servidor.
const PRIVATE_KEY_PATH = fs.existsSync(path.join(DATA_DIR, 'private.key')) ? path.join(DATA_DIR, 'private.key') : path.join(__dirname, 'private.key');
const PUBLIC_KEY_PATH = fs.existsSync(path.join(DATA_DIR, 'public.key')) ? path.join(DATA_DIR, 'public.key') : path.join(__dirname, 'public.key');

const PRIVATE_KEY = fs.existsSync(PRIVATE_KEY_PATH) ? fs.readFileSync(PRIVATE_KEY_PATH, 'utf8') : null;
if (!PRIVATE_KEY) {
    console.error("[FATAL] No se encontró 'private.key'. Genérala con: node license-server/generate-keys.js");
    process.exit(1);
}
const PUBLIC_KEY = fs.existsSync(PUBLIC_KEY_PATH)
    ? fs.readFileSync(PUBLIC_KEY_PATH, 'utf8')
    : crypto.createPublicKey(PRIVATE_KEY).export({ type: 'spki', format: 'pem' });

// Ventana de gracia offline del token (días). Tras vencer el token, el cliente exige re-verificación online.
// Fase 2 refuerzo / 11.3: bajado de 7 a 5 para que la revocación remota se propague antes.
const TOKEN_GRACE_DAYS = parseInt(process.env.TOKEN_GRACE_DAYS || '5', 10);
const TRIAL_DURATION_HOURS = parseInt(process.env.TRIAL_DURATION_HOURS || '72', 10);

// ------------------------------------------------------------------
// Almacenamiento JSON
// ------------------------------------------------------------------
function readJson(file, defaultData) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
        return JSON.parse(JSON.stringify(defaultData));
    }
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        // Fase 14: NO devolver defaults en silencio: la siguiente escritura borraría
        // todas las licencias/usuarios. Respaldamos el archivo corrupto para no perder
        // datos y solo entonces seguimos con los valores por defecto.
        try {
            const backup = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
            fs.copyFileSync(file, backup);
            console.error(`[WARN] ${path.basename(file)} corrupto. Copia preservada en ${path.basename(backup)}.`);
        } catch (copyErr) {
            console.error(`[FATAL] ${path.basename(file)} corrupto y no se pudo respaldar: ${copyErr.message}. Se aborta para no perder datos.`);
            process.exit(1);
        }
        return JSON.parse(JSON.stringify(defaultData));
    }
}
function saveJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function logAccess(event, detail) {
    try {
        const line = `[${new Date().toISOString()}] ${event} ${JSON.stringify(detail)}\n`;
        fs.appendFileSync(ACCESS_LOG_FILE, line);
    } catch (_) { /* noop */ }
}

// ------------------------------------------------------------------
// Admin inicial (fail-fast, sin admin=[REMOVED-COMPROMISED-CREDENTIAL] por defecto)
// ------------------------------------------------------------------
function initUsers() {
    const users = readJson(USERS_FILE, []);
    if (users.length === 0) {
        const adminUser = (process.env.ADMIN_USERNAME || '').trim();
        const adminPass = process.env.ADMIN_PASSWORD || '';
        if (!adminUser || !adminPass) {
            console.error('[FATAL] No hay usuarios y faltan ADMIN_USERNAME/ADMIN_PASSWORD para crear el admin inicial.');
            console.error('        Configúralos en license-server/.env (solo para el primer arranque) y vuelve a iniciar.');
            process.exit(1);
        }
        if (adminPass.length < 10) {
            console.error('[FATAL] ADMIN_PASSWORD debe tener al menos 10 caracteres.');
            process.exit(1);
        }
        const hash = bcrypt.hashSync(adminPass, 12);
        users.push({ id: 1, username: adminUser, password: hash, role: 'admin', createdAt: new Date().toISOString() });
        saveJson(USERS_FILE, users);
        console.log(`[INIT] Usuario admin '${adminUser}' creado. Borra ADMIN_PASSWORD del .env tras el primer arranque.`);
    }
}
initUsers();

// ------------------------------------------------------------------
// Firma de tokens de licencia (la verdad vive aquí; la privada nunca sale)
// ------------------------------------------------------------------
function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signToken(payload) {
    const body = b64url(JSON.stringify(payload));
    const signature = crypto.sign('RSA-SHA256', Buffer.from(body), PRIVATE_KEY);
    return `${body}.${b64url(signature)}`;
}
function issueLicenseToken(license) {
    const now = Math.floor(Date.now() / 1000);
    const hardExp = license.fechaExpiracion ? Math.floor(new Date(license.fechaExpiracion).getTime() / 1000) : null;
    let exp = now + TOKEN_GRACE_DAYS * 24 * 3600;
    if (hardExp && hardExp < exp) exp = hardExp; // nunca exceder la expiración real
    // Fase 2 refuerzo / 11.5-11.6:
    // - jti: id único por token (anti-replay: el cliente puede rechazar tokens repetidos/viejos).
    // - k: material de clave por-licencia (habilita el cifrado de recursos ligado a licencia).
    return signToken({
        v: 1, typ: 'license', key: license.key, hwid: license.hwid,
        plan: license.plan || 'PRO', iat: now, exp,
        jti: crypto.randomUUID(),
        k: license.k || null,
    });
}
function issueTrialToken(hwid, expEpoch) {
    const now = Math.floor(Date.now() / 1000);
    return signToken({ v: 1, typ: 'trial', hwid, plan: 'TRIAL', iat: now, exp: expEpoch });
}

// ------------------------------------------------------------------
// Generación de claves de licencia (solo el dueño, vía panel)
// ------------------------------------------------------------------
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Crockford-ish, sin caracteres ambiguos
function generateLicenseKey() {
    const groups = [];
    for (let g = 0; g < 4; g++) {
        let s = '';
        const bytes = crypto.randomBytes(5);
        for (let i = 0; i < 5; i++) s += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
        groups.push(s);
    }
    return 'BGA-' + groups.join('-');
}

// ------------------------------------------------------------------
// Middleware
// ------------------------------------------------------------------
const corsOrigin = process.env.PANEL_ORIGIN || true;
app.use(cors({ origin: corsOrigin }));
// Fase 2 refuerzo / A.2: cabeceras de seguridad básicas (equivalente ligero a helmet,
// sin añadir dependencia). Endurece el panel y las respuestas del servidor de licencias.
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    next();
});
app.use(bodyParser.json({ limit: '256kb' }));
app.use(express.static('public'));
app.use('/admin-licencias', express.static('public'));

// Fase 2 refuerzo / Anexo A: detección simple de anomalías por clave (mismo key/hwid
// verificándose desde MUCHAS IPs distintas en poco tiempo => posible clonado/trial farming).
const anomalyMap = new Map(); // key -> { ips:Set, first:epochMs }
const ANOMALY_WINDOW_MS = 60 * 60 * 1000; // 1h
const ANOMALY_IP_THRESHOLD = 5;
function trackAnomaly(key, ip) {
    if (!key) return;
    const now = Date.now();
    let e = anomalyMap.get(key);
    if (!e || now - e.first > ANOMALY_WINDOW_MS) {
        e = { ips: new Set(), first: now };
        anomalyMap.set(key, e);
    }
    e.ips.add(ip || 'unknown');
    if (e.ips.size >= ANOMALY_IP_THRESHOLD) {
        logAccess('ANOMALY_MANY_IPS', { key, distinctIps: e.ips.size, windowMs: ANOMALY_WINDOW_MS });
    }
}

// Rate limiting simple en memoria para endpoints públicos sensibles
const rateBuckets = new Map();
function rateLimit({ windowMs, max }) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const keyId = `${req.path}:${ip}`;
        const now = Date.now();
        let entry = rateBuckets.get(keyId);
        if (!entry || now - entry.start > windowMs) {
            entry = { start: now, count: 0 };
        }
        entry.count += 1;
        rateBuckets.set(keyId, entry);
        if (entry.count > max) {
            logAccess('RATE_LIMIT', { ip, path: req.path });
            return res.status(429).json({ ok: false, error: 'Demasiadas solicitudes. Intenta más tarde.' });
        }
        next();
    };
}
const activationLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, SECRET_KEY, { algorithms: ['HS256'] }, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Solo administrador' });
    next();
}

// ------------------------------------------------------------------
// Rutas públicas
// ------------------------------------------------------------------
const apiRouter = express.Router();

apiRouter.get('/ping', (req, res) => res.json({ message: 'pong', time: new Date().toISOString() }));

apiRouter.post('/login', rateLimit({ windowMs: 60 * 1000, max: 10 }), (req, res) => {
    const { username, password } = req.body || {};
    const users = readJson(USERS_FILE, []);
    const user = users.find(u => u.username === username);
    if (!user || !bcrypt.compareSync(password || '', user.password)) {
        logAccess('LOGIN_FAIL', { username, ip: req.ip });
        return res.status(400).json({ error: 'Credenciales inválidas' });
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY, { expiresIn: '12h' });
    logAccess('LOGIN_OK', { username, ip: req.ip });
    res.json({ token, username: user.username, role: user.role });
});

// Activación: valida clave + HWID, vincula 1 licencia ↔ 1 equipo, devuelve token firmado.
apiRouter.post('/activate', activationLimiter, (req, res) => {
    const { key, hwid, systemName, clientPhone, clientEmail } = req.body || {};
    if (!key || !hwid) return res.status(400).json({ ok: false, error: 'Faltan datos: key y hwid requeridos.' });
    if (String(hwid).length < 8) return res.status(400).json({ ok: false, error: 'HWID inválido.' });

    const data = readJson(DATA_FILE, { licenses: {} });
    const license = safeMapGet(data.licenses, key);
    if (!license) {
        logAccess('ACTIVATE_UNKNOWN', { key, hwid, ip: req.ip });
        return res.status(404).json({ ok: false, status: 'desconocida', error: 'Clave de licencia no encontrada.' });
    }
    if (license.estado === 'revocada') {
        logAccess('ACTIVATE_REVOKED', { key, hwid, ip: req.ip });
        return res.status(403).json({ ok: false, status: 'revocada', error: 'Licencia revocada.' });
    }
    if (license.fechaExpiracion && new Date(license.fechaExpiracion).getTime() < Date.now()) {
        return res.status(403).json({ ok: false, status: 'expirada', error: 'Licencia expirada.' });
    }
    if (license.hwid && license.hwid !== hwid) {
        logAccess('ACTIVATE_OTHER_DEVICE', { key, hwid, boundTo: license.hwid, ip: req.ip });
        return res.status(409).json({ ok: false, status: 'otro_equipo', error: 'La licencia ya está activada en otro equipo.' });
    }

    trackAnomaly(key, req.ip);

    // Material de clave por-licencia (Fase 11.6): se genera una vez, al activar.
    if (!license.k) license.k = crypto.randomBytes(32).toString('hex');

    // Vincular al equipo (1 licencia = 1 equipo)
    license.hwid = hwid;
    license.estado = 'activa';
    license.equipo = systemName || license.equipo || 'Equipo';
    license.clientPhone = clientPhone || license.clientPhone || '';
    license.clientEmail = clientEmail || license.clientEmail || '';
    license.fechaActivacion = license.fechaActivacion || new Date().toISOString();
    license.lastCheck = new Date().toISOString();
    license.history = license.history || [];
    license.history.push({ action: 'ACTIVATE', hwid, date: new Date().toISOString(), ip: req.ip });
    saveJson(DATA_FILE, data);

    logAccess('ACTIVATE_OK', { key, hwid, ip: req.ip });
    const token = issueLicenseToken(license);
    res.json({ ok: true, status: 'activa', token, plan: license.plan, expirationDate: license.fechaExpiracion || null });
});

// Verificación (heartbeat): revalida estado y reemite token si sigue activa.
apiRouter.post('/verify', activationLimiter, (req, res) => {
    const { key, hwid } = req.body || {};
    if (!key || !hwid) return res.status(400).json({ ok: false, error: 'Faltan datos.' });

    const data = readJson(DATA_FILE, { licenses: {} });
    const license = safeMapGet(data.licenses, key);
    if (!license) return res.status(404).json({ ok: false, status: 'desconocida' });
    if (license.estado === 'revocada') {
        logAccess('VERIFY_REVOKED', { key, hwid, ip: req.ip });
        return res.status(403).json({ ok: false, status: 'revocada' });
    }
    // Fase 14: exigir vínculo explícito al equipo y estado activo (no reemitir para 'pendiente').
    if (license.hwid !== hwid) {
        return res.status(409).json({ ok: false, status: 'otro_equipo' });
    }
    if (license.estado !== 'activa') {
        return res.status(403).json({ ok: false, status: 'desconocida' });
    }
    if (license.fechaExpiracion && new Date(license.fechaExpiracion).getTime() < Date.now()) {
        return res.status(403).json({ ok: false, status: 'expirada' });
    }
    trackAnomaly(key, req.ip);
    if (!license.k) license.k = crypto.randomBytes(32).toString('hex');
    license.lastCheck = new Date().toISOString();
    saveJson(DATA_FILE, data);
    const token = issueLicenseToken(license);
    const updateInfo = readJson(UPDATE_INFO_FILE, null);
    res.json({ ok: true, status: 'activa', token, plan: license.plan, expirationDate: license.fechaExpiracion || null, update: updateInfo });
});

// Trial firmado por servidor y ligado a HWID (no se reinicia borrando un archivo local).
apiRouter.post('/trial', activationLimiter, (req, res) => {
    const { hwid, systemName } = req.body || {};
    if (!hwid || String(hwid).length < 8) return res.status(400).json({ ok: false, error: 'HWID inválido.' });

    if (isUnsafeMapKey(String(hwid))) return res.status(400).json({ ok: false, error: 'HWID inválido.' });
    const trials = readJson(TRIALS_FILE, { trials: {} });
    const now = Date.now();
    let t = safeMapGet(trials.trials, hwid);
    if (!t) {
        const expEpoch = Math.floor((now + TRIAL_DURATION_HOURS * 3600 * 1000) / 1000);
        t = { firstStart: new Date().toISOString(), expEpoch, systemName: systemName || '' };
        trials.trials[hwid] = t;
        saveJson(TRIALS_FILE, trials);
        logAccess('TRIAL_START', { hwid, ip: req.ip });
    }
    if (t.expEpoch * 1000 < now) {
        return res.status(403).json({ ok: false, status: 'trial_expirado', error: 'El período de prueba ha terminado.' });
    }
    const token = issueTrialToken(hwid, t.expEpoch);
    res.json({ ok: true, status: 'trial', token, expEpoch: t.expEpoch });
});

apiRouter.get('/update/info', (req, res) => {
    const updateInfo = readJson(UPDATE_INFO_FILE, null);
    if (!updateInfo) return res.status(404).json({ error: 'Sin info de actualización' });
    res.json(updateInfo);
});

// ------------------------------------------------------------------
// Rutas admin (requieren login admin — NO API key compartida)
// ------------------------------------------------------------------
apiRouter.post('/admin/change-password', authenticateToken, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Faltan datos' });
    if (newPassword.length < 10) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 10 caracteres' });

    const users = readJson(USERS_FILE, []);
    const idx = users.findIndex(u => u.username === req.user.username);
    if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!bcrypt.compareSync(currentPassword, users[idx].password)) {
        return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }
    users[idx].password = bcrypt.hashSync(newPassword, 12);
    saveJson(USERS_FILE, users);
    res.json({ success: true, message: 'Contraseña actualizada' });
});

// Crear licencia (única forma de generarla)
apiRouter.post('/admin/licenses', authenticateToken, requireAdmin, (req, res) => {
    const { plan, notas, dias, fechaExpiracion, cantidad } = req.body || {};
    const count = Math.min(Math.max(parseInt(cantidad || 1, 10), 1), 100);
    const data = readJson(DATA_FILE, { licenses: {} });

    let exp = null;
    if (fechaExpiracion) {
        exp = new Date(fechaExpiracion).toISOString();
    } else if (dias && parseInt(dias, 10) > 0) {
        exp = new Date(Date.now() + parseInt(dias, 10) * 24 * 3600 * 1000).toISOString();
    }

    const created = [];
    for (let i = 0; i < count; i++) {
        let key = generateLicenseKey();
        while (data.licenses[key]) key = generateLicenseKey();
        data.licenses[key] = {
            key,
            plan: plan || 'PRO',
            estado: 'pendiente',
            hwid: null,
            equipo: null,
            notas: notas || '',
            clientPhone: '',
            clientEmail: '',
            fechaCreacion: new Date().toISOString(),
            fechaActivacion: null,
            fechaExpiracion: exp,
            lastCheck: null,
            createdBy: req.user.username,
            history: [{ action: 'CREATE', by: req.user.username, date: new Date().toISOString() }],
        };
        created.push(data.licenses[key]);
    }
    saveJson(DATA_FILE, data);
    logAccess('LICENSE_CREATE', { by: req.user.username, count });
    res.json({ success: true, licenses: created });
});

// Listar licencias (búsqueda + paginación + filtro por estado)
apiRouter.get('/admin/licenses', authenticateToken, requireAdmin, (req, res) => {
    const { page = 1, limit = 20, search = '', estado = 'all' } = req.query;
    const p = Math.max(parseInt(page, 10), 1);
    const l = Math.min(Math.max(parseInt(limit, 10), 1), 200);
    const q = String(search).toLowerCase();

    const data = readJson(DATA_FILE, { licenses: {} });
    let list = Object.values(data.licenses);

    if (q) {
        list = list.filter(x =>
            (x.key || '').toLowerCase().includes(q) ||
            (x.equipo || '').toLowerCase().includes(q) ||
            (x.hwid || '').toLowerCase().includes(q) ||
            (x.notas || '').toLowerCase().includes(q));
    }
    if (estado !== 'all') list = list.filter(x => x.estado === estado);

    list.sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion));

    const total = list.length;
    const start = (p - 1) * l;
    res.json({
        licenses: list.slice(start, start + l),
        total, page: p, pages: Math.ceil(total / l), limit: l,
    });
});

apiRouter.post('/admin/licenses/revoke', authenticateToken, requireAdmin, (req, res) => {
    const { key } = req.body || {};
    const data = readJson(DATA_FILE, { licenses: {} });
    const lic = safeMapGet(data.licenses, key);
    if (!lic) return res.status(404).json({ error: 'Licencia no encontrada' });
    lic.estado = 'revocada';
    lic.history = lic.history || [];
    lic.history.push({ action: 'REVOKE', by: req.user.username, date: new Date().toISOString() });
    saveJson(DATA_FILE, data);
    logAccess('LICENSE_REVOKE', { key, by: req.user.username });
    res.json({ success: true });
});

apiRouter.post('/admin/licenses/reactivate', authenticateToken, requireAdmin, (req, res) => {
    const { key } = req.body || {};
    const data = readJson(DATA_FILE, { licenses: {} });
    const lic = safeMapGet(data.licenses, key);
    if (!lic) return res.status(404).json({ error: 'Licencia no encontrada' });
    lic.estado = lic.hwid ? 'activa' : 'pendiente';
    lic.history = lic.history || [];
    lic.history.push({ action: 'REACTIVATE', by: req.user.username, date: new Date().toISOString() });
    saveJson(DATA_FILE, data);
    logAccess('LICENSE_REACTIVATE', { key, by: req.user.username });
    res.json({ success: true });
});

// Desvincular equipo (permite reactivar en un equipo distinto; decisión manual del dueño)
apiRouter.post('/admin/licenses/unbind', authenticateToken, requireAdmin, (req, res) => {
    const { key } = req.body || {};
    const data = readJson(DATA_FILE, { licenses: {} });
    const lic = safeMapGet(data.licenses, key);
    if (!lic) return res.status(404).json({ error: 'Licencia no encontrada' });
    lic.hwid = null;
    lic.equipo = null;
    lic.estado = 'pendiente';
    lic.history = lic.history || [];
    lic.history.push({ action: 'UNBIND', by: req.user.username, date: new Date().toISOString() });
    saveJson(DATA_FILE, data);
    logAccess('LICENSE_UNBIND', { key, by: req.user.username });
    res.json({ success: true });
});

apiRouter.delete('/admin/licenses', authenticateToken, requireAdmin, (req, res) => {
    const { key } = req.body || {};
    const data = readJson(DATA_FILE, { licenses: {} });
    if (!safeMapGet(data.licenses, key)) return res.status(404).json({ error: 'Licencia no encontrada' });
    delete data.licenses[key];
    saveJson(DATA_FILE, data);
    logAccess('LICENSE_DELETE', { key, by: req.user.username });
    res.json({ success: true });
});

apiRouter.post('/update/publish', authenticateToken, requireAdmin, (req, res) => {
    const { version, downloadUrl, mandatory, changelog, description, sha256, signature } = req.body || {};
    if (!version || !downloadUrl) return res.status(400).json({ error: 'Faltan datos' });
    // Fase 12: exigir hash + firma del binario para que el cliente pueda verificarlo (anti-RCE).
    if (!sha256 || !signature) {
        return res.status(400).json({ error: 'Faltan sha256 y signature del binario (requeridos para publicar una actualización firmada).' });
    }
    const updateInfo = {
        version, downloadUrl,
        sha256, signature,
        mandatory: mandatory || false,
        changelog: changelog || [],
        description: description || '',
        releaseDate: new Date().toISOString(),
    };
    saveJson(UPDATE_INFO_FILE, updateInfo);
    logAccess('UPDATE_PUBLISH', { by: req.user.username, version });
    res.json({ success: true, message: 'Actualización publicada', data: updateInfo });
});

app.use('/api', apiRouter);
app.use('/admin-licencias/api', apiRouter);

app.get(['/', '/admin', '/dashboard', '/admin-licencias', '/admin-licencias/*'], (req, res) => {
    if (req.path.includes('/api/')) return res.status(404).json({ error: 'Not found' });
    const file = path.join(__dirname, 'public', 'admin.html');
    if (fs.existsSync(file)) res.sendFile(file); else res.status(404).send('Missing admin.html');
});

app.listen(PORT, HOST, () => console.log(`Servidor de licencias escuchando en http://${HOST}:${PORT}`));
