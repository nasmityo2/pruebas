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
    executableName: 'Stokko',
    icon: './public/images/icon', // Electron Forge will auto-append .ico on Windows
    win32metadata: {
      CompanyName: 'Codigo Creativo',
      FileDescription: 'Stokko - Sistema de gestión',
      InternalName: 'stokko',
      OriginalFilename: 'Stokko.exe',
      ProductName: 'Stokko',
    },
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
        name: 'Stokko',
        shortName: 'Stokko',
        exe: 'Stokko',
        appUserModelId: 'com.codigocreativo.stokko',
        shortcutFolderName: 'Stokko',
        programFilesFolderName: 'Stokko',
        upgradeCode: 'c1ecaa7a-17be-462f-b7d1-6a44bbf89884',
        manufacturer: 'Codigo Creativo',
        description: 'Stokko - Sistema de gestión para comercios',
        icon: './public/images/icon.ico',
        appIconPath: './public/images/icon.ico',
        arch: arch === 'ia32' ? 'x86' : arch, // WiX uses 'x86' instead of 'ia32'
        ui: {
          chooseDirectory: true,
        },
      }),
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
  ],
};
