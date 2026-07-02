// controllers/utils.controller.js
const os = require('os');
const qrcode = require('qrcode');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

    const interfaces = os.networkInterfaces();
    const urls = [];
    let firstUrl = null;

    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          const url = `http://${net.address}:${port}`;
          urls.push(url);
          if (!firstUrl) firstUrl = url;
        }
      }
    }

    if (firstUrl) {
      const qrCodeDataURL = await qrcode.toDataURL(firstUrl);
      res.json({ success: true, urls, qrCodeDataURL });
    } else {
      res.json({ success: false, urls: [], qrCodeDataURL: null, message: 'No se encontró IP local.' });
    }
  } catch (error) {
    console.error('Error al generar QR o IP:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const downloadUpdate = async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL de descarga requerida' });

    // Reset progress
    downloadProgress = { percent: 0, completed: false, error: null };
    
    // Ruta temporal para el instalador
    const tempDir = os.tmpdir();
    const fileName = `BodegAppUpdate_${Date.now()}.exe`;
    const filePath = path.join(tempDir, fileName);
    global.downloadedInstallerPath = filePath;

    try {
        console.log(`[UPDATER] Iniciando descarga de: ${url}`);
        const response = await axios({
            method: 'GET',
            url: url,
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

    console.log(`[UPDATER] Ejecutando instalador: ${filePath}`);
    
    // Ejecutar el instalador de forma independiente (detached)
    // Usamos shell: true para manejar archivos .exe o scripts si fuera necesario
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
    const scriptPath = path.join(os.tmpdir(), 'configurar-firewall.bat');

    if (!fs.existsSync(scriptPath)) {
      const scriptContent = `@echo off\r\n:: Check for administrative privileges\r\nnet session >nul 2>&1\r\nif %errorLevel% == 0 (\r\n    echo [INFO] Ejecutando como administrador...\r\n) else (\r\n    echo [ERROR] Por favor, ejecuta este archivo como Administrador.\r\n    echo Haz clic derecho sobre este archivo y selecciona "Ejecutar como administrador".\r\n    pause\r\n    exit /b\r\n)\r\n\r\necho [INFO] Configurando reglas de Firewall de Windows para BodegApp...\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-NetFirewallRule -DisplayName 'BodegApp - Servidor POS' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName 'BodegApp - Servidor POS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 53050-53060 -Description 'Permite conexion en red local para el sistema POS de BodegApp' -ErrorAction SilentlyContinue"\r\n\r\necho [SUCCESS] Reglas de firewall configuradas con exito.\r\necho Ya puedes cerrar esta ventana.\r\npause\r\n`;
      fs.writeFileSync(scriptPath, scriptContent, 'utf-8');
    }

    const runCommand = `Start-Process -FilePath "${scriptPath}" -Verb RunAs`;
    
    const { exec } = require('child_process');
    await new Promise((resolve) => {
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${runCommand.replace(/"/g, '\\"')}"`, (error) => {
        if (error) {
          console.error('Error al ejecutar el script de firewall:', error);
          res.status(500).json({ success: false, error: 'No se pudo iniciar el proceso de elevación.' });
        } else {
          res.json({ success: true, message: 'Se ha abierto una ventana de consola solicitando permisos de administrador.' });
        }
        resolve();
      });
    });
  } catch (error) {
    console.error('Error en configureFirewall:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getLocalIp,
  getQrCode,
  downloadUpdate,
  getDownloadProgress,
  executeUpdate,
  configureFirewall
};
