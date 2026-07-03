// server.js
const fastifyLib = require('fastify');
const path = require('path');
const fs = require('fs');

// ----- MOCK EXPRESS IN NODE LOADER -----
// NECESARIO (revisado en Fase 7): todos los archivos de `routes/*.js` se escriben con la API
// estilo Express (express.Router().get/post/...). Este shim captura esas rutas para adaptarlas
// a Fastify (ver adaptController / registerExpressRouter). Eliminarlo obligaría a reescribir
// todas las rutas; se mantiene intencionalmente.
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id === 'express') {
    return {
      Router: () => ({
        stack: [],
        get(path, ...handlers) { this.stack.push({ method: 'GET', path, handlers }); },
        post(path, ...handlers) { this.stack.push({ method: 'POST', path, handlers }); },
        put(path, ...handlers) { this.stack.push({ method: 'PUT', path, handlers }); },
        delete(path, ...handlers) { this.stack.push({ method: 'DELETE', path, handlers }); },
        patch(path, ...handlers) { this.stack.push({ method: 'PATCH', path, handlers }); },
      })
    };
  }
  return originalRequire.apply(this, arguments);
};

// ----- IMPORT DATABASE AND UTILS -----
const { initializeDB } = require('./src/database');
const { getDataBasePath } = require('./src/utils/settings');
const { startScheduler } = require('./src/services/bcvUpdater');

// ----- PREPARAR CARPETA uploads -----
const uploadsBasePath = path.join(getDataBasePath(), 'uploads');
if (!fs.existsSync(uploadsBasePath)) {
  try {
    fs.mkdirSync(uploadsBasePath, { recursive: true });
    console.log(`Carpeta uploads creada/verificada en: ${uploadsBasePath}`);
  } catch (error) {
    console.error(`Error crítico creando carpeta uploads: ${error}`);
  }
}

// ----- MOCK MULTER UPLOAD -----
const upload = {
  single(fieldname) {
    const middleware = (req, res, next) => {
      if (next) next();
    };
    middleware.isUpload = true;
    middleware.fieldname = fieldname;
    return middleware;
  }
};
module.exports.upload = upload;

// ----- INICIALIZAR BD -----
try {
  initializeDB();
  startScheduler();

  // Respaldos locales automáticos programables (Fase 6)
  try {
    require('./src/utils/localBackup').startBackupScheduler();
  } catch (e) {
    console.error('No se pudo iniciar el programador de respaldos:', e.message);
  }
  
  // Verificación de licencia y actualizaciones en el arranque
  const { checkOnlineAndActivate } = require('./controllers/license.controller');
  setTimeout(() => {
    console.log('[STARTUP] Iniciando verificación de licencia y actualizaciones...');
    checkOnlineAndActivate().catch(err => console.error('[STARTUP] Error en verificación inicial:', err.message));
  }, 5000);
  
} catch (error) {
  console.error("Error irrecuperable inicializando DB:", error);
  process.exit(1);
}

// ----- FASTIFY -----
const fastify = fastifyLib({
  logger: false,
  bodyLimit: 10485760, // Limite de 10MB
  ignoreTrailingSlash: true
});

