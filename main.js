const fs = require('fs');
const path = require('path');

// Forzar el directorio de trabajo al del ejecutable (evita fallos de acceso directo)
try {
  process.chdir(path.dirname(process.execPath));
} catch (err) {
  // Ignorar
}

// Directorios de log (Inmediato para depurar)
const appName = 'BodegApp_Data';
const appData = process.env.APPDATA || 
               (process.platform === 'win32' ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming') : 
               (process.platform === 'darwin' ? path.join(process.env.HOME, 'Library', 'Application Support') : '/var/local'));

const logDir = path.join(appData, appName);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, 'startup_error.log');

try {
  fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] DEBUG: main.js iniciado. CWD: ${process.cwd()}\n`);
} catch (e) {}

const { app, BrowserWindow, ipcMain, shell, dialog, Menu, Tray } = require('electron');

// Fase 11.9: en el build empaquetado marcamos entorno de producción. server.js (cargado
// más adelante en el mismo proceso) usa NODE_ENV para NO filtrar detalles de error al cliente.
try {
  if (app && app.isPackaged) process.env.NODE_ENV = 'production';
} catch (_) { /* noop */ }

// --- GPU COMPATIBILITY FIX (Desactivado para permitir aceleración por hardware) ---
// Prevenir crash fatal del proceso GPU (exit_code=-1073741515 / 0xC0000135)
// que ocurre cuando faltan DLLs de DirectX/ANGLE en algunos PCs con Windows.
// app.commandLine.appendSwitch('disable-gpu');
// app.commandLine.appendSwitch('disable-gpu-compositing');
// app.commandLine.appendSwitch('disable-gpu-sandbox');
// app.commandLine.appendSwitch('disable-software-rasterizer');
// app.commandLine.appendSwitch('no-sandbox');
// app.disableHardwareAcceleration();

function logError(msg) {
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const time = new Date().toISOString();
    const formattedMsg = `[${time}] ${msg}\n`;
    fs.appendFileSync(logPath, formattedMsg);
  } catch (e) {
    // 
  }
}

// Registro inicial INMEDIATO
logError(`--- INICIO DE PROCESO ---`);
logError(`Versión: ${app.getVersion()}`);
logError(`Plataforma: ${process.platform}`);
logError(`Arch: ${process.arch}`);

// Redirigir console.log, error y warn para capturar TODO en el archivo de log con seguridad
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function safeStringify(arg) {
  try {
    if (typeof arg === 'object' && arg !== null) {
      return JSON.stringify(arg);
    }
    return String(arg);
  } catch (e) {
    return `[Object Error: ${e.message}]`;
  }
}

console.log = (...args) => {
  try {
    logError(`[LOG] ${args.map(safeStringify).join(' ')}`);
  } catch (e) {}
  originalLog(...args);
};

console.error = (...args) => {
  try {
    logError(`[ERROR] ${args.map(safeStringify).join(' ')}`);
  } catch (e) {}
  originalError(...args);
};

console.warn = (...args) => {
  try {
    logError(`[WARN] ${args.map(safeStringify).join(' ')}`);
  } catch (e) {}
  originalWarn(...args);
};

process.on('uncaughtException', (err) => {
  const errorMessage = `FALLO CRITICO NO CONTROLADO: ${err.message}\n${err.stack}`;
  logError(errorMessage);
  
  try {
    if (app && app.isReady()) {
      dialog.showErrorBox('Error de Inicio - BodegApp', `Lo sentimos, la aplicación no pudo iniciar.\n\nError: ${err.message}\n\nRevisa el archivo startup_error.log en AppData para más detalles.`);
    }
    if (app) app.quit();
  } catch (e) {
    // 
  }
});

// Fase 14: registrar rechazos de promesa no manejados (heartbeats, impresión, updates).
// Solo se LOGUEA; no se mata el proceso, para no tumbar la app por un fallo de red aislado.
process.on('unhandledRejection', (reason) => {
  try {
    const msg = reason && reason.stack ? reason.stack : String(reason);
    logError(`PROMESA RECHAZADA NO MANEJADA: ${msg}`);
  } catch (e) {
    // 
  }
});

try {
  logError('Cargando dependencias...');
  const portfinder = require('portfinder');
  const { migrateFromProgramData } = require('./src/utils/migration');
  logError('Dependencias básicas cargadas.');

  let win;
  let tray = null;
  let isQuitting = false;

  // Configura los canales IPC relacionados con impresión y sistema
  function setupIpcHandlers() {
    try {
      // --- Reusable Print Functions ---
      async function getPrinters() {
        try {
          if (!win || win.isDestroyed()) {
            return { ok: false, error: 'La ventana principal no está disponible.' };
          }
          const printers = await win.webContents.getPrintersAsync();
          return { ok: true, printers };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      }

      async function printText(options) {
        const { printerName, text, binary } = options || {};
        if (binary !== undefined) {
          return { ok: false, error: 'La impresión binaria RAW no está permitida.' };
        }
        if (typeof text !== 'string' || text.length === 0 || text.length > 1024 * 1024) {
          return { ok: false, error: 'El texto de impresión es inválido o demasiado grande.' };
        }
        const escaped = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
        return printHTML({
          printerName,
          pageSize: 'A4',
          html: `<!doctype html><meta charset="utf-8"><style>body{margin:0;font-family:monospace;white-space:pre-wrap}</style><body>${escaped}</body>`,
        });
      }

      async function printHTML(options) {
        const { html, printerName, landscape, pageSize } = options || {};
        const workerWin = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
        try {
          await workerWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
          const result = await new Promise((resolve) => {
            workerWin.webContents.print({
              silent: true,
              printBackground: true,
              deviceName: printerName || '',
              landscape: landscape || false,
              margins: { marginType: 'none' },
              pageSize: pageSize || 'A4'
            }, (success, failureReason) => resolve({ success, failureReason }));
          });
          workerWin.close();
          return result.success ? { ok: true } : { ok: false, error: result.failureReason };
        } catch (error) {
          if (!workerWin.isDestroyed()) workerWin.close();
          return { ok: false, error: error.message };
        }
      }

      // Store in a shared object for server.js access
      app.printHandlers = { getPrinters, printText, printHTML };

      if (!ipcMain) {
        logError('ERROR: ipcMain NO está disponible en setupIpcHandlers');
        return;
      }

      ipcMain.handle('printer:getPrinters', getPrinters);
      ipcMain.handle('printer:printText', (event, options) => printText(options));
      ipcMain.handle('printer:printHTML', (event, options) => printHTML(options));

      ipcMain.handle('app:restart', () => {
        app.relaunch();
        app.exit(0);
      });

      ipcMain.handle('printer:savePDF', async (event, options) => {
        const { html, fileName } = options || {};
        // Usamos una ventana oculta para renderizar el HTML del ticket
        const workerWin = new BrowserWindow({ 
          show: false, 
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } 
        });
        
        try {
          await workerWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
          
          // Generar el Buffer del PDF
          const pdfBuffer = await workerWin.webContents.printToPDF({
            marginsType: 1, // Sin márgenes (el CSS del ticket ya tiene sus propios márgenes)
            pageSize: 'A4', // Formato estándar
            printBackground: true
          });

          const { filePath } = await dialog.showSaveDialog({
            title: 'Guardar Recibo en PDF',
            defaultPath: fileName || 'recibo.pdf',
            filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }]
          });

          if (filePath) {
            fs.writeFileSync(filePath, pdfBuffer);
            workerWin.close();
            return { ok: true, filePath };
          }
          
          workerWin.close();
          return { ok: false, error: 'Operación cancelada por el usuario.' };
        } catch (error) {
          if (!workerWin.isDestroyed()) workerWin.close();
          return { ok: false, error: error.message };
        }
      });

      ipcMain.handle('shell:openExternal', async (event, url) => {
        try {
          if (typeof url !== 'string' || !url.startsWith('https://')) return { ok: false, error: 'URL inválida.' };
          await shell.openExternal(url);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      });

      ipcMain.handle('window:minimize', () => {
        if (win) win.minimize();
      });

      ipcMain.handle('window:maximize', () => {
        if (win) {
          if (win.isMaximized()) {
            win.unmaximize();
          } else {
            win.maximize();
          }
        }
      });

      ipcMain.handle('window:close', () => {
        if (win) win.close();
      });

    } catch (err) {
      logError(`Error registrando manejadores IPC: ${err.message}`);
    }
  }

  function createTray() {
    try {
      const iconPath = path.join(__dirname, 'public', 'images', 'icon.ico');
      tray = new Tray(iconPath);
      const contextMenu = Menu.buildFromTemplate([
        { 
          label: 'Abrir BodegApp', 
          click: () => {
            if (win) win.show();
          } 
        },
        { type: 'separator' },
        { 
          label: 'Salir', 
          click: () => {
            isQuitting = true;
            app.quit();
          } 
        }
      ]);
      tray.setToolTip('BodegApp - Sistema de Gestión');
      tray.setContextMenu(contextMenu);
      
      tray.on('double-click', () => {
        if (win) win.show();
      });
      logError('System Tray creado correctamente.');
    } catch (err) {
      logError(`Error creando System Tray: ${err.message}`);
    }
  }

  function createWindow(port) {
    logError(`Cerrando proceso de inicio: Creando ventana principal en puerto ${port}...`);
    const iconPath = path.join(__dirname, 'public', 'images', 'icon.ico');
    logError(`Ruta del icono: ${iconPath} (Existe: ${fs.existsSync(iconPath)})`);

    win = new BrowserWindow({
      width: 1200,
      height: 800,
      frame: false, // Habilitar marco personalizado sin bordes nativos
      show: true, // Asegurarnos de que sea true por defecto
      icon: iconPath,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        // Fase 11.9: DevTools solo en desarrollo; deshabilitadas en el build empaquetado.
        devTools: !app.isPackaged
      }
    });

    // Refuerzo: si algo intenta abrir DevTools en producción, cerrarlas.
    if (app.isPackaged) {
      win.webContents.on('devtools-opened', () => {
        try { win.webContents.closeDevTools(); } catch (_) { /* noop */ }
      });
    }

    if (!tray) {
      createTray();
    }

    const url = `http://localhost:${port}`;
    logError(`Cargando URL: ${url}`);
    
    win.loadURL(url)
      .then(() => {
        logError('URL cargada correctamente en la ventana principal.');
      })
      .catch(err => {
        logError(`ERROR al cargar la URL: ${err.message}`);
      });

    win.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault();
        win.hide();
      }
      return false;
    });

    win.on('closed', () => { 
      logError('La ventana principal ha sido cerrada.');
      win = null; 
    });

    // Detectar si la ventana falla al mostrarse
    win.once('ready-to-show', () => {
      logError('Ventana lista para mostrarse (ready-to-show).');
      win.show();
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      logError(`FALLO DE CARGA en webContents: ${errorCode} - ${errorDescription}`);
    });
  }

  function startServer() {
    logError('Iniciando búsqueda de puerto...');
    portfinder.basePort = 53050;
    portfinder.getPortPromise()
      .then(async (port) => {
        logError(`Puerto encontrado: ${port}. Cargando server.js...`);
        try {
          const server = require('./server.js');
          logError('server.js cargado. Iniciando servidor...');
          const finalPort = await server.start(port, app.printHandlers);
          logError(`Servidor iniciado en puerto: ${finalPort}`);
          createWindow(finalPort);
        } catch (err) {
          logError(`Error fatal iniciando el servidor: ${err.message}\n${err.stack}`);
          app.quit();
        }
      })
      .catch((err) => {
        logError(`No se pudo encontrar puerto libre: ${err.message}`);
        app.quit();
      });
  }

  async function runElectronShellSmoke() {
    if (app.isPackaged) {
      throw new Error('El smoke aislado del shell Electron solo puede ejecutarse en desarrollo.');
    }
    const smokeWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false,
      },
    });
    await smokeWindow.loadURL('data:text/html;charset=utf-8,%3Ctitle%3EStokko%20Smoke%3C%2Ftitle%3E');
    originalLog('[STOKKO_ELECTRON_SMOKE_OK]');
    smokeWindow.destroy();
    app.quit();
  }

  app.whenReady().then(async () => {
    logError('App ready. Iniciando migraciones...');
    try {
      if (process.env.STOKKO_ELECTRON_SMOKE === '1') {
        await runElectronShellSmoke();
        return;
      }
      // Fase 11.8: self-check de integridad SOLO en el build empaquetado (producción).
      // Si algún archivo crítico fue manipulado o falta la firma válida, se bloquea.
      if (app.isPackaged) {
        try {
          const integrity = require('./src/security/integrity');
          const { getPublicKey } = require('./src/utils/license');
          const result = integrity.runSelfCheck({ baseDir: __dirname, publicKey: getPublicKey() });
          if (!result.ok) {
            logError(`[INTEGRITY] Self-check FALLÓ: ${result.reason} ${JSON.stringify(result.mismatches || [])}`);
            dialog.showErrorBox('BodegApp - Integridad', 'Se detectó una modificación no autorizada de la aplicación. Reinstala desde el instalador original.');
            app.quit();
            return;
          }
          logError('[INTEGRITY] Self-check OK.');
        } catch (e) {
          logError(`[INTEGRITY] Error en self-check: ${e.message}`);
          dialog.showErrorBox('BodegApp - Integridad', 'No se pudo verificar la integridad de la aplicación.');
          app.quit();
          return;
        }
      }
      await migrateFromProgramData();
      logError('Migraciones completadas.');
      setupIpcHandlers();
      startServer();
    } catch (err) {
      logError(`Error en app.ready: ${err.message}\n${err.stack}`);
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    // A.6: detener timers de fondo para evitar fugas al cerrar.
    try {
      const bcvPath = require.resolve('./src/services/bcvUpdater');
      const loadedBcv = require.cache[bcvPath];
      if (loadedBcv) loadedBcv.exports.stopScheduler();
    } catch (_) { /* noop */ }
    try {
      const backupPath = require.resolve('./src/utils/localBackup');
      const loadedBackup = require.cache[backupPath];
      if (loadedBackup) loadedBackup.exports.stopBackupScheduler();
    } catch (_) { /* noop */ }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

} catch (err) {
  logError(`ERROR FATAL DURANTE CARGA: ${err.message}\n${err.stack}`);
  if (app && app.isReady()) {
    dialog.showErrorBox('Error Fatal', `La aplicación no pudo iniciar.\n\n${err.message}`);
    app.quit();
  }
}
