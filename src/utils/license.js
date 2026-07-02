// src/utils/license.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { machineIdSync } = require('node-machine-id');
const os = require('os');
const { loadSettings } = require('./settings');
const { getDataBasePath } = require('./settings');

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

const { TRIAL_SECRET_KEY, HIST_SECRET } = require('../config');
const TRIAL_DURATION_HOURS = 72;

// 🧠 Ruta legacy (como estaba antes)
const legacyTrialFilePath = path.join(getDataBasePath(), 'sys.dat');

// 🧠 Nueva ruta camuflada: uploads/.sys/init.dat
function resolveTrialFilePath() {
  const basePath = getDataBasePath();
  const uploadsBasePath = path.join(basePath, 'uploads');
  const hiddenDir = path.join(uploadsBasePath, '.sys');
  const newTrialFilePath = path.join(hiddenDir, 'init.dat');

  try {
    // Asegurar carpeta uploads/.sys
    if (!fs.existsSync(uploadsBasePath)) {
      fs.mkdirSync(uploadsBasePath, { recursive: true });
    }
    if (!fs.existsSync(hiddenDir)) {
      fs.mkdirSync(hiddenDir, { recursive: true });
    }

    // Migrar archivo viejo sys.dat -> init.dat si existe y aún no hay init.dat
    if (!fs.existsSync(newTrialFilePath) && fs.existsSync(legacyTrialFilePath)) {
      try {
        const legacyData = fs.readFileSync(legacyTrialFilePath);
        fs.writeFileSync(newTrialFilePath, legacyData);
        // opcional: puedes borrar el viejo sys.dat si quieres
        // fs.unlinkSync(legacyTrialFilePath);
        console.log('Migrado sys.dat a uploads/.sys/init.dat');
      } catch (e) {
        console.error('Error migrando sys.dat a init.dat:', e.message);
      }
    }
  } catch (e) {
    console.error('Error preparando carpeta de prueba:', e.message);
  }

  return newTrialFilePath;
}

// 👇 Siempre que necesitemos el archivo, resolvemos la ruta actual
function getTrialFilePath() {
  return resolveTrialFilePath();
}

let hardwareId = null;

const FALLBACK_ID_FILE = 'device.id';

function getFallbackHardwareId() {
  try {
    const filePath = path.join(getDataBasePath(), FALLBACK_ID_FILE);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8').trim();
    }
    // Generate new if not exists
    const newId = crypto.randomUUID();
    fs.writeFileSync(filePath, newId, 'utf8');
    return newId;
  } catch (e) {
    console.error('Error gestionando ID de respaldo:', e);
    return 'error-fatal-id';
  }
}

function getEnhancedMachineId() {
  let baseId = '';
  try {
    baseId = machineIdSync({ original: true });
  } catch (error) {
    baseId = getFallbackHardwareId();
  }

  // Añadimos información única de hardware (CPU y Serial de Placa Base) para evitar colisiones en clonaciones
  // Eliminamos la dirección MAC porque cambia al cambiar de red Wifi, causando inestabilidad.
  let extraHardwareInfo = '';
  try {
    const cpus = os.cpus();
    if (cpus && cpus.length > 0) {
      extraHardwareInfo += cpus[0].model;
    }

    // En Windows, obtenemos el número de serie de la placa base o BIOS, que son muy estables.
    // NOTA: wmic fue eliminado en Windows 11 22H2+. Usamos PowerShell como alternativa.
    if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        let serial = '';

        // Intentar obtener Serial de la Placa Base vía PowerShell
        try {
          serial = execSync(
            'powershell -NoProfile -NonInteractive -Command "(Get-WmiObject Win32_BaseBoard).SerialNumber"',
            { encoding: 'utf8', timeout: 5000 }
          ).trim();
        } catch (e1) {
          // Si falla, intentar con el Serial de la BIOS
          try {
            serial = execSync(
              'powershell -NoProfile -NonInteractive -Command "(Get-WmiObject Win32_BIOS).SerialNumber"',
              { encoding: 'utf8', timeout: 5000 }
            ).trim();
          } catch (e2) {
            console.warn("No se pudo obtener serial de hardware vía PowerShell:", e2.message);
          }
        }

        if (serial && serial !== 'To be filled by O.E.M.' && serial.length > 2) {
          extraHardwareInfo += serial;
        }
      } catch (e) {
        console.warn("No se pudo obtener serial de hardware:", e.message);
      }
    }
  } catch (e) {
    console.warn("No se pudo obtener la información extra del hardware:", e.message);
  }

  if (extraHardwareInfo !== '') {
    // Generar un hash combinado del Machine ID base + HW info extra estable
    return crypto.createHash('sha256').update(baseId + extraHardwareInfo).digest('hex');
  }

  return baseId;
}