// Setup adapter function
function adaptController(expressController) {
  return async (request, reply) => {
    const req = {
      query: request.query || {},
      body: request.body || {},
      params: request.params || {},
      file: request.file,
      files: request.files,
      headers: request.headers || {},
      method: request.method,
      url: request.url,
      ip: request.ip
    };

    let responseSent = false;
    const res = {
      status(code) {
        reply.status(code);
        return this;
      },
      json(data) {
        if (responseSent) return this;
        responseSent = true;
        reply.header('Content-Type', 'application/json; charset=utf-8');
        reply.send(data);
        return this;
      },
      send(data) {
        if (responseSent) return this;
        responseSent = true;
        reply.send(data);
        return this;
      },
      setHeader(name, value) {
        reply.header(name, value);
        return this;
      },
      end(chunk, encoding, callback) {
        if (reply.raw.writableEnded) return this;
        responseSent = true;
        reply.raw.end(chunk, encoding, callback);
        return this;
      },
      sendFile(filePath) {
        if (responseSent) return this;
        responseSent = true;
        reply.sendFile(path.basename(filePath), path.dirname(filePath));
        return this;
      },
      on(event, handler) {
        reply.raw.on(event, handler);
        return this;
      },
      once(event, handler) {
        reply.raw.once(event, handler);
        return this;
      },
      emit(event, ...args) {
        reply.raw.emit(event, ...args);
        return this;
      },
      write(chunk, encoding, callback) {
        if (reply.raw.writableEnded) return false;
        responseSent = true;
        return reply.raw.write(chunk, encoding, callback);
      },
      removeListener(event, handler) {
        reply.raw.removeListener(event, handler);
        return this;
      },
      addListener(event, handler) {
        reply.raw.addListener(event, handler);
        return this;
      },
      off(event, handler) {
        reply.raw.off(event, handler);
        return this;
      }
    };

    try {
      await expressController(req, res);
    } catch (err) {
      console.error("Error en controlador adaptado:", err);
      if (!responseSent) {
        // En producción no filtrar el mensaje interno del error (A.3).
        const message = process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message;
        reply.status(500).send({ error: true, message });
      }
    }
  };
}

// Handler for parsing multipart uploads
async function parseMultipartUpload(request, reply) {
  if (!request.isMultipart()) {
    return;
  }

  const parts = request.parts();
  request.body = {};

  // A.3: whitelist de extensiones por campo. Se ignora la extensión cruda del cliente y se
  // usa una segura y conocida, y se rechazan tipos no permitidos (evita subir .exe/.html/etc.).
  const ALLOWED_EXT = {
    logoFile: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
    imagen: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
    _import: ['.xlsx', '.xls', '.csv'],
  };

  for await (const part of parts) {
    if (part.file) {
      const rawExt = (path.extname(part.filename || '') || '').toLowerCase();
      const allowed = ALLOWED_EXT[part.fieldname] || ALLOWED_EXT._import;
      if (!allowed.includes(rawExt)) {
        // Descartar el stream para no dejar la conexión colgada.
        part.file.resume();
        throw new Error(`Tipo de archivo no permitido para "${part.fieldname}": ${rawExt || 'sin extensión'}`);
      }
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const extension = rawExt;
      const prefix = part.fieldname === 'logoFile' ? 'logo-' : (part.fieldname === 'imagen' ? 'img-' : 'import-');
      const filename = prefix + uniqueSuffix + extension;
      const savedPath = path.join(uploadsBasePath, filename);
      
      const writeStream = fs.createWriteStream(savedPath);
      await new Promise((resolve, reject) => {
        part.file.pipe(writeStream);
        part.file.on('end', resolve);
        writeStream.on('error', reject);
      });
      
      request.file = {
        path: savedPath,
        originalname: part.filename,
        filename: filename,
        fieldname: part.fieldname
      };
    } else {
      request.body[part.fieldname] = part.value;
    }
  }
}

// ----- GATE DE LICENCIA (bloqueo total del lado servidor) -----
// Sin licencia/trial válido, solo se permite la pantalla de activación, sus assets
// y la API de licencia. Todo lo demás (módulos y APIs de negocio) se bloquea.
// Esto hace inútil saltarse el JS del cliente: la verdad la impone el servidor local.
const { getAppStatus } = require('./src/utils/license');
const { isLanEnabled, verifyLanToken, isLoopbackAddress, LAN_TOKEN_TTL_MS } = require('./src/utils/network');
const { decideAccess } = require('./src/utils/accessGate');

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

let _licenseCache = { value: false, at: 0 };
const LICENSE_CACHE_TTL_MS = 5000;
function isLicensedNow() {
  const now = Date.now();
  if (now - _licenseCache.at < LICENSE_CACHE_TTL_MS) return _licenseCache.value;
  let value = false;
  try {
    const s = getAppStatus().status;
    value = (s === 'LICENSED' || s === 'TRIAL');
  } catch (e) {
    console.error('[LICENSE-GATE] Error evaluando estado de licencia:', e.message);
    value = false; // fail-closed: sin estado válido, se bloquea (la activación sigue accesible)
  }
  _licenseCache = { value, at: now };
  return value;
}
// Invalida la caché tras activar/iniciar prueba para reflejar el cambio de inmediato.
function invalidateLicenseCache() { _licenseCache = { value: false, at: 0 }; }
global.__invalidateLicenseGate = invalidateLicenseCache;

