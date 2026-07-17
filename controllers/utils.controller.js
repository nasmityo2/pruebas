// controllers/utils.controller.js
const os = require('os');
const qrcode = require('qrcode');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { isLanEnabled, saveNetworkConfig, createLanToken } = require('../src/utils/network');

let downloadProgress = {
    percent: 0,
    completed: false,
    error: null
};

const getLocalIp = async (req, res) => {
  try {
    let port = req.query.port;
    if (!port) {
      const host = req.headers.host || ''; 
      const parts = host.split(':');
      if (parts.length === 2) {
        port = parts[1];
      }
    }
    if (!port && global.dynamicPort) {
      port = String(global.dynamicPort);
    }
    if (!port) {
      port = '53050';
    }

    // El acceso móvil requiere el modo LAN activado (opt-in).
    if (!isLanEnabled()) {
      return res.json({
        success: false,
        urls: [],
        qrCodeDataURL: null,
        lanEnabled: false,
        message: 'El acceso desde el móvil está desactivado. Actívalo en Configuración (requiere reiniciar la app).',
      });
    }

    // Token temporal de conexión (expira). Se incluye en la URL/QR.
    const { token } = createLanToken();

    const interfaces = os.networkInterfaces();
    const urls = [];
    let firstUrl = null;

    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          const url = `http://${net.address}:${port}/?lt=${token}`;
          urls.push(url);
          if (!firstUrl) firstUrl = url;
        }
      }
    }

    if (firstUrl) {
      const qrCodeDataURL = await qrcode.toDataURL(firstUrl);
      res.json({ success: true, urls, qrCodeDataURL, lanEnabled: true });
    } else {
      res.json({ success: false, urls: [], qrCodeDataURL: null, message: 'No se encontró IP local.' });
    }
  } catch (error) {
    console.error('Error al generar QR o IP:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const downloadUpdate = async (req, res) => {
    // Fase 12 (anti-RCE): NO se acepta una URL arbitraria del cliente. Solo se descarga la
    // actualización PUBLICADA por el dueño (global.latestUpdate viene del servidor de
    // licencias vía heartbeat, tras login admin) y que traiga hash + firma para verificar.
    const published = global.latestUpdate;
    if (!published || !published.downloadUrl) {
        return res.status(400).json({ error: 'No hay una actualización publicada y verificada disponible.' });
    }
    if (!published.sha256 || !published.signature) {
        return res.status(400).json({ error: 'La actualización publicada no está firmada; se rechaza por seguridad.' });
    }
    const { url } = req.body || {};
    if (url && url !== published.downloadUrl) {
        return res.status(403).json({ error: 'La URL solicitada no coincide con la actualización publicada.' });
    }
    const downloadUrl = published.downloadUrl;
    // Metadatos de verificación que exigirá executeUpdate.
    global.pendingUpdateMeta = { sha256: published.sha256, signature: published.signature, version: published.version };

    // Reset progress
    downloadProgress = { percent: 0, completed: false, error: null };
    
    // Ruta temporal para el instalador
    const tempDir = os.tmpdir();
    const fileName = `StokkoUpdate_${Date.now()}.exe`;
    const filePath = path.join(tempDir, fileName);
    global.downloadedInstallerPath = filePath;

    try {
        console.log(`[UPDATER] Iniciando descarga de: ${downloadUrl}`);
        const response = await axios({
            method: 'GET',
            url: downloadUrl,
            responseType: 'stream'
        });

        const totalLength = response.headers['content-length'];
        let downloadedLength = 0;

        const writer = fs.createWriteStream(filePath);
        
        response.data.on('data', (chunk) => {
            downloadedLength += chunk.length;
            if (totalLength) {
                downloadProgress.percent = (downloadedLength / totalLength) * 100;
            }
        });

        response.data.pipe(writer);

        writer.on('finish', () => {
            console.log(`[UPDATER] Descarga completada: ${filePath}`);
            downloadProgress.completed = true;
            downloadProgress.percent = 100;
        });

        writer.on('error', (err) => {
            console.error('[UPDATER] Error escribiendo archivo:', err);
            downloadProgress.error = err.message;
        });

        res.json({ success: true, message: 'Descarga iniciada' });

    } catch (error) {
        console.error('[UPDATER] Error al descargar:', error.message);
        downloadProgress.error = error.message;
        res.status(500).json({ error: error.message });
    }
};

const getDownloadProgress = (req, res) => {
    res.json(downloadProgress);
};

const executeUpdate = (req, res) => {
    const filePath = global.downloadedInstallerPath;
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(400).json({ error: 'Instalador no encontrado' });
    }

    // Fase 12 (anti-RCE): verificar HASH + FIRMA del binario ANTES de ejecutarlo.
    // Sin firma válida del dueño => se aborta y se borra el archivo.
    try {
        const { verifyUpdateFile } = require('../src/security/updateVerify');
        const { getPublicKey } = require('../src/utils/license');
        const meta = global.pendingUpdateMeta || {};
        const fileBuffer = fs.readFileSync(filePath);
        const result = verifyUpdateFile({
            fileBuffer,
            expectedSha256: meta.sha256,
            signatureB64: meta.signature,
            publicKey: getPublicKey(),
        });
        if (!result.ok) {
            console.error(`[UPDATER] Verificación de firma FALLÓ (${result.reason}). No se ejecuta.`);
            try { fs.unlinkSync(filePath); } catch (_) { /* noop */ }
            global.downloadedInstallerPath = null;
            return res.status(400).json({ error: `Actualización no verificada (${result.reason}). Se abortó por seguridad.` });
        }
    } catch (e) {
        console.error('[UPDATER] Error verificando la actualización:', e.message);
        return res.status(500).json({ error: 'No se pudo verificar la actualización.' });
    }

    console.log(`[UPDATER] Firma verificada. Ejecutando instalador: ${filePath}`);

    // Ejecutar el instalador de forma independiente (detached)
    const child = spawn(filePath, [], {
        detached: true,
        stdio: 'ignore',
        shell: false 
    });

    child.unref();

    res.json({ success: true, message: 'Cerrando aplicación e instalando...' });

    // Cerrar la aplicación después de un breve delay para permitir que el frontend reciba la respuesta
    setTimeout(() => {
        process.exit(0);
    }, 2000);
};

