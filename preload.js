// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// API genérica (ya la tenías)
contextBridge.exposeInMainWorld('api', {
  send: (channel, data) => {
    ipcRenderer.send(channel, data);
  },
  receive: (channel, func) => {
    ipcRenderer.on(channel, (event, ...args) => func(...args));
  },
  // NUEVO: soporte para ipcRenderer.invoke/handle
  invoke: (channel, data) => {
    return ipcRenderer.invoke(channel, data);
  }
});

// API específica para impresión directa desde el renderer (POS)
contextBridge.exposeInMainWorld('electronPrinter', {
  /**
   * Obtiene la lista de impresoras instaladas en el sistema.
   * Devuelve una promesa que resuelve en { ok: boolean, printers?: any[], error?: string }
   */
  getPrinters: () => {
    return ipcRenderer.invoke('printer:getPrinters');
  },

  /**
   * Envía un ticket de texto a una impresora específica (o a la predeterminada si no se pasa nombre).
   * options: { printerName?: string, text: string, type?: 'RAW' | 'TEXT' }
   * Devuelve una promesa que resuelve en { ok: boolean, jobId?: any, error?: string }
   */
  printTextTicket: (options) => {
    return ipcRenderer.invoke('printer:printText', options);
  },

  /**
   * Imprime contenido HTML de forma silenciosa para evitar diálogos y márgenes.
   */
  printHTML: (options) => {
    return ipcRenderer.invoke('printer:printHTML', options);
  },

  /**
   * Genera un PDF a partir de HTML y pide al usuario dónde guardarlo.
   */
  savePDF: (options) => {
    return ipcRenderer.invoke('printer:savePDF', options);
  }
});

// API para abrir URLs en el navegador del sistema (NO en el Chromium interno de Electron)
// Necesario para WhatsApp Web y otros servicios incompatibles con versiones antiguas de Chromium
contextBridge.exposeInMainWorld('electronShell', {
  /**
   * Abre una URL en el navegador predeterminado del sistema operativo.
   * Funciona en Windows 7+ con el navegador instalado (Chrome, Firefox, Edge, etc.)
   * @param {string} url - URL a abrir (debe comenzar con https://)
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  openExternal: (url) => {
    return ipcRenderer.invoke('shell:openExternal', url);
  }
});

// API para control de ventana personalizada
contextBridge.exposeInMainWorld('electronWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close')
});


