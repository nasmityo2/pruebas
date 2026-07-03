// src/security/hwid.js
// Fase 11.4 — Huella de hardware (HWID) robusta.
// Objetivo anti-piratería: NO existe un archivo `device.id` portátil que copiar entre
// equipos. El HWID se deriva de varias señales del SO; si no hay ninguna señal FUERTE,
// se falla de forma segura (devuelve null → el cliente exige activación online) en vez de
// fabricar un identificador copiable.
//
// `combineSignals` es PURA (testeable). `collectSignals`/`computeHardwareId` hacen la I/O.
const crypto = require('crypto');
const os = require('os');

// Señales consideradas "fuertes" (ligadas al hardware/instalación del SO).
const STRONG_KEYS = ['machineId', 'machineGuid', 'boardSerial', 'biosSerial', 'volumeSerial'];
const MIN_STRONG_SIGNALS = 1;

function isMeaningful(v) {
  if (!v) return false;
  const s = String(v).trim();
  if (s.length < 3) return false;
  // Descartar placeholders típicos de BIOS/OEM sin serial real.
  const junk = ['to be filled by o.e.m.', 'none', 'default string', 'system serial number', '0', 'n/a'];
  return !junk.includes(s.toLowerCase());
}

/**
 * Combina señales del SO en un HWID SHA-256 estable.
 * Si no hay al menos MIN_STRONG_SIGNALS señales fuertes válidas => null (fail-safe).
 * @param {Object} signals
 * @returns {string|null} hash hex de 64 chars o null
 */
function combineSignals(signals) {
  const s = signals || {};
  const strong = STRONG_KEYS.filter((k) => isMeaningful(s[k]));
  if (strong.length < MIN_STRONG_SIGNALS) return null;
  // Orden fijo y explícito (no depende del orden de claves del objeto).
  const material = [
    s.machineId, s.machineGuid, s.boardSerial, s.biosSerial, s.volumeSerial,
    s.cpuModel, s.hostArch,
  ].map((v) => (v == null ? '' : String(v).trim())).join('|');
  return crypto.createHash('sha256').update(material).digest('hex');
}

function safeExec(cmd) {
  try {
    const { execSync } = require('child_process');
    return execSync(cmd, { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
  } catch (_) {
    return '';
  }
}

// Recolecta señales del SO (best-effort). En Windows usa PowerShell/registro.
function collectSignals() {
  const signals = { cpuModel: '', hostArch: `${os.platform()}-${os.arch()}` };

  try {
    const { machineIdSync } = require('node-machine-id');
    signals.machineId = machineIdSync({ original: true });
  } catch (_) { /* sin machine-id */ }

  try {
    const cpus = os.cpus();
    if (cpus && cpus.length > 0) signals.cpuModel = cpus[0].model;
  } catch (_) { /* noop */ }

  if (process.platform === 'win32') {
    // MachineGuid del registro (estable por instalación de Windows).
    const guid = safeExec('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid');
    const m = guid.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
    if (m) signals.machineGuid = m[1];

    signals.boardSerial = safeExec('powershell -NoProfile -NonInteractive -Command "(Get-WmiObject Win32_BaseBoard).SerialNumber"');
    signals.biosSerial = safeExec('powershell -NoProfile -NonInteractive -Command "(Get-WmiObject Win32_BIOS).SerialNumber"');
    // Serial del volumen del sistema (C:).
    const vol = safeExec('powershell -NoProfile -NonInteractive -Command "(Get-WmiObject Win32_LogicalDisk -Filter \\"DeviceID=\'C:\'\\").VolumeSerialNumber"');
    if (vol) signals.volumeSerial = vol;
  }
  return signals;
}

// HWID final (o null si no hay señales fuertes → fail-safe).
function computeHardwareId() {
  return combineSignals(collectSignals());
}

module.exports = {
  STRONG_KEYS,
  MIN_STRONG_SIGNALS,
  isMeaningful,
  combineSignals,
  collectSignals,
  computeHardwareId,
};