// CORS restringido: se acepta origen ausente (mismo origen) o de loopback.
// Los rangos LAN privados SOLO se permiten cuando el modo LAN está activado (Fase 14).
function isAllowedOrigin(origin) {
  if (!origin) return true; // mismo origen / peticiones sin cabecera Origin
  try {
    const host = new URL(origin).hostname;
    if (isLoopbackAddress(host) || host === 'localhost') return true;
    // Rangos LAN privados: solo si el modo LAN está explícitamente activo.
    if (!isLanEnabled()) return false;
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
  } catch (_) {
    return false;
  }
}

async function startFastifyServer() {
  // Register CORS (restringido a loopback/LAN privada)
  const cors = require('@fastify/cors');
  await fastify.register(cors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  });

  // Cabeceras de seguridad básicas.
  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-DNS-Prefetch-Control', 'off');
    return payload;
  });

  // Control de acceso LAN + gate de licencia: antes de servir cualquier ruta o archivo.
  fastify.addHook('onRequest', async (request, reply) => {
    const pathname = (request.raw.url || '/').split('?')[0];
    const remote = request.ip || (request.socket && request.socket.remoteAddress);
    const cookieToken = parseCookie(request.headers.cookie, 'lanToken');
    const queryToken = (request.query && request.query.lt) ? String(request.query.lt) : null;

    const decision = decideAccess({
      isLocal: isLoopbackAddress(remote),
      pathname,
      lanEnabled: isLanEnabled(),
      tokenValidCookie: verifyLanToken(cookieToken),
      tokenValidQuery: verifyLanToken(queryToken),
      lanToken: queryToken,
      licensed: isLicensedNow(),
    });

    if (decision.setCookie) {
      reply.header('Set-Cookie', `lanToken=${decision.setCookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(LAN_TOKEN_TTL_MS / 1000)}`);
    }
    if (decision.type === 'continue') return;
    if (decision.type === 'redirect') { reply.redirect(decision.location); return reply; }
    // deny
    reply.code(decision.code);
    if (decision.html) reply.type('text/html').send(decision.html);
    else reply.send(decision.body);
    return reply;
  });

  // Register Multipart con límites explícitos (Fase 14): evita llenar disco con
  // subidas enormes. 20MB por archivo cubre logos, imágenes e importaciones xlsx/csv.
  const multipart = require('@fastify/multipart');
  await fastify.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 1,
      fields: 50,
    },
  });

  // Register Static files
  const isPkg = !!process.pkg;
  const basePath = isPkg ? path.dirname(process.execPath) : __dirname;
  const publicPath = path.join(basePath, 'public');

  const fastifyStatic = require('@fastify/static');
  await fastify.register(fastifyStatic, {
    root: publicPath,
    prefix: '/',
    wildcard: false,
    index: false
  });

  // Serve uploads folder statically
  if (fs.existsSync(uploadsBasePath)) {
    await fastify.register(fastifyStatic, {
      root: uploadsBasePath,
      prefix: '/uploads/',
      decorateReply: false
    });
    console.log(`Sirviendo uploads desde: ${uploadsBasePath}`);
  }

  // Register express route stack to fastify
  function registerExpressRouter(prefix, routerObj) {
    for (const route of routerObj.stack) {
      const hasUpload = route.handlers.some(h => h.isUpload);
      let routeUrl = (prefix + route.path).replace(/\/+/g, '/');
      if (routeUrl.endsWith('/') && routeUrl.length > 1) {
        routeUrl = routeUrl.slice(0, -1);
      }
      fastify.route({
        method: route.method,
        url: routeUrl,
        handler: adaptController(route.handlers[route.handlers.length - 1]),
        preHandler: hasUpload ? parseMultipartUpload : undefined
      });
    }
  }

  // ----- REGISTRAR RUTAS API -----
  registerExpressRouter('/api/products', require('./routes/product.routes'));
  registerExpressRouter('/api/categories', require('./routes/category.routes'));
  registerExpressRouter('/api/sales', require('./routes/sales.routes'));
  registerExpressRouter('/api/settings', require('./routes/settings.routes'));
  registerExpressRouter('/api/license', require('./routes/license.routes'));
  registerExpressRouter('/api/reports', require('./routes/reports.routes'));
  registerExpressRouter('/api/utils', require('./routes/utils.routes'));
  registerExpressRouter('/api/clients', require('./routes/client.routes'));
  registerExpressRouter('/api/auth', require('./routes/auth.routes'));
  registerExpressRouter('/api/backup', require('./routes/backup.routes'));
  registerExpressRouter('/api/print-settings', require('./routes/printSettings.routes'));
  registerExpressRouter('/api/cashea', require('./routes/cashea.routes'));
  registerExpressRouter('/api/presentations', require('./routes/presentation.routes'));
  registerExpressRouter('/api/payment-methods', require('./routes/paymentMethod.routes'));
  registerExpressRouter('/api/custom-rates', require('./routes/rates.routes'));
  registerExpressRouter('/api/admin', require('./routes/admin.routes'));

  // Remote printing API endpoint
  fastify.post('/api/print/remote', async (request, reply) => {
    const { type, options } = request.body || {};
    const handlers = fastify.printHandlers;

    if (!handlers) {
      return reply.status(503).send({ ok: false, error: 'Servicio de impresión no inicializado en el servidor.' });
    }

    try {
      let result;
      if (type === 'text') {
        result = await handlers.printText(options);
      } else if (type === 'html') {
        result = await handlers.printHTML(options);
      } else if (type === 'getPrinters') {
        result = await handlers.getPrinters();
      } else {
        return reply.status(400).send({ ok: false, error: 'Tipo de impresión no soportado.' });
      }

      return result;
    } catch (error) {
      console.error('Error en impresión remota:', error);
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // Serve main page fallback
  fastify.get('/', async (request, reply) => {
    const p = fs.existsSync(publicPath) ? publicPath : path.join(__dirname, 'public');
    return reply.sendFile('index.html', p);
  });

  // Global Error Handler
  // Fase 11.9 / A.3: en producción NO se filtran `error.message`/`error.name` al cliente
  // (pueden revelar rutas internas, SQL o detalles útiles para atacar). En desarrollo sí.
  const isProd = process.env.NODE_ENV === 'production';
  fastify.setErrorHandler((error, request, reply) => {
    console.error('🔥 ERROR CRÍTICO NO CONTROLADO:', error);
    const payload = { error: true, message: 'Error interno del servidor' };
    if (!isProd) {
      payload.details = error.message || 'Error desconocido';
      payload.type = error.name;
    }
    reply.status(500).send(payload);
  });
}

function start(port, printHandlers) {
  if (printHandlers) {
    fastify.printHandlers = printHandlers;
  }

  return new Promise(async (resolve, reject) => {
    try {
      await startFastifyServer();
      
      // Por defecto solo loopback. El modo LAN (opt-in) reenlaza a 0.0.0.0 tras reiniciar.
      const bindHost = isLanEnabled() ? '0.0.0.0' : '127.0.0.1';
      const listenPort = async (p) => {
        try {
          const address = await fastify.listen({ port: p, host: bindHost });
          console.log(`Servidor Fastify iniciado en ${address} (host: ${bindHost})`);
          return p;
        } catch (err) {
          if (err.code === 'EADDRINUSE') {
            console.warn(`Puerto ${p} ocupado, el servidor intentará con el puerto ${p + 1}...`);
            return listenPort(p + 1);
          } else {
            throw err;
          }
        }
      };

      const finalPort = await listenPort(port);
      global.dynamicPort = finalPort;
      resolve(finalPort);
    } catch (err) {
      console.error('Error fatal al iniciar servidor Fastify:', err);
      reject(err);
    }
  });
}

module.exports.start = start;
