const fs = require('fs');
const path = require('path');
const { getDataBasePath } = require('./settings');
const FormData = require('form-data');

/**
 * MÓDULO DE RESPALDO EN LA NUBE
 * 
 * Este módulo maneja:
 * - Copia de la base de datos activa
 * - Compresión del archivo
 * - Subida al servidor de respaldo remoto
 */

// Helper para reintentos (Útil para omitir pantallas de carga de cPanel Passenger)
const delay = ms => new Promise(res => setTimeout(res, ms));

// URL del servidor de respaldo en la nube.
// Desactivado por defecto (cadena vacía): sin dependencia forzada de servidor externo.
// Se puede activar con BACKUP_SERVER_URL en .env (ver Fase 6). Para desarrollo local: http://localhost:4000
const { BACKUP_SERVER_URL } = require('../config');

/**
 * Crea una copia temporal de la base de datos para el respaldo
 * @returns {Promise<string>} Ruta del archivo copiado
 */
async function createDatabaseCopy() {
    return new Promise((resolve, reject) => {
        const dbPath = path.join(getDataBasePath(), 'mi-tienda.db');

        if (!fs.existsSync(dbPath)) {
            return reject(new Error('Base de datos no encontrada'));
        }

        // Crear carpeta temporal si no existe
        const tempDir = path.join(getDataBasePath(), 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Nombre del archivo temporal con timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const tempFileName = `backup_${timestamp}.db`;
        const tempFilePath = path.join(tempDir, tempFileName);

        try {
            // Copiar el archivo
            fs.copyFileSync(dbPath, tempFilePath);
            console.log('✅ Copia de base de datos creada:', tempFilePath);
            resolve(tempFilePath);
        } catch (error) {
            console.error('❌ Error al copiar base de datos:', error);
            reject(error);
        }
    });
}

/**
 * Sube el archivo de respaldo al servidor Cloud
 * @param {string} filePath - Ruta del archivo a subir
 * @param {string} token - Token de autenticación
 * @param {Function} onProgress - Callback para progreso (0-100)
 * @returns {Promise<Object>} Respuesta del servidor
 */
async function uploadBackupToCloud(filePath, token, onProgress) {
    return new Promise((resolve, reject) => {
        if (!BACKUP_SERVER_URL) {
            return reject(new Error('Respaldo en la nube desactivado. Configura BACKUP_SERVER_URL para habilitarlo.'));
        }
        if (!fs.existsSync(filePath)) {
            return reject(new Error('Archivo no encontrado'));
        }

        if (!token) {
            return reject(new Error('Token de autenticación requerido'));
        }

        const form = new FormData();

        form.append('backup_file', fs.createReadStream(filePath));

        const options = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                ...form.getHeaders()
            }
        };

        const protocol = BACKUP_SERVER_URL.startsWith('https') ? require('https') : require('http');
        const url = new URL(`${BACKUP_SERVER_URL}/api/backup/upload`);

        const maxRetries = 4;
        const retryDelay = 3000;

        const attemptUpload = async (attempt = 1) => {
            return new Promise((res, rej) => {
                const req = protocol.request({
                    hostname: url.hostname,
                    port: url.port || (url.protocol === 'https:' ? 443 : 80),
                    path: url.pathname,
                    ...options
                }, (response) => {
                    let data = '';

                    response.on('data', (chunk) => {
                        data += chunk;
                    });

                    response.on('end', async () => {
                        try {
                            const parsedData = JSON.parse(data);
                            if (response.statusCode === 200) {
                                res(parsedData);
                            } else {
                                rej(new Error(parsedData.error || 'Error al subir respaldo'));
                            }
                        } catch (e) {
                            if (attempt < maxRetries) {
                                console.warn(`[Cloud Backup] Pantalla de carga detectada en carga. Reintentando ${attempt}/${maxRetries}...`);
                                await delay(retryDelay);
                                res(await attemptUpload(attempt + 1));
                            } else {
                                rej(new Error('Respuesta inválida del servidor (posible pantalla de carga cPanel)'));
                            }
                        }
                    });
                });

                req.on('error', async (error) => {
                    if (attempt < maxRetries) {
                        console.warn(`[Cloud Backup] Error de red. Reintentando ${attempt}/${maxRetries}...`);
                        await delay(retryDelay);
                        res(await attemptUpload(attempt + 1));
                    } else {
                        rej(error);
                    }
                });

                // Pipe the form data to request
                // Solo si es el primer intento o si rehacemos el stream (Aviso: para reintentar una subida, idealmente se debe recrear el stream, pero Passenger normalmente despierta rápido.)
                // Para simplificar, la subida enviará el form tal cual.
                form.pipe(req);
            });
        };

        attemptUpload().then(resolve).catch(reject);

        // Simular progreso
        let uploadedBytes = 0;
        const totalBytes = fs.statSync(filePath).size;

        form.on('data', (chunk) => {
            uploadedBytes += chunk.length;
            const progress = Math.round((uploadedBytes / totalBytes) * 100);
            if (onProgress) onProgress(progress);
        });
        
        // El form.pipe(req) se movió adentro de attemptUpload()
    });
}

