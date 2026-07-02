// src/utils/settings.js
const fs = require('fs');
const path = require('path');

const dataBasePath = path.join(process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : '/var/local'), 'BodegApp_Data');

if (!fs.existsSync(dataBasePath)) {
  try {
    fs.mkdirSync(dataBasePath, { recursive: true });
    console.log(`Directorio de datos (AppData) creado en: ${dataBasePath}`);
  } catch (error) {
    console.error(`Error crítico creando directorio en AppData: ${error}`);
  }
}

const settingsPath = path.join(dataBasePath, 'business-settings.json');

const DEFAULT_SETTINGS = {
  businessName: "BodegApp",
  logoPath: "/images/default-logo.png",
  licenseKey: "",
  adminPasswordHash: null,

  // --- CONFIGURACIÓN DE IMPRESIÓN BÁSICA (ya la tenías) ---
  printTicket: true,   // imprimir ticket sí/no
  ticketSize: 80,      // 58 o 80 mm

  // --- NUEVO: OPCIONES AVANZADAS DE IMPRESIÓN ---
  // 'preview' = abre PDF/navegador (DEPRECATED), 'direct' = impresión directa
  printMode: "direct",
  // nombre de impresora (si está vacío se usa la predeterminada)
  printerName: "",
  // número de copias del ticket
  printCopies: 1,
  // texto de encabezado del ticket
  printHeader: "",
  // texto de pie de página del ticket
  printFooter: "",

  // --- DATOS DEL NEGOCIO (NUEVO) ---
  businessRIF: "",
  businessAddress: "",
  businessPhone: "",

  // --- NUEVO: MOSTRAR QR O LOGO ---
  printQr: true,
  printLogo: true,
  printQrContent: "https://bodegapp.com.ve",

  // --- DATOS DE CONTACTO (Primer Uso) ---
  clientPhone: "",
  clientEmail: ""
};

