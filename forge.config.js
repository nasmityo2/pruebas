const { execSync } = require('child_process');
const { shouldIgnore } = require('./scripts/packaging-ignore');

module.exports = {
  hooks: {
    // Guard anti-filtraciones: se ejecuta antes de empaquetar. Si detecta secretos, aborta.
    prePackage: async () => {
      execSync('node scripts/check-no-secrets.js', { stdio: 'inherit' });
    },
  },
  packagerConfig: {
    asar: true,
    icon: './public/images/icon', // Electron Forge will auto-append .ico on Windows
    // Predicado de exclusión compartido con el guard anti-secretos (scripts/packaging-ignore.js).
    ignore: (filePath) => {
      if (!filePath) return false;
      return shouldIgnore(filePath, __dirname);
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-wix',
      config: (arch) => ({
        language: 1033,
        manufacturer: 'Codigo Creativo',
        description: 'Sistema de gestion para emprendimientos y bodegas en Venezuela',
        icon: './public/images/icon.ico',
        appIconPath: './public/images/icon.ico',
        arch: arch === 'ia32' ? 'x86' : arch, // WiX uses 'x86' instead of 'ia32'
        ui: {
          chooseDirectory: true,
        },
      }),
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
  ],
};