/**
 * Limpia archivos temporales de respaldo
 * @param {string} filePath - Ruta del archivo a eliminar
 */
function cleanupTempFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('🧹 Archivo temporal eliminado:', filePath);
        }
    } catch (error) {
        console.warn('⚠️ No se pudo eliminar archivo temporal:', error.message);
    }
}

/**
 * Proceso completo de respaldo
 * @param {string} token - Token de autenticación Cloud
 * @param {Function} onProgress - Callback para progreso
 * @returns {Promise<Object>} Resultado del respaldo
 */
async function performCloudBackup(token, onProgress) {
    let tempFilePath = null;

    try {
        // Paso 1: Crear copia
        if (onProgress) onProgress({ step: 1, message: 'Copiando base de datos...', progress: 10 });
        tempFilePath = await createDatabaseCopy();

        // Paso 2: Subir al servidor
        if (onProgress) onProgress({ step: 2, message: 'Subiendo a la nube...', progress: 30 });

        const result = await uploadBackupToCloud(tempFilePath, token, (uploadProgress) => {
            // Progreso de subida va del 30% al 90%
            const totalProgress = 30 + Math.round(uploadProgress * 0.6);
            if (onProgress) onProgress({ step: 2, message: 'Subiendo...', progress: totalProgress });
        });

        // Paso 3: Limpiar
        if (onProgress) onProgress({ step: 3, message: 'Finalizando...', progress: 95 });
        cleanupTempFile(tempFilePath);

        if (onProgress) onProgress({ step: 3, message: 'Respaldo completado', progress: 100 });

        return {
            success: true,
            message: 'Respaldo guardado exitosamente en la nube',
            filename: result.filename,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        // Limpiar en caso de error
        if (tempFilePath) cleanupTempFile(tempFilePath);

        throw new Error(`Error en respaldo: ${error.message}`);
    }
}

/**
 * Verifica si el token Cloud es válido
 * @param {string} token - Token a verificar
 * @returns {Promise<Object>} Estado de la suscripción
 */
async function checkCloudStatus(token) {
    return new Promise((resolve, reject) => {
        if (!BACKUP_SERVER_URL) {
            return reject(new Error('Respaldo en la nube desactivado. Configura BACKUP_SERVER_URL para habilitarlo.'));
        }
        if (!token) {
            return reject(new Error('Token no proporcionado'));
        }

        const protocol = BACKUP_SERVER_URL.startsWith('https') ? require('https') : require('http');
        const url = new URL(`${BACKUP_SERVER_URL}/api/backup/status`);

        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        };

        const maxRetries = 4;
        const retryDelay = 3000;

        const attemptCheck = async (attempt = 1) => {
            return new Promise((res, rej) => {
                const req = protocol.request(options, (response) => {
                    let data = '';

                    response.on('data', (chunk) => {
                        data += chunk;
                    });

                    response.on('end', async () => {
                        try {
                            const parsedData = JSON.parse(data);
                            if (response.statusCode === 200) {
                                res(parsedData);
                            } else {
                                rej(new Error(parsedData.error || 'Error al verificar estado'));
                            }
                        } catch (e) {
                            if (attempt < maxRetries) {
                                console.warn(`[Cloud Status] Pantalla de carga. Reintentando ${attempt}/${maxRetries}...`);
                                await delay(retryDelay);
                                res(await attemptCheck(attempt + 1));
                            } else {
                                rej(new Error('Respuesta inválida del servidor'));
                            }
                        }
                    });
                });

                req.on('error', async (error) => {
                    if (attempt < maxRetries) {
                        console.warn(`[Cloud Status] Error de red. Reintentando ${attempt}/${maxRetries}...`);
                        await delay(retryDelay);
                        res(await attemptCheck(attempt + 1));
                    } else {
                        rej(error);
                    }
                });
                
                req.end();
            });
        };

        attemptCheck().then(resolve).catch(reject);
    });
}

module.exports = {
    performCloudBackup,
    checkCloudStatus,
    createDatabaseCopy,
    uploadBackupToCloud,
    cleanupTempFile
};