function loadSettings() {
  try {
    // Si no existe el archivo, lo creamos con los valores por defecto
    if (!fs.existsSync(settingsPath)) {
      saveSettings(DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }

    const data = fs.readFileSync(settingsPath, 'utf8');
    if (!data) {
      saveSettings(DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }

    const settings = JSON.parse(data);

    // Aseguramos TODOS los campos con fallback a DEFAULT_SETTINGS
    if (!settings.businessName) {
      settings.businessName = DEFAULT_SETTINGS.businessName;
    }
    if (settings.logoPath === undefined) {
      settings.logoPath = DEFAULT_SETTINGS.logoPath;
    }
    if (settings.licenseKey === undefined) {
      settings.licenseKey = DEFAULT_SETTINGS.licenseKey;
    }
    if (settings.adminPasswordHash === undefined) {
      settings.adminPasswordHash = DEFAULT_SETTINGS.adminPasswordHash;
    }
    if (settings.printTicket === undefined) {
      settings.printTicket = DEFAULT_SETTINGS.printTicket;
    }
    if (settings.ticketSize === undefined) {
      settings.ticketSize = DEFAULT_SETTINGS.ticketSize;
    }

    // NUEVOS CAMPOS DE IMPRESIÓN AVANZADA
    if (settings.printMode === undefined) {
      settings.printMode = DEFAULT_SETTINGS.printMode;
    }
    if (settings.printerName === undefined) {
      settings.printerName = DEFAULT_SETTINGS.printerName;
    }
    if (settings.printCopies === undefined) {
      settings.printCopies = DEFAULT_SETTINGS.printCopies;
    }
    if (settings.printHeader === undefined) {
      settings.printHeader = DEFAULT_SETTINGS.printHeader;
    }
    if (settings.printFooter === undefined) {
      settings.printFooter = DEFAULT_SETTINGS.printFooter;
    }
    // NUEVOS CAMPOS DE NEGOCIO
    if (settings.businessRIF === undefined) {
      settings.businessRIF = DEFAULT_SETTINGS.businessRIF;
    }
    if (settings.businessAddress === undefined) {
      settings.businessAddress = DEFAULT_SETTINGS.businessAddress;
    }
    if (settings.businessPhone === undefined) {
      settings.businessPhone = DEFAULT_SETTINGS.businessPhone;
    }

    // NUEVOS CAMPOS QR / LOGO
    if (settings.printQr === undefined) {
      settings.printQr = DEFAULT_SETTINGS.printQr;
    }
    if (settings.printLogo === undefined) {
      settings.printLogo = DEFAULT_SETTINGS.printLogo;
    }
    if (settings.printQrContent === undefined) {
      settings.printQrContent = DEFAULT_SETTINGS.printQrContent;
    }

    // NUEVOS CAMPOS DE CLIENTE (CONTACTO)
    if (settings.clientPhone === undefined) {
      settings.clientPhone = DEFAULT_SETTINGS.clientPhone;
    }
    if (settings.clientEmail === undefined) {
      settings.clientEmail = DEFAULT_SETTINGS.clientEmail;
    }

    return settings;
  } catch (error) {
    console.error('Error al cargar business-settings.json:', error);
    try {
      saveSettings(DEFAULT_SETTINGS);
    } catch (saveError) {
      console.error('Error fatal al intentar restaurar business-settings.json:', saveError);
    }
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    const settingsToSave = {
      businessName: settings.businessName || DEFAULT_SETTINGS.businessName,
      logoPath: settings.logoPath !== undefined ? settings.logoPath : DEFAULT_SETTINGS.logoPath,
      licenseKey: settings.licenseKey || DEFAULT_SETTINGS.licenseKey,
      adminPasswordHash: settings.adminPasswordHash !== undefined
        ? settings.adminPasswordHash
        : DEFAULT_SETTINGS.adminPasswordHash,

      // DATA DEL NEGOCIO
      businessRIF: settings.businessRIF || DEFAULT_SETTINGS.businessRIF,
      businessAddress: settings.businessAddress || DEFAULT_SETTINGS.businessAddress,
      businessPhone: settings.businessPhone || DEFAULT_SETTINGS.businessPhone,

      // DATA DE CONTACTO
      clientPhone: settings.clientPhone || DEFAULT_SETTINGS.clientPhone,
      clientEmail: settings.clientEmail || DEFAULT_SETTINGS.clientEmail,

      // BÁSICO
      printTicket: typeof settings.printTicket === 'boolean'
        ? settings.printTicket
        : DEFAULT_SETTINGS.printTicket,
      ticketSize: typeof settings.ticketSize === 'number'
        ? settings.ticketSize
        : DEFAULT_SETTINGS.ticketSize,

      // AVANZADO
      printMode: settings.printMode || DEFAULT_SETTINGS.printMode,
      printerName: settings.printerName || DEFAULT_SETTINGS.printerName,
      printCopies: (typeof settings.printCopies === 'number' && settings.printCopies > 0)
        ? settings.printCopies
        : DEFAULT_SETTINGS.printCopies,
      printHeader: settings.printHeader || DEFAULT_SETTINGS.printHeader,
      printFooter: settings.printFooter || DEFAULT_SETTINGS.printFooter,

      // QR / LOGO
      printQr: typeof settings.printQr === 'boolean' ? settings.printQr : DEFAULT_SETTINGS.printQr,
      printLogo: typeof settings.printLogo === 'boolean' ? settings.printLogo : DEFAULT_SETTINGS.printLogo,
      printQrContent: settings.printQrContent || DEFAULT_SETTINGS.printQrContent
    };

    const data = JSON.stringify(settingsToSave, null, 2);
    fs.writeFileSync(settingsPath, data, 'utf8');
    console.log('Configuración del negocio guardada:', settingsPath);
    return true;
  } catch (error) {
    console.error('Error al guardar business-settings.json:', error);
    return false;
  }
}

module.exports = {
  loadSettings,
  saveSettings,
  getDataBasePath: () => dataBasePath
};