function getLegacyHardwareIds() {
  const possibleIds = [];
  try {
    const baseId = machineIdSync({ original: true });
    const cpus = os.cpus();
    const cpuModel = (cpus && cpus.length > 0) ? cpus[0].model : '';
    const interfaces = os.networkInterfaces();
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
          const legacyHash = crypto.createHash('sha256').update(baseId + cpuModel + iface.mac).digest('hex');
          possibleIds.push(legacyHash);
        }
      }
    }
  } catch (e) {}
  return possibleIds;
}

function getHardwareId() {
  if (!hardwareId) {
    hardwareId = getEnhancedMachineId();
  }
  return hardwareId;
}

function getBiosSerial() {
  let serial = '';
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      // Intentar obtener Serial de la Placa Base vía PowerShell
      try {
        serial = execSync(
          'powershell -NoProfile -NonInteractive -Command "(Get-WmiObject Win32_BaseBoard).SerialNumber"',
          { encoding: 'utf8', timeout: 5000 }
        ).trim();
      } catch (e1) {
        // Si falla, intentar con el Serial de la BIOS
        try {
          serial = execSync(
            'powershell -NoProfile -NonInteractive -Command "(Get-WmiObject Win32_BIOS).SerialNumber"',
            { encoding: 'utf8', timeout: 5000 }
          ).trim();
        } catch (e2) {}
      }
    } catch (e) {}
  }
  return serial || 'unknown-serial';
}