const getQrCode = async (req, res) => {
  try {
    const { text } = req.query;
    if (!text) return res.status(400).json({ error: 'Falta texto para el QR' });
    const qrDataURL = await qrcode.toDataURL(text);
    res.json({ success: true, qrDataURL });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const configureFirewall = async (req, res) => {
  try {
    // Solo se abre el ÚNICO puerto en uso (no un rango) y solo bajo acción explícita del usuario.
    const port = parseInt(req.body && req.body.port, 10) || global.dynamicPort || 53050;
    if (port < 1024 || port > 65535) {
      return res.status(400).json({ success: false, error: 'Puerto inválido.' });
    }

    const scriptPath = path.join(os.tmpdir(), `stokko-firewall-${port}.bat`);
    const scriptContent = `@echo off\r\n:: Check for administrative privileges\r\nnet session >nul 2>&1\r\nif %errorLevel% == 0 (\r\n    echo [INFO] Ejecutando como administrador...\r\n) else (\r\n    echo [ERROR] Por favor, ejecuta este archivo como Administrador.\r\n    pause\r\n    exit /b\r\n)\r\n\r\necho [INFO] Abriendo el puerto ${port} para Stokko (solo red local)...\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-NetFirewallRule -DisplayName 'Stokko - Servidor POS' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName 'Stokko - Servidor POS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -Profile Private -Description 'Permite conexion en red local para Stokko' -ErrorAction SilentlyContinue"\r\n\r\necho [SUCCESS] Regla de firewall creada para el puerto ${port}.\r\necho Ya puedes cerrar esta ventana.\r\npause\r\n`;
    fs.writeFileSync(scriptPath, scriptContent, 'utf-8');

    const runCommand = `Start-Process -FilePath "${scriptPath}" -Verb RunAs`;

    const { exec } = require('child_process');
    await new Promise((resolve) => {
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${runCommand.replace(/"/g, '\\"')}"`, (error) => {
        if (error) {
          console.error('Error al ejecutar el script de firewall:', error);
          res.status(500).json({ success: false, error: 'No se pudo iniciar el proceso de elevación.' });
        } else {
          res.json({ success: true, message: `Se solicitó permiso de administrador para abrir el puerto ${port}.` });
        }
        resolve();
      });
    });
  } catch (error) {
    console.error('Error en configureFirewall:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Estado del modo LAN.
const getLanStatus = (req, res) => {
  res.json({ success: true, lanEnabled: isLanEnabled() });
};

// Activar/desactivar el modo LAN (requiere reiniciar para reenlazar el puerto).
const setLanMode = (req, res) => {
  const enabled = !!(req.body && req.body.enabled);
  saveNetworkConfig({ lanEnabled: enabled });
  res.json({
    success: true,
    lanEnabled: enabled,
    requiresRestart: true,
    message: enabled
      ? 'Modo LAN activado. Reinicia Stokko para aplicar. Recuerda escanear el QR desde el móvil.'
      : 'Modo LAN desactivado. Reinicia Stokko para dejar de escuchar en la red.',
  });
};

module.exports = {
  getLocalIp,
  getQrCode,
  downloadUpdate,
  getDownloadProgress,
  executeUpdate,
  configureFirewall,
  getLanStatus,
  setLanMode
};
