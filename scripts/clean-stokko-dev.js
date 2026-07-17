// scripts/clean-stokko-dev.js
// Elimina TODOS los datos generados por Stokko en desarrollo, dejando
// la app como recién instalada (sin base de datos, sin licencia, sin cachés).
//
// Ejecutar:  node scripts/clean-stokko-dev.js       (desde npm: npm run clean:dev)
// Recuerda cerrar la app antes de ejecutar (si está abierta los archivos estarán bloqueados).

const fs = require('fs');
const path = require('path');
const os = require('os');

let deletedCount = 0;
let errorCount = 0;

function rmdirRecursive(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`  ✓ ${dir}`);
    deletedCount++;
  } catch (e) {
    // Si falla la carpeta entera, intentamos archivo por archivo
    console.warn(`  ~ Error con la carpeta completa: ${e.message}`);
    console.warn(`  ~ Intentando archivo por archivo…`);
    try {
      const walk = (d) => {
        let entries;
        try { entries = fs.readdirSync(d); } catch { return; }
        for (const entry of entries) {
          const full = path.join(d, entry);
          try {
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
              walk(full);
              try { fs.rmdirSync(full); } catch {}
            } else {
              try {
                fs.unlinkSync(full);
                deletedCount++;
              } catch (e2) {
                console.error(`  ✗ No se pudo eliminar: ${full}`);
                console.error(`    Motivo: ${e2.message}`);
                errorCount++;
              }
            }
          } catch {
            // entrada ya no existe
          }
        }
      };
      walk(dir);
    } catch (_) {}
  }
}

function unlinkIfExists(file) {
  if (!fs.existsSync(file)) return;
  try {
    fs.unlinkSync(file);
    console.log(`  ✓ ${file}`);
    deletedCount++;
  } catch (e) {
    console.error(`  ✗ ${file}: ${e.message}`);
    errorCount++;
  }
}

console.log('');
console.log('===========================================');
console.log('  Stokko — Limpieza completa a estado cero');
console.log('===========================================');

// ─── 1. Carpeta principal de datos (APPDATA) ───
const appDataDir =
  process.env.APPDATA ||
  path.join(process.env.USERPROFILE, 'AppData', 'Roaming');
const stokkoData = path.join(appDataDir, 'Stokko_Data');

console.log('\n[1/4] Carpeta de datos — %APPDATA%\\Stokko_Data');
console.log(`      Ruta: ${stokkoData}`);
rmdirRecursive(stokkoData);

// ─── 2. Archivos temporales del firewall ───
const tmpDir = os.tmpdir();
console.log(`\n[2/4] Archivos temporales — %TEMP%\\stokko-firewall-*.bat`);
console.log(`      Ruta: ${tmpDir}`);
try {
  const tmpFiles = fs.readdirSync(tmpDir);
  for (const f of tmpFiles) {
    if (f.startsWith('stokko-firewall-') && f.endsWith('.bat')) {
      unlinkIfExists(path.join(tmpDir, f));
    }
  }
} catch (e) {
  console.error(`  ✗ Error leyendo temp: ${e.message}`);
  errorCount++;
}

// ─── 3. Cachés de Electron / Chromium (LOCALAPPDATA) ───
const localAppData =
  process.env.LOCALAPPDATA ||
  path.join(process.env.USERPROFILE, 'AppData', 'Local');
const electronCacheDirs = [
  path.join(localAppData, 'Stokko'),
  path.join(localAppData, 'stokko'),
  path.join(localAppData, 'electron-builder', 'Cache'),
];

console.log('\n[3/4] Cachés de Electron — %LOCALAPPDATA%');
for (const dir of electronCacheDirs) {
  console.log(`      ${dir}`);
  rmdirRecursive(dir);
}

// ─── 4. Archivos sueltos en public/uploads del proyecto ───
const uploadsDev = path.join(__dirname, '..', 'public', 'uploads');
console.log(`\n[4/4] Uploads locales — public/uploads`);
console.log(`      Ruta: ${uploadsDev}`);
if (fs.existsSync(uploadsDev)) {
  try {
    const entries = fs.readdirSync(uploadsDev);
    for (const entry of entries) {
      const fullPath = path.join(uploadsDev, entry);
      if (entry === '.gitkeep' || entry === '.gitignore') continue;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          unlinkIfExists(fullPath);
        } else if (stat.isDirectory()) {
          rmdirRecursive(fullPath);
        }
      } catch {
        // entrada ya no existe
      }
    }
  } catch (e) {
    console.error(`  ✗ Error leyendo uploads: ${e.message}`);
    errorCount++;
  }
} else {
  console.log('      (no existe)');
}

// ─── Resumen ───
console.log('\n───────────────────────────────────────────');
console.log(`  Eliminados: ${deletedCount} archivos/carpetas`);
if (errorCount > 0) {
  console.log(`  Errores:    ${errorCount}`);
  console.log('');
  console.log('  ⚠ Algunos archivos no se pudieron eliminar.');
  console.log('  Posibles causas:');
  console.log('  • Stokko sigue abierta → ciérrala y vuelve a ejecutar');
  console.log('  • El archivo está en uso por otro proceso');
  console.log('───────────────────────────────────────────');
} else {
  console.log('  ✅ Todo limpio. La app quedó como recién instalada.');
  console.log('───────────────────────────────────────────');
}
console.log('');