function encryptData(text, keyString) {
  try {
    const key = crypto.createHash('sha256').update(keyString).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (e) {
    return null;
  }
}

function decryptData(encryptedText, keyString) {
  try {
    const key = crypto.createHash('sha256').update(keyString).digest();
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return null;
  }
}

function getHistoryPaths() {
  const paths = [];
  try {
    paths.push(path.join(getDataBasePath(), 'uploads', '.sys', 'win-metadata.dat'));
  } catch (e) {}

  try {
    const localAppData = process.env.LOCALAPPDATA || 
      (process.platform === 'win32' ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : null);
    if (localAppData) {
      paths.push(path.join(localAppData, 'Microsoft', 'Feeds', 'feeds-cache.db'));
    }
  } catch (e) {}
  
  return paths;
}

function saveActivationHistory(licenseKey, payload) {
  try {
    const fingerprint = {
      baseId: machineIdSync({ original: true }),
      fallbackId: getFallbackHardwareId(),
      biosSerial: getBiosSerial(),
      cpuModel: os.cpus() && os.cpus().length > 0 ? os.cpus()[0].model : 'unknown-cpu'
    };

    const record = {
      licenseKey,
      hwid: payload.hwid,
      exp: payload.exp,
      activatedAt: new Date().toISOString(),
      fingerprint
    };

    let history = [];
    const paths = getHistoryPaths();
    for (const filePath of paths) {
      if (fs.existsSync(filePath)) {
        try {
          const encryptedText = fs.readFileSync(filePath, 'utf8');
          const decrypted = decryptData(encryptedText, HIST_SECRET);
          if (decrypted) {
            const parsed = JSON.parse(decrypted);
            if (Array.isArray(parsed)) {
              history = parsed;
              break;
            }
          }
        } catch (e) {}
      }
    }

    const exists = history.some(r => r.licenseKey === licenseKey && r.hwid === payload.hwid);
    if (!exists) {
      history.push(record);
    }

    const encryptedText = encryptData(JSON.stringify(history), HIST_SECRET);
    if (!encryptedText) return false;

    for (const filePath of paths) {
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, encryptedText, 'utf8');
      } catch (err) {
        // Ignorar silenciosamente en producción
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

function checkActivationHistory(licenseKey) {
  try {
    const paths = getHistoryPaths();
    let history = [];
    for (const filePath of paths) {
      if (fs.existsSync(filePath)) {
        try {
          const encryptedText = fs.readFileSync(filePath, 'utf8');
          const decrypted = decryptData(encryptedText, HIST_SECRET);
          if (decrypted) {
            const parsed = JSON.parse(decrypted);
            if (Array.isArray(parsed)) {
              history = parsed;
              break;
            }
          }
        } catch (e) {}
      }
    }

    if (history.length === 0) return false;

    const record = history.find(r => r.licenseKey === licenseKey);
    if (!record) return false;

    const currentBaseId = machineIdSync({ original: true });
    const currentFallbackId = getFallbackHardwareId();
    const currentBiosSerial = getBiosSerial();

    const fp = record.fingerprint || {};

    const baseMatch = fp.baseId && fp.baseId === currentBaseId;
    const fallbackMatch = fp.fallbackId && fp.fallbackId === currentFallbackId;
    const biosMatch = fp.biosSerial && fp.biosSerial !== 'unknown-serial' && fp.biosSerial === currentBiosSerial;

    if (baseMatch || fallbackMatch || biosMatch) {
      console.log(`[LICENCIA] HWID mismatch tolerado mediante historial. Coincidencias: base=${baseMatch}, fallback=${fallbackMatch}, bios=${biosMatch}`);
      return true;
    }

    console.warn('[LICENCIA] Registro de historial encontrado, pero ningún parámetro de hardware coincide.');
    return false;
  } catch (e) {
    return false;
  }
}

function verifyLicense(licenseKey) {
  if (!licenseKey || PUBLIC_KEY.includes('PEGA AQUÍ')) {
    console.error('Verificación fallida: La llave pública no ha sido configurada.');
    return false;
  }

  const parts = licenseKey.split('.');
  if (parts.length !== 2) {
    console.error('Error de formato: La licencia no tiene el formato payload.signature.');
    return false;
  }

  const [payloadBase64, signatureBase64] = parts;
  let payload;

  try {
    const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf8');
    payload = JSON.parse(payloadJson);
  } catch (error) {
    console.error('Error al decodificar la licencia (payload inválido):', error.message);
    return false;
  }

  if (!payload.hwid || !payload.exp) {
    console.error('Error de formato: La licencia no contiene hwid o exp.');
    return false;
  }

  try {
    // SECURITY UPDATE: Check Enhanced HWID, Original, Hashed, AND Fallback HWIDs
    let localHardwareEnhanced = module.exports.getHardwareId();

    let localHardwareId;
    try {
      localHardwareId = machineIdSync({ original: true });
    } catch (e) { localHardwareId = 'error'; }

    let localHardwareIdHashed;
    try {
      localHardwareIdHashed = machineIdSync({ original: false });
    } catch (e) { localHardwareIdHashed = 'error'; }

    let localHardwareIdFallback = getFallbackHardwareId();

    // Use RSA-SHA256 explicitly
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(JSON.stringify(payload));
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    const isSignatureValid = verifier.verify(PUBLIC_KEY, signatureBuffer);

    if (!isSignatureValid) {
      console.error('Verificación fallida: La firma de la licencia es inválida (Clave Pública incorrecta o datos alterados).');
      return false;
    }

    // Allow match on:
    // 1. The new Enhanced Stable ID
    // 2. Any Legacy MAC-based ID (to handle Wi-Fi switches and silent migration)
    // 3. Raw Machine ID variants
    const legacyIds = getLegacyHardwareIds();
    const isLegacyMatch = legacyIds.includes(payload.hwid);

    if (payload.hwid !== localHardwareEnhanced &&
      !isLegacyMatch &&
      payload.hwid !== localHardwareId &&
      payload.hwid !== localHardwareIdHashed &&
      payload.hwid !== localHardwareIdFallback) {
      
      // Fallback check against the encrypted activation history
      if (!checkActivationHistory(licenseKey)) {
        console.error(`Verificación fallida: HWID mismatch. Licencia: ${payload.hwid} | Local Enhanced: ${localHardwareEnhanced}`);
        return false;
      }
    }

    const [year, month, day] = payload.exp.split('-').map(Number);
    const expDate = new Date(year, month - 1, day, 23, 59, 59);
    const today = new Date();

    if (today > expDate) {
      console.error(`Verificación fallida: La licencia expiró el ${payload.exp}.`);
      return false;
    }

    // Guardar en el historial de forma segura tras validación exitosa
    saveActivationHistory(licenseKey, payload);

    // console.log(`Licencia válida. Expira el: ${payload.exp}`);
    return true;
  } catch (error) {
    console.error('Error durante la verificación de la licencia:', error.message);
    return false;
  }
}

function writeTrialData(data) {
  try {
    const trialFilePath = getTrialFilePath();
    const dataString = JSON.stringify(data);
    const hmac = crypto.createHmac('sha256', TRIAL_SECRET_KEY).update(dataString).digest('hex');
    const saveObject = { data, hmac };
    const base64Data = Buffer.from(JSON.stringify(saveObject)).toString('base64');
    fs.writeFileSync(trialFilePath, base64Data);
    return true;
  } catch (e) {
    console.error("Error al escribir archivo de prueba:", e);
    return false;
  }
}

function readTrialData() {
  try {
    const trialFilePath = getTrialFilePath();
    if (!fs.existsSync(trialFilePath)) {
      return null;
    }

    const base64Data = fs.readFileSync(trialFilePath, 'utf8');
    const saveDataJson = Buffer.from(base64Data, 'base64').toString('utf8');
    const saveObject = JSON.parse(saveDataJson);

    if (!saveObject.data || !saveObject.hmac) {
      console.error('Archivo de prueba corrupto: Faltan datos o hmac.');
      return null;
    }

    const dataString = JSON.stringify(saveObject.data);
    const expectedHmac = crypto.createHmac('sha256', TRIAL_SECRET_KEY).update(dataString).digest('hex');

    if (saveObject.hmac !== expectedHmac) {
      console.error('Archivo de prueba manipulado: El HMAC no coincide.');
      return null;
    }

    return saveObject.data;
  } catch (e) {
    console.error("Error al leer/decodificar archivo de prueba:", e.message);
    return null;
  }
}

function checkTrialStatus() {
  const now = new Date();
  const trialFilePath = getTrialFilePath();

  if (!fs.existsSync(trialFilePath)) {
    const trialData = {
      firstRun: now.toISOString(),
      lastRun: now.toISOString()
    };
    const success = writeTrialData(trialData);
    if (!success) {
      return { active: false, message: 'Error al iniciar la prueba. Faltan permisos.' };
    }
    console.log('Iniciando período de prueba de 72 horas.');
    return { active: true, message: 'Prueba iniciada.' };
  }

  const data = readTrialData();

  if (data === null) {
    return { active: false, message: 'Archivo de prueba corrupto o manipulado. Prueba finalizada.' };
  }

  try {
    const firstRun = new Date(data.firstRun);
    const lastRun = new Date(data.lastRun);

    if (now < new Date(lastRun.getTime() - (2 * 60 * 60 * 1000))) {
      console.warn('Posible alteración del reloj detectada.');
      return { active: false, message: 'Reloj del sistema alterado. Prueba finalizada.' };
    }

    const expirationTime = firstRun.getTime() + (TRIAL_DURATION_HOURS * 60 * 60 * 1000);
    const expirationDate = new Date(expirationTime);

    if (now.getTime() > expirationTime) {
      console.log('Período de prueba finalizado.');
      return {
        active: false,
        message: `Tu período de prueba de 72 horas ha terminado (Expiró el ${expirationDate.toLocaleString()}).`
      };
    }

    // Modificar datos de prueba para incluir onlineStatus
    data.lastRun = now.toISOString();
    writeTrialData(data);
    const hoursRemaining = (expirationTime - now.getTime()) / (1000 * 60 * 60);
    return { active: true, message: `Prueba activa. Quedan ${hoursRemaining.toFixed(1)} horas.` };

  } catch (e) {
    console.error("Error al procesar fechas de prueba:", e);
    return { active: false, message: 'Error al leer datos de la prueba.' };
  }
}

// Guarda el estado de la licencia online de forma segura
function setOnlineLicense(isActive) {
  let data = readTrialData();
  const now = new Date();

  // If reading fails because of corruption, try to reset if we are activating?
  // But safer to respect null
  if (!data) {
    // Attempt to recover if we are setting Active=true? 
    // Risky, might bypass trial.
    // For now, assume trial file exists.
    data = { firstRun: now.toISOString(), lastRun: now.toISOString() };
  }

  // Agregamos/Actualizamos el campo de licencia online
  if (isActive) {
    data.onlineLicense = {
      active: true,
      activationDate: now.toISOString(),
      lastCheck: now.toISOString()
    };
  } else {
    // Only delete if it exists
    if (data.onlineLicense) delete data.onlineLicense;
  }

  writeTrialData(data);
  return true;
}

function getAppStatus() {
  const settings = loadSettings();
  const licenseKey = settings.licenseKey || '';

  // 1. Prioridad: Licencia Offline (Clave Cifrada)
  if (verifyLicense(licenseKey)) {
    return { status: 'LICENSED', message: 'Licencia activa (Offline).' };
  }

  // 2. Revisar licencia Online almacenada (HMAC protegido)
  const trialData = readTrialData();
  if (trialData && trialData.onlineLicense && trialData.onlineLicense.active) {
    return { status: 'LICENSED', message: 'Licencia activa (Online).' };
  }

  // 3. Fallback: Modo Prueba
  const trial = checkTrialStatus();

  if (trial.active) {
    return { status: 'TRIAL', message: trial.message };
  } else {
    return { status: 'EXPIRED', message: trial.message };
  }
}

module.exports = {
  getHardwareId,
  verifyLicense,
  getAppStatus,
  setOnlineLicense
};
