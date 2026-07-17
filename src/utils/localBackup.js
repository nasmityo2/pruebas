// src/utils/localBackup.js
// Respaldos LOCALES cifrados (Fase 6).
// - Backups cifrados con AES-256-GCM usando una clave local dedicada (backup.key, gitignored).
// - Manual y automático programable.
// - La restauración es destructiva: exige clave admin (gate en la ruta) y reinicio de la app.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDataBasePath } = require('./settings');

const MAGIC = Buffer.from('BGAB1\n'); // cabecera de formato de backup cifrado
const SQLITE_HEADER = Buffer.from('SQLite format 3\u0000', 'binary');

function dbPath() { return path.join(getDataBasePath(), 'mi-tienda.db'); }
function backupsDir() {
  const dir = path.join(getDataBasePath(), 'backups', 'local');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Clave de cifrado de backups: aleatoria, generada una vez y guardada con permisos restringidos.
function getBackupKey() {
  const keyPath = path.join(getDataBasePath(), 'backup.key');
  try {
    if (fs.existsSync(keyPath)) {
      const b = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64');
      if (b.length === 32) return b;
    }
  } catch (_) { /* regenerar */ }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key.toString('base64'), { mode: 0o600 });
  return key;
}

function encryptBuffer(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, enc]);
}

function decryptBuffer(buf, key) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Formato de respaldo no reconocido.');
  }
  const iv = buf.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = buf.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const enc = buf.subarray(MAGIC.length + 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

function createLocalBackup(reason = 'manual') {
  const src = dbPath();
  if (!fs.existsSync(src)) throw new Error('Base de datos no encontrada.');
  const plain = fs.readFileSync(src);
  const encrypted = encryptBuffer(plain, getBackupKey());
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupsDir(), `backup-${ts}.bgab`);
  fs.writeFileSync(dest, encrypted);
  pruneOldBackups();
  return { file: path.basename(dest), path: dest, size: encrypted.length, reason, date: new Date().toISOString() };
}

function listLocalBackups() {
  const dir = backupsDir();
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.bgab'))
    .map(f => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
}

function pruneOldBackups() {
  const cfg = getBackupConfig();
  const keep = Math.max(1, parseInt(cfg.keepLast, 10) || 10);
  const files = listLocalBackups();
  for (const f of files.slice(keep)) {
    try { fs.unlinkSync(path.join(backupsDir(), f.file)); } catch (_) { /* noop */ }
  }
}

// Restaura reemplazando la DB. closeDb debe cerrar la conexión antes de sobrescribir.
// Tras esto la app DEBE reiniciarse (los controladores tienen prepared statements sobre la DB vieja).
function restoreLocalBackup(filename, closeDb) {
  const safe = path.basename(filename);
  const src = path.join(backupsDir(), safe);
  if (!fs.existsSync(src)) throw new Error('Respaldo no encontrado.');

  const decrypted = decryptBuffer(fs.readFileSync(src), getBackupKey());
  // Validar que sea una base SQLite válida antes de sobrescribir.
  if (!decrypted.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
    throw new Error('El respaldo no contiene una base de datos válida.');
  }

  // Respaldo de seguridad de la DB ACTUAL antes de sobrescribir.
  const current = dbPath();
  if (fs.existsSync(current)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(current, path.join(backupsDir(), `pre-restore-${ts}.db`));
  }

  if (typeof closeDb === 'function') {
    try { closeDb(); } catch (_) { /* noop */ }
  }
  // Limpiar posibles ficheros WAL/SHM para evitar inconsistencias tras el reemplazo.
  for (const ext of ['-wal', '-shm']) {
    const p = current + ext;
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { /* noop */ }
  }
  fs.writeFileSync(current, decrypted);
  return { restored: safe, needsRestart: true };
}

// ---- Configuración de respaldos (archivo dedicado) ----
const CONFIG_DEFAULTS = { autoEnabled: true, intervalHours: 24, keepLast: 10, lastBackupAt: null };
function configPath() { return path.join(getDataBasePath(), 'backup-config.json'); }
function getBackupConfig() {
  try {
    if (!fs.existsSync(configPath())) return { ...CONFIG_DEFAULTS };
    return { ...CONFIG_DEFAULTS, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
  } catch (_) {
    return { ...CONFIG_DEFAULTS };
  }
}
function saveBackupConfig(cfg) {
  fs.writeFileSync(configPath(), JSON.stringify({ ...getBackupConfig(), ...cfg }, null, 2));
}
function setBackupConfig(partial) {
  const cfg = {};
  if (partial.autoEnabled !== undefined) cfg.autoEnabled = !!partial.autoEnabled;
  if (partial.intervalHours !== undefined) cfg.intervalHours = Math.max(1, parseInt(partial.intervalHours, 10) || 24);
  if (partial.keepLast !== undefined) cfg.keepLast = Math.max(1, parseInt(partial.keepLast, 10) || 10);
  saveBackupConfig(cfg);
  return getBackupConfig();
}
function markBackupDone() {
  saveBackupConfig({ lastBackupAt: new Date().toISOString() });
}

let backupStartupTimer = null;
let backupInterval = null;

// Programador: respalda al iniciar (si toca) y cada intervalo.
function startBackupScheduler() {
  stopBackupScheduler();
  const runIfDue = () => {
    try {
      const cfg = getBackupConfig();
      if (!cfg.autoEnabled) return;
      const last = cfg.lastBackupAt ? new Date(cfg.lastBackupAt).getTime() : 0;
      const dueMs = (cfg.intervalHours || 24) * 3600 * 1000;
      if (Date.now() - last >= dueMs) {
        const r = createLocalBackup('auto');
        markBackupDone();
        console.log('[BACKUP] Respaldo automático creado:', r.file);
      }
    } catch (e) {
      console.error('[BACKUP] Error en respaldo automático:', e.message);
    }
  };
  backupStartupTimer = setTimeout(runIfDue, 15000); // al iniciar (con margen)
  backupInterval = setInterval(runIfDue, 60 * 60 * 1000); // revisa cada hora
}

function stopBackupScheduler() {
  if (backupStartupTimer) clearTimeout(backupStartupTimer);
  if (backupInterval) clearInterval(backupInterval);
  backupStartupTimer = null;
  backupInterval = null;
}

// ---- Cifrado de credenciales de nube en reposo ----
function encryptSecretAtRest(plaintext) {
  if (!plaintext) return '';
  const out = encryptBuffer(Buffer.from(String(plaintext), 'utf8'), getBackupKey());
  return 'enc:' + out.toString('base64');
}
function decryptSecretAtRest(value) {
  if (!value) return '';
  if (!String(value).startsWith('enc:')) return value; // compat: valor en claro previo
  try {
    const buf = Buffer.from(String(value).slice(4), 'base64');
    return decryptBuffer(buf, getBackupKey()).toString('utf8');
  } catch (_) {
    return '';
  }
}

module.exports = {
  createLocalBackup,
  listLocalBackups,
  restoreLocalBackup,
  getBackupConfig,
  setBackupConfig,
  markBackupDone,
  startBackupScheduler,
  stopBackupScheduler,
  encryptSecretAtRest,
  decryptSecretAtRest,
  getBackupKey,
};
