module.exports = {
  packagerConfig: {
    asar: true,
    icon: './public/images/icon', // Electron Forge will auto-append .ico on Windows
    // Stronger ignore patterns for Windows compatibility using a filter function
    ignore: (filePath) => {
      const normalizedPath = filePath.replace(/\\/g, '/');
      const projectRoot = __dirname.replace(/\\/g, '/');

      // 1. Ignore existing packaged ASARs & unpacked folders in root
      if (normalizedPath.endsWith('.asar') || normalizedPath.includes('.asar.unpacked')) {
        return true;
      }

      // 2. Ignore build tools in node_modules
      if (normalizedPath.includes('/node_modules/@electron-forge/') ||
          normalizedPath.includes('/node_modules/@electron/') ||
          normalizedPath.includes('/node_modules/electron-winstaller/') ||
          normalizedPath.includes('/node_modules/electron-squirrel-startup/') ||
          normalizedPath.includes('/node_modules/electron-packager/') ||
          normalizedPath.includes('/node_modules/electron-wix-msi/')) {
        return true;
      }

      // 3. Ignore root-level directories
      const ignoredRootFolders = [
        'UpdateServer', 'BodegAppUpdater', 'temp_extracted', 'license-server',
        'mobile_client', 'out', 'dist', 'build', 'test-electron',
        'nodejs-assets', 'tmp', 'Compras', 'updater', 'respaldo', '.git', '.agent', '.vscode'
      ];
      for (const folder of ignoredRootFolders) {
        if (normalizedPath.startsWith(projectRoot + '/' + folder)) {
          return true;
        }
      }

      // 4. Ignore developmental file extensions
      const ignoredExtensions = ['.md', '.xls', '.xlsx', '.txt', '.log', '.db', '.sqlite', '.lic', '.zip', '.wixobj', '.wixpdb', '.wxs'];
      if (ignoredExtensions.some(ext => normalizedPath.toLowerCase().endsWith(ext))) {
        return true;
      }

      // 5. Ignore specific developmental scripts/files
      const ignoredFiles = [
        '/generate_offline_license.js',
        '/check_arch.js',
        '/check_db.js',
        '/inspect_excel.js',
        '/test_deps.js',
        '/gen_qrroot.js',
        '/convert_list.js',
        '/reset_import.js',
        '/debug_import_logic.js',
        '/.npmrc',
        '/packaged_package.json'
      ];
      if (ignoredFiles.some(file => normalizedPath.endsWith(file))) {
        return true;
      }

      return false;
    }
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
