// scripts/packaging-ignore.js
// Predicado ÚNICO de exclusión para el empaquetado (Fase 10).
// Lo usan tanto forge.config.js (qué NO meter en el .asar) como el guard anti-secretos,
// para que ambos coincidan exactamente.
const path = require('path');

const IGNORED_ROOT_FOLDERS = [
  'UpdateServer', 'StokkoUpdater', 'temp_extracted', 'stokko-license-server',
  'mobile_client', 'out', 'dist', 'build', 'test-electron',
  'nodejs-assets', 'tmp', 'Compras', 'updater', 'respaldo',
  '.git', '.agent', '.vscode', '.cursor',
  // Añadidos Fase 10: nada de esto debe viajar en el cliente empaquetado.
  'test', 'docs', 'scratch', 'backups', 'scripts',
];

const IGNORED_EXTENSIONS = [
  '.md', '.xls', '.xlsx', '.txt', '.log', '.db', '.sqlite', '.sqlite3',
  '.lic', '.zip', '.wixobj', '.wixpdb', '.wxs',
  // Añadidos Fase 10: secretos/llaves nunca se empaquetan.
  '.key', '.pem',
];

const IGNORED_FILES = [
  '/generate_offline_license.js', '/check_arch.js', '/check_db.js',
  '/inspect_excel.js', '/test_deps.js', '/gen_qrroot.js', '/convert_list.js',
  '/reset_import.js', '/debug_import_logic.js', '/.npmrc', '/packaged_package.json',
];

const IGNORED_NODE_MODULES = [
  '/node_modules/@electron-forge/', '/node_modules/@electron/',
  '/node_modules/electron-winstaller/', '/node_modules/electron-squirrel-startup/',
  '/node_modules/electron-packager/', '/node_modules/electron-wix-msi/',
];

function shouldIgnore(filePath, projectRoot) {
  const normalizedPath = String(filePath).replace(/\\/g, '/');
  const root = String(projectRoot).replace(/\\/g, '/').replace(/\/+$/, '');
  const relativePath = normalizedPath.startsWith(root)
    ? normalizedPath.slice(root.length)
    : (normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`);
  const base = path.basename(normalizedPath);

  if (normalizedPath.endsWith('.asar') || normalizedPath.includes('.asar.unpacked')) return true;

  if (IGNORED_NODE_MODULES.some(p => normalizedPath.includes(p))) return true;

  for (const folder of IGNORED_ROOT_FOLDERS) {
    if (relativePath === `/${folder}` || relativePath.startsWith(`/${folder}/`)) return true;
  }

  // .env y variantes (pero permitir .env.example como plantilla sin secretos).
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return true;

  const lower = normalizedPath.toLowerCase();
  if (IGNORED_EXTENSIONS.some(ext => lower.endsWith(ext))) return true;

  if (IGNORED_FILES.some(file => normalizedPath.endsWith(file))) return true;

  return false;
}

module.exports = { shouldIgnore, IGNORED_ROOT_FOLDERS, IGNORED_EXTENSIONS };
