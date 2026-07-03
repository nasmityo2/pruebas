// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Fase 11.9 (anti-manipulación): whitelist EXPLÍCITA de canales IPC.
// Antes, `api.invoke/send/receive` eran genéricos y el renderer (o un XSS) podía
// invocar CUALQUIER handler registrado. Ahora solo se permiten canales conocidos.
// Los canales de impresión/shell/ventana viven en sus propios puentes tipados abajo.
const ALLOWED_INVOKE = new Set(['app:restart']);
const ALLOWED_SEND = new Set();     // (ninguno en uso hoy)
const ALLOWED_RECEIVE = new Set();  // (ninguno en uso hoy)

contextBridge.exposeInMainWorld('api', {
  send: (channel, data) => {
    if (!ALLOWED_SEND.has(channel)) {
      console.warn('[preload] canal send no permitido:', channel);
      return;
    }
    ipcRenderer.send(channel, data);
  },
  receive: (channel, func) => {
    if (!ALLOWED_RECEIVE.has(channel)) {
      console.warn('[preload] canal receive no permitido:', channel);
      return;
    }
    ipcRenderer.on(channel, (event, ...args) => func(...args));
  },
  invoke: (channel, data) => {
    if (!ALLOWED_INVOKE.has(channel)) {
      console.warn('[preload] canal invoke no permitido:', channel);
      return Promise.reject(new Error('Canal IPC no permitido.'));
    }
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


