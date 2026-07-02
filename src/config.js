// src/config.js
// Configuración central del cliente (Electron). Carga variables de entorno y
// NO usa fallback inseguro para secretos: si falta uno, la app falla de forma segura.
//
// Los secretos del cliente (TRIAL_SECRET_KEY, HIST_SECRET) son "defensa en profundidad"
// para proteger archivos locales; la verdad de la licencia vive en el servidor (ver Fase 2).
// En desarrollo se cargan desde un archivo .env en la raíz del proyecto.
// En producción se inyectan en el empaquetado (Fase 10).
const path = require('path');
const fs = require('fs');

// Cargar .env desde la raíz del proyecto y/o junto al ejecutable empaquetado.
try {
  const dotenv = require('dotenv');
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(process.cwd(), '.env'),
  ];
  try {
    if (process.execPath) candidates.push(path.join(path.dirname(process.execPath), '.env'));
  } catch (_) { /* noop */ }
  for (const p of candidates) {
    if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }
  }
} catch (_) {
  // dotenv es opcional en runtime si las variables ya están en el entorno.
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`[CONFIG] Falta la variable de entorno obligatoria: ${name}. Defínela en .env (ver .env.example).`);
  }
  return value.trim();
}

function optionalEnv(name, defaultValue) {
  const value = process.env[name];
  return (value && value.trim()) ? value.trim() : defaultValue;
}

module.exports = {
  requireEnv,
  optionalEnv,

  // Secretos del cliente (obligatorios, sin fallback en código).
  get TRIAL_SECRET_KEY() { return requireEnv('TRIAL_SECRET_KEY'); },
  get HIST_SECRET() { return requireEnv('HIST_SECRET'); },
  // Secreto HMAC del hash de clave admin local (Fase 4 lo migra a bcrypt).
  get HASH_SECRET() { return requireEnv('HASH_SECRET'); },

  // Endpoint del servidor de licencias. Default: servidor LOCAL (no dominio externo).
  get LICENSE_SERVER_URL() { return optionalEnv('LICENSE_SERVER_URL', 'http://127.0.0.1:3000'); },

  // Backup en la nube: desactivado por defecto; sin dependencia forzada de servidor externo.
  get BACKUP_SERVER_URL() { return optionalEnv('BACKUP_SERVER_URL', ''); },

  // Fallback opcional de tasas (vacío = no consultar servidor externo).
  get RATES_FALLBACK_URL() { return optionalEnv('RATES_FALLBACK_URL', ''); },
};
