const path = require('path');
const { getDataBasePath } = require('./utils/settings');

console.log('[DB] Cargando better-sqlite3...');
let Database;
try {
  Database = require('better-sqlite3');
  console.log('[DB] better-sqlite3 cargado correctamente.');
} catch (err) {
  console.error('[DB] ERROR FATAL al cargar better-sqlite3:', err.message);
  throw err; // Re-lanzar para que lo atrape main.js o server.js
}

const dbPath = path.join(getDataBasePath(), 'mi-tienda.db');
console.log(`Usando base de datos en: ${dbPath}`);

let db;

function openDatabase() {
  try {
    if (db && db.open) return;
    db = new Database(dbPath, { verbose: console.log });
    console.log('Base de datos abierta correctamente.');
  } catch (error) {
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("!!! ERROR FATAL AL ABRIR LA BASE DE DATOS !!!");
    console.error(`!!! RUTA: ${dbPath}`);
    console.error(`!!! ERROR: ${error.message}`);
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    process.exit(1);
  }
}

// Abrir inmediatamente al cargar
openDatabase();

function closeDatabase() {
  if (db && db.open) {
    try {
      db.close();
      console.log('Base de datos cerrada correctamente.');
    } catch (e) {
      console.error('Error cerrando base de datos:', e);
    }
  }
}

function reopenDatabase() {
  openDatabase();
}

function initializeDB() {
  console.log('--- INICIO DE INICIALIZACIÓN DE DB ---');

  // Verificar si la base de datos es escribible
  try {
    db.exec("CREATE TABLE IF NOT EXISTS _write_test (id INTEGER PRIMARY KEY); DROP TABLE _write_test;");
    console.log('Check de escritura: OK (La base de datos permite escribir)');
  } catch (err) {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('!!! ERROR CRÍTICO: LA BASE DE DATOS NO ES ESCRIBIBLE !!!');
    console.error(`!!! DETALLE: ${err.message}`);
    console.error('!!! Las migraciones NO se podrán aplicar.');
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  }

  console.log('Verificando tablas y aplicando migraciones...');

  // ==========================
  // SETTINGS
  // ==========================
  const createSettingsTable = `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value REAL NOT NULL
    );
  `;
  db.exec(createSettingsTable);

  // ==========================
  // PRODUCTOS
  // ==========================
  const createProductsTable = `
    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      costo REAL NOT NULL,
      costo_bulto REAL DEFAULT 0,
      unidades_bulto INTEGER DEFAULT 1,
      moneda_costo TEXT NOT NULL CHECK(moneda_costo IN ('VES', 'BCV', 'PARALELO', 'COP')),
      porcentaje_ganancia REAL NOT NULL,
      stock REAL DEFAULT 0,
      categoria TEXT,
      tipo_venta TEXT NOT NULL DEFAULT 'UNIDAD' CHECK(tipo_venta IN ('UNIDAD', 'PESO', 'LITRO')),
      proveedor TEXT,
      barcode TEXT UNIQUE DEFAULT NULL,
      creado_en DATETIME DEFAULT (datetime('now', 'localtime'))
    );
  `;
  db.exec(createProductsTable);

  // Columna "activo" en productos (soft delete)
  try {
    db.exec(`
      ALTER TABLE productos
      ADD COLUMN activo BOOLEAN DEFAULT 1
    `);
    console.log('Migración DB: Columna `activo` añadida a productos.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: activo')) {
      console.warn('Advertencia de migración, columna `activo` no añadida:', e.message);
    }
  }

  // Columna "imagen" en productos
  try {
    db.exec(`
      ALTER TABLE productos
      ADD COLUMN imagen TEXT DEFAULT NULL
    `);
    console.log('Migración DB: Columna `imagen` añadida a productos.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: imagen')) {
      console.warn('Advertencia de migración, columna `imagen` no añadida:', e.message);
    }
  }

  // ==========================
  // PRESENTACIONES
  // ==========================
  // ==========================
  // PRESENTACIONES
  // ==========================
  const createPresentacionesTable = `
    CREATE TABLE IF NOT EXISTS presentaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producto_id INTEGER NOT NULL,
      nombre TEXT NOT NULL,
      unidades_base REAL NOT NULL DEFAULT 1,
      precio_ves REAL NOT NULL DEFAULT 0,
      precio REAL NOT NULL DEFAULT 0,
      moneda TEXT NOT NULL DEFAULT 'VES' CHECK(moneda IN ('VES', 'BCV', 'PARALELO', 'COP')),
      barcode TEXT UNIQUE,
      activo INTEGER NOT NULL DEFAULT 1,
      precio_usd_bcv REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (producto_id) REFERENCES productos(id)
    );
  `;
  db.exec(createPresentacionesTable);

  // Migración: añadir columna precio_usd_bcv si no existía (LEGACY)
  try {
    db.exec(`
      ALTER TABLE presentaciones
      ADD COLUMN precio_usd_bcv REAL NOT NULL DEFAULT 0
    `);
    console.log('Migración DB: Columna `precio_usd_bcv` añadida a presentaciones.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: precio_usd_bcv')) {
      console.warn('Advertencia de migración, columna `precio_usd_bcv` no añadida:', e.message);
    }
  }

  // Migración: añadir columna moneda
  try {
    db.exec(`
      ALTER TABLE presentaciones
      ADD COLUMN moneda TEXT NOT NULL DEFAULT 'VES' CHECK(moneda IN ('VES', 'BCV', 'PARALELO', 'COP'))
    `);
    console.log('Migración DB: Columna `moneda` añadida a presentaciones.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: moneda')) {
      console.warn('Advertencia de migración, columna `moneda` no añadida:', e.message);
    }
  }

  // Migración: añadir columna precio
  try {
    db.exec(`
      ALTER TABLE presentaciones
      ADD COLUMN precio REAL NOT NULL DEFAULT 0
    `);
    console.log('Migración DB: Columna `precio` añadida a presentaciones.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: precio')) {
      console.warn('Advertencia de migración, columna `precio` no añadida:', e.message);
    }
  }

  // Índices para mejorar rendimiento en búsquedas por producto y por código de barras
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_presentaciones_producto
    ON presentaciones(producto_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_presentaciones_barcode
    ON presentaciones(barcode);
  `);

  // (OPCIONAL) Inicializar precio_usd_bcv para presentaciones viejas
  // Y ahora también inicializar 'precio' y 'moneda' para presentaciones viejas
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'BCV'`).get();
    const bcv = row ? row.value : 0;

    // Primero aseguramos precio_usd_bcv para compatibilidad vieja
    if (bcv > 0) {
      const initStmt = db.prepare(`
        UPDATE presentaciones
        SET precio_usd_bcv =
          CASE
            WHEN (precio_usd_bcv IS NULL OR precio_usd_bcv = 0) AND precio_ves > 0
            THEN precio_ves / ?
            ELSE precio_usd_bcv
          END
      `);
      initStmt.run(bcv);
    }

    // Ahora poblamos las columnas nuevas para datos existentes
    db.exec(`
      UPDATE presentaciones
      SET moneda = 'BCV', precio = precio_usd_bcv
      WHERE precio_usd_bcv > 0 AND precio = 0
    `);

    db.exec(`
      UPDATE presentaciones
      SET moneda = 'VES', precio = precio_ves
      WHERE (precio_usd_bcv IS NULL OR precio_usd_bcv = 0) AND precio_ves > 0 AND precio = 0
    `);

    console.log('Migración DB: presentaciones inicializadas con nuevas columnas (moneda, precio).');

  } catch (e) {
    console.warn('No se pudieron inicializar precio_usd_bcv/nuevas columnas en presentaciones:', e.message);
  }

  // ==========================
  // CATEGORÍAS
  // ==========================
  const createCategoriesTable = `
    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE
    );
  `;
  db.exec(createCategoriesTable);

  // ==========================
  // CLIENTES
  // ==========================
  const createClientesTable = `
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      cedula TEXT UNIQUE,
      telefono TEXT,
      direccion TEXT
    );
  `;
  db.exec(createClientesTable);

  // Columna "activo" en clientes
  try {
    db.exec(`
      ALTER TABLE clientes
      ADD COLUMN activo BOOLEAN DEFAULT 1
    `);
    console.log('Migración DB: Columna `activo` añadida a clientes.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: activo')) {
      console.warn('Advertencia de migración, columna `activo` no añadida:', e.message);
    }
  }

  // ==========================
  // VENTAS
  // ==========================
  const createVentasTable = `
    CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER,
      total_ves REAL NOT NULL,
      total_usd_bcv REAL NOT NULL,
      estado_pago TEXT NOT NULL DEFAULT 'PAGADO' CHECK(estado_pago IN ('PAGADO', 'FIADO', 'ABONADO', 'ANULADO')),
      monto_pendiente_usd REAL NOT NULL DEFAULT 0,
      creado_en DATETIME DEFAULT (datetime('now', 'localtime')),
      archivado INTEGER DEFAULT 0,
      FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE SET NULL
    );
  `;
  db.exec(createVentasTable);

  // Migración: añadir columna archivado a ventas
  try {
    db.exec(`
      ALTER TABLE ventas
      ADD COLUMN archivado INTEGER DEFAULT 0
    `);
    console.log('Migración DB: Columna `archivado` añadida a ventas.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: archivado')) {
      console.warn('Advertencia de migración, columna `archivado` no añadida:', e.message);
    }
  }

  // Migración: añadir columna nota a ventas
  try {
    db.exec(`
      ALTER TABLE ventas
      ADD COLUMN nota TEXT DEFAULT NULL
    `);
    console.log('Migración DB: Columna `nota` añadida a ventas.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: nota')) {
      console.warn('Advertencia de migración, columna `nota` no añadida a ventas:', e.message);
    }
  }

  const createVentaProductosTable = `
    CREATE TABLE IF NOT EXISTS venta_productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER NOT NULL,
      producto_id INTEGER NOT NULL,
      cantidad REAL NOT NULL,
      precio_unitario_ves REAL NOT NULL,
      costo_unitario_ves REAL NOT NULL,
      FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE,
      FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE SET NULL
    );
  `;
  db.exec(createVentaProductosTable);

  const createVentaPagosTable = `
    CREATE TABLE IF NOT EXISTS venta_pagos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER NOT NULL,
      metodo TEXT NOT NULL CHECK(metodo IN ('VES_EFECTIVO', 'USD_EFECTIVO', 'TARJETA', 'PUNTO_VENTA', 'BIOPAGO', 'PAGOMOVIL', 'TRANSFERENCIA', 'COP_EFECTIVO', 'COP_TRANSFERENCIA', 'CASHEA')),
      monto_recibido REAL NOT NULL,
      monto_en_ves REAL NOT NULL,
      tasa_bcv_momento REAL,
      FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE
    );
  `;
  db.exec(createVentaPagosTable);

  // ==========================
  // ABONOS
  // ==========================
  const createAbonosTable = `
    CREATE TABLE IF NOT EXISTS abonos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      venta_id INTEGER,
      monto_pagado_ves REAL NOT NULL,
      monto_pagado_usd REAL NOT NULL,
      tasa_bcv_momento REAL NOT NULL,
      metodo TEXT NOT NULL,
      fecha DATETIME DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE CASCADE,
      FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE SET NULL
    );
  `;
  db.exec(createAbonosTable);

  // --- Migraciones ABONOS: columnas para anulación de abonos ---
  try {
    db.exec(`
      ALTER TABLE abonos
      ADD COLUMN anulado INTEGER NOT NULL DEFAULT 0
    `);
    console.log('Migración DB: Columna `anulado` añadida a abonos.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: anulado')) {
      console.warn('Advertencia de migración, columna `anulado` no añadida a abonos:', e.message);
    }
  }

  try {
    db.exec(`
      ALTER TABLE abonos
      ADD COLUMN anulado_en DATETIME
    `);
    console.log('Migración DB: Columna `anulado_en` añadida a abonos.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: anulado_en')) {
      console.warn('Advertencia de migración, columna `anulado_en` no añadida a abonos:', e.message);
    }
  }

  try {
    db.exec(`
      ALTER TABLE abonos
      ADD COLUMN motivo_anulacion TEXT
    `);
    console.log('Migración DB: Columna `motivo_anulacion` añadida a abonos.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: motivo_anulacion')) {
      console.warn('Advertencia de migración, columna `motivo_anulacion` no añadida a abonos:', e.message);
    }
  }

  // 🔥 LIMPIEZA: eliminar abonos que antes se ocultaban (anulado = 1)
  try {
    const deleteAnuladosStmt = db.prepare(`
      DELETE FROM abonos
      WHERE anulado = 1
    `);
    const infoDel = deleteAnuladosStmt.run();
    console.log(
      'Migración DB: abonos anulados antiguos eliminados (' +
      infoDel.changes +
      ' filas borradas).'
    );
  } catch (e) {
    console.warn(
      'Advertencia de migración: no se pudieron eliminar abonos anulados:',
      e.message
    );
  }

  // ==========================
  // RETIROS DE CAJA
  // ==========================
  const createRetirosCajaTable = `
    CREATE TABLE IF NOT EXISTS retiros_caja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha DATETIME DEFAULT (datetime('now','localtime')),
      metodo TEXT NOT NULL CHECK(metodo IN ('VES_EFECTIVO','USD_EFECTIVO')),
      monto_ves REAL NOT NULL DEFAULT 0,
      monto_usd REAL NOT NULL DEFAULT 0,
      tasa_bcv_momento REAL NOT NULL DEFAULT 0,
      descripcion TEXT
    );
  `;
  db.exec(createRetirosCajaTable);

  // ==========================
  // APERTURAS DE CAJA
  // ==========================
  const createAperturasCajaTable = `
    CREATE TABLE IF NOT EXISTS aperturas_caja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha DATETIME DEFAULT (datetime('now','localtime')),
      -- montos iniciales en caja
      opening_ves REAL NOT NULL DEFAULT 0,
      opening_usd REAL NOT NULL DEFAULT 0,
      -- tasa BCV registrada en el momento de la apertura
      tasa_bcv_momento REAL NOT NULL DEFAULT 0,
      notas TEXT
    );
  `;
  try {
    db.exec(createAperturasCajaTable);
    console.log('Tabla aperturas_caja OK (creada o ya existente).');
  } catch (e) {
    console.error('Error al crear tabla aperturas_caja:', e.message);
  }

  // ==========================
  // CIERRES DE CAJA (CIERRE Z)
  // ==========================
  const createCierresCajaTable = `
    CREATE TABLE IF NOT EXISTS cierres_caja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha DATETIME DEFAULT (datetime('now','localtime'))
    );
  `;
  try {
    db.exec(createCierresCajaTable);
    console.log('Tabla cierres_caja OK (creada o ya existente).');
  } catch (e) {
    console.error('Error al crear tabla cierres_caja:', e.message);
  }

  // ==========================
  // SEED RATES
  // ==========================
  const seedRates = `
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('BCV', 36.50),
      ('PARALELO', 39.80),
      ('COP', 0.00995),
      ('CALC_METHOD', 1),
      ('AUTO_BCV', 1);
  `;
  try {
    db.exec(seedRates);
  } catch (seedError) {
    console.warn("Advertencia al intentar sembrar tasas iniciales:", seedError.message);
  }

  // Asegurar que AUTO_BCV exista con valor 1 por defecto (para DBs existentes)
  try {
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('AUTO_BCV', 1)").run();
  } catch (e) {
    // Ignorar si ya existe
  }

  // ==========================
  // LIMPIAR BARCODES DE PRODUCTOS INACTIVOS
  // ==========================
  try {
    const limpiarBarcodesInactivos = db.prepare(`
      UPDATE productos
      SET barcode = NULL
      WHERE activo = 0
        AND barcode IS NOT NULL
    `);
    const info = limpiarBarcodesInactivos.run();
    console.log(
      'Migración DB: códigos de barras limpiados en productos inactivos (' +
      info.changes +
      ' filas actualizadas).'
    );
  } catch (e) {
    console.warn(
      'Advertencia de migración: no se pudieron limpiar barcodes de productos inactivos:',
      e.message
    );
  }

  // ==========================
  // LIMPIAR PRESENTACIONES DE PRODUCTOS INACTIVOS
  // ==========================
  try {
    const limpiarPresentacionesInactivas = db.prepare(`
      UPDATE presentaciones
      SET activo = 0, barcode = NULL
      WHERE producto_id IN (SELECT id FROM productos WHERE activo = 0)
        AND (activo = 1 OR barcode IS NOT NULL)
    `);
    const info = limpiarPresentacionesInactivas.run();
    console.log(
      'Migración DB: presentaciones limpiadas en productos inactivos (' +
      info.changes +
      ' filas actualizadas).'
    );
  } catch (e) {
    console.warn(
      'Advertencia de migración: no se pudieron limpiar presentaciones de productos inactivos:',
      e.message
    );
  }

  // ==========================
  // MIGRACIÓN: SOPORTE PARA LITRO
  // ==========================
  try {
    const tableDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='productos'").get();
    if (tableDef && !tableDef.sql.includes("'LITRO'")) {
      console.log('Migración DB: Actualizando tabla productos para soportar LITRO (CHECK constraint)...');

      const migrationTransaction = db.transaction(() => {
        // 1. Crear tabla temporal con nueva estructura (incluyendo LITRO, activo e imagen)
        db.exec(`
          CREATE TABLE productos_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            costo REAL NOT NULL,
            costo_bulto REAL DEFAULT 0,
            unidades_bulto INTEGER DEFAULT 1,
            moneda_costo TEXT NOT NULL CHECK(moneda_costo IN ('VES', 'BCV', 'PARALELO', 'COP')),
            porcentaje_ganancia REAL NOT NULL,
            stock REAL DEFAULT 0,
            categoria TEXT,
            tipo_venta TEXT NOT NULL DEFAULT 'UNIDAD' CHECK(tipo_venta IN ('UNIDAD', 'PESO', 'LITRO')),
            proveedor TEXT,
            barcode TEXT UNIQUE DEFAULT NULL,
            creado_en DATETIME DEFAULT (datetime('now', 'localtime')),
            activo BOOLEAN DEFAULT 1,
            imagen TEXT DEFAULT NULL
          );
        `);

        // 2. Copiar datos (Intentamos copiar imagen si existe, si no, ignoramos)
        // Nota: Como 'imagen' se añade al inicio de initializeDB, debería existir.
        db.exec(`
          INSERT INTO productos_temp (id, nombre, costo, costo_bulto, unidades_bulto, moneda_costo, porcentaje_ganancia, stock, categoria, tipo_venta, proveedor, barcode, creado_en, activo, imagen)
          SELECT id, nombre, costo, costo_bulto, unidades_bulto, moneda_costo, porcentaje_ganancia, stock, categoria, tipo_venta, proveedor, barcode, creado_en, activo, imagen
          FROM productos;
        `);

        // 3. Dropear anterior
        db.exec('DROP TABLE productos');

        // 4. Renombrar
        db.exec('ALTER TABLE productos_temp RENAME TO productos');
      });

      migrationTransaction();
      console.log('Migración DB: Tabla productos actualizada correctamente con soporte LITRO.');
    }
  } catch (e) {
    console.error('Error FATAL en migración LITRO:', e.message);
  }

  // ==========================
  // MIGRACIÓN: EXENTO DE IVA (PRODUCTOS)
  // ==========================
  try {
    db.exec(`
      ALTER TABLE productos
      ADD COLUMN exento_iva INTEGER NOT NULL DEFAULT 1
    `);
    console.log('Migración DB: Columna `exento_iva` añadida a productos.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: exento_iva')) {
      console.warn('Advertencia de migración, columna `exento_iva` no añadida:', e.message);
    }
  }

  // ==========================
  // MIGRACIÓN: IMPUESTO TOTAL (VENTAS)
  // ==========================
  try {
    db.exec(`
      ALTER TABLE ventas
      ADD COLUMN impuesto_total REAL NOT NULL DEFAULT 0
    `);
    console.log('Migración DB: Columna `impuesto_total` añadida a ventas.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: impuesto_total')) {
      console.warn('Advertencia de migración, columna `impuesto_total` no añadida:', e.message);
    }
  }

  try {
    const tableDefVP = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='venta_productos'").get();
    
    // Verificamos si la definición contiene "producto_id INTEGER NOT NULL" (con o sin espacios extra)
    if (tableDefVP && /producto_id\s+INTEGER\s+NOT\s+NULL/i.test(tableDefVP.sql)) {
      console.log('Migración DB (Normal): Actualizando tabla venta_productos para permitir NULL en producto_id (preservando datos)...');

      // Detectamos si ya existen las columnas que no queremos perder
      const hasNombre = tableDefVP.sql.toLowerCase().includes('nombre');
      const hasExento = tableDefVP.sql.toLowerCase().includes('exento_iva');

      const migrationVP = db.transaction(() => {
        // 1. Crear tabla temporal con TODAS las posibles columnas
        db.exec(`
          CREATE TABLE venta_productos_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            venta_id INTEGER NOT NULL,
            producto_id INTEGER, -- Ahora permite NULL
            cantidad REAL NOT NULL,
            precio_unitario_ves REAL NOT NULL,
            costo_unitario_ves REAL NOT NULL,
            nombre TEXT DEFAULT NULL,
            exento_iva INTEGER DEFAULT 1,
            FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE,
            FOREIGN KEY (producto_id) REFERENCES productos (id) ON DELETE SET NULL
          );
        `);

        // 2. Construir el INSERT dinámicamente para no fallar si faltan columnas en la vieja, pero no perderlas si están
        const colsToCopy = ['id', 'venta_id', 'producto_id', 'cantidad', 'precio_unitario_ves', 'costo_unitario_ves'];
        if (hasNombre) colsToCopy.push('nombre');
        if (hasExento) colsToCopy.push('exento_iva');

        const colsStr = colsToCopy.join(', ');
        
        db.exec(`
          INSERT INTO venta_productos_temp (${colsStr})
          SELECT ${colsStr} FROM venta_productos;
        `);

        db.exec('DROP TABLE venta_productos');
        db.exec('ALTER TABLE venta_productos_temp RENAME TO venta_productos');
      });

      migrationVP();
      console.log('Migración DB (Normal): Tabla venta_productos actualizada correctamente (columnas preservadas).');
    }
  } catch (e) {
    console.error('Error FATAL en migración venta_productos nullable:', e.message);
  }

  // ==========================
  // SEED IVA SETTING
  // ==========================
  const seedIva = `
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('IVA_PERCENTAGE', 16.0);
  `;
  try {
    db.exec(seedIva);
  } catch (seedError) {
    console.warn("Advertencia al intentar sembrar IVA:", seedError.message);
  }

  // ==========================
  // MIGRACIÓN: AÑADIR COLUMNA NOMBRE Y EXENTO_IVA A VENTA_PRODUCTOS (PARA VENTA LIBRE)
  // ==========================
  try {
    db.exec(`
      ALTER TABLE venta_productos
      ADD COLUMN nombre TEXT DEFAULT NULL
    `);
    console.log('Migración DB: Columna `nombre` añadida a venta_productos.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: nombre')) {
      console.warn('Advertencia de migración, columna `nombre` no añadida a venta_productos:', e.message);
    }
  }

  try {
    db.exec(`
      ALTER TABLE venta_productos
      ADD COLUMN exento_iva INTEGER DEFAULT 1
    `);
    console.log('Migración DB: Columna `exento_iva` añadida a venta_productos.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: exento_iva')) {
      console.warn('Advertencia de migración, columna `exento_iva` no añadida a venta_productos:', e.message);
    }
  }

  // ==========================
  // MIGRACIÓN: SOPORTE PARA METRO (METRO)
  // ==========================
  try {
    const tableDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='productos'").get();
    if (tableDef && !tableDef.sql.includes("'METRO'")) {
      console.log('Migración DB: Actualizando tabla productos para incluir soporte METRO...');

      const migrationTransaction = db.transaction(() => {
        // 1. Crear tabla temporal con el nuevo constraint (incluyendo imagen)
        db.exec(`
          CREATE TABLE productos_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            costo REAL NOT NULL,
            costo_bulto REAL DEFAULT 0,
            unidades_bulto INTEGER DEFAULT 1,
            moneda_costo TEXT NOT NULL CHECK(moneda_costo IN ('VES', 'BCV', 'PARALELO', 'COP')),
            porcentaje_ganancia REAL NOT NULL,
            stock REAL DEFAULT 0,
            categoria TEXT,
            tipo_venta TEXT NOT NULL DEFAULT 'UNIDAD' CHECK(tipo_venta IN ('UNIDAD', 'PESO', 'LITRO', 'METRO')),
            proveedor TEXT,
            barcode TEXT UNIQUE DEFAULT NULL,
            creado_en DATETIME DEFAULT (datetime('now', 'localtime')),
            activo BOOLEAN DEFAULT 1,
            exento_iva INTEGER NOT NULL DEFAULT 1,
            imagen TEXT DEFAULT NULL
          );
        `);

        // 2. Copiar datos (Incluyendo exento_iva e imagen)
        db.exec(`
          INSERT INTO productos_temp (id, nombre, costo, costo_bulto, unidades_bulto, moneda_costo, porcentaje_ganancia, stock, categoria, tipo_venta, proveedor, barcode, creado_en, activo, exento_iva, imagen)
          SELECT id, nombre, costo, costo_bulto, unidades_bulto, moneda_costo, porcentaje_ganancia, stock, categoria, tipo_venta, proveedor, barcode, creado_en, activo, exento_iva, imagen
          FROM productos;
        `);

        // 3. Dropear anterior
        db.exec('DROP TABLE productos');

        // 4. Renombrar
        db.exec('ALTER TABLE productos_temp RENAME TO productos');
      });

      migrationTransaction();
      console.log('Migración DB: Tabla productos actualizada correctamente con soporte METRO.');
    }
  } catch (e) {
    console.error('Error FATAL en migración METRO:', e.message);
  }

  // ==========================
  // MIGRACIÓN: PUNTO_VENTA Y BIOPAGO (VENTA_PAGOS)
  // ==========================
  try {
    const tableDefVP = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='venta_pagos'").get();
    if (tableDefVP && !tableDefVP.sql.includes("'PUNTO_VENTA'")) {
      console.log('Migración DB: Actualizando tabla venta_pagos para incluir soporte PUNTO_VENTA y BIOPAGO...');

      const migrationVP = db.transaction(() => {
        // 1. Crear tabla temporal con nueva estructura
        db.exec(`
          CREATE TABLE venta_pagos_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            venta_id INTEGER NOT NULL,
            metodo TEXT NOT NULL CHECK(metodo IN ('VES_EFECTIVO', 'USD_EFECTIVO', 'TARJETA', 'PUNTO_VENTA', 'BIOPAGO', 'PAGOMOVIL', 'COP_EFECTIVO', 'COP_TRANSFERENCIA', 'CASHEA')),
            monto_recibido REAL NOT NULL,
            monto_en_ves REAL NOT NULL,
            tasa_bcv_momento REAL,
            FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE
          );
        `);

        // 2. Copiar datos
        db.exec(`
          INSERT INTO venta_pagos_temp (id, venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento)
          SELECT id, venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento
          FROM venta_pagos;
        `);

        // 3. Dropear anterior
        db.exec('DROP TABLE venta_pagos');

        // 4. Renombrar
        db.exec('ALTER TABLE venta_pagos_temp RENAME TO venta_pagos');
      });

      migrationVP();
      console.log('Migración DB: Tabla venta_pagos actualizada correctamente con soporte PUNTO_VENTA y BIOPAGO.');
    }
  } catch (e) {
    console.error('Error FATAL en migración PUNTO_VENTA/BIOPAGO:', e.message);
  }

  // ==========================
  // MIGRACIÓN: SOPORTE PARA TRANSFERENCIA (VENTA_PAGOS)
  // ==========================
  try {
    const tableDefVP = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='venta_pagos'").get();
    if (tableDefVP && !tableDefVP.sql.includes("'TRANSFERENCIA'")) {
      console.log('Migración DB: Actualizando tabla venta_pagos para incluir soporte TRANSFERENCIA...');

      const migrationVP = db.transaction(() => {
        // 1. Crear tabla temporal con nueva estructura
        db.exec(`
          CREATE TABLE venta_pagos_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            venta_id INTEGER NOT NULL,
            metodo TEXT NOT NULL CHECK(metodo IN ('VES_EFECTIVO', 'USD_EFECTIVO', 'TARJETA', 'PUNTO_VENTA', 'BIOPAGO', 'PAGOMOVIL', 'TRANSFERENCIA', 'COP_EFECTIVO', 'COP_TRANSFERENCIA', 'CASHEA')),
            monto_recibido REAL NOT NULL,
            monto_en_ves REAL NOT NULL,
            tasa_bcv_momento REAL,
            FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE
          );
        `);

        // 2. Copiar datos
        db.exec(`
          INSERT INTO venta_pagos_temp (id, venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento)
          SELECT id, venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento
          FROM venta_pagos;
        `);

        // 3. Dropear anterior
        db.exec('DROP TABLE venta_pagos');

        // 4. Renombrar
        db.exec('ALTER TABLE venta_pagos_temp RENAME TO venta_pagos');
      });

      migrationVP();
      console.log('Migración DB: Tabla venta_pagos actualizada correctamente con soporte TRANSFERENCIA.');
    }
  } catch (e) {
    console.error('Error FATAL en migración TRANSFERENCIA:', e.message);
  }

  // ==========================
  // FINAL RECOVERY: Asegurar que 'imagen' exista (por si migraciones anteriores fallaron)
  // ==========================
  try {
    db.exec(`
      ALTER TABLE productos
      ADD COLUMN imagen TEXT DEFAULT NULL
    `);
    console.log('Migración DB (Final Recovery): Columna `imagen` añadida a productos.');
  } catch (e) {
    if (!e.message.includes('duplicate column name: imagen')) {
      console.warn('Advertencia en Migración (Final Recovery), columna `imagen` no añadida:', e.message);
    }
  }

  // ==========================
  // CASHEA
  // ==========================
  const createCasheaVentasTable = `
    CREATE TABLE IF NOT EXISTS cashea_ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER NOT NULL,
      cliente_id INTEGER NOT NULL,
      referencia TEXT,
      monto_total_usd REAL NOT NULL,
      porcentaje_inicial INTEGER NOT NULL, -- 50 or 60
      monto_inicial_usd REAL NOT NULL,
      estado TEXT DEFAULT 'PENDIENTE', -- PENDIENTE, COMPLETADO
      creado_en DATETIME DEFAULT (datetime('now', 'localtime')),
      linea TEXT DEFAULT 'principal',
      reconciliado INTEGER DEFAULT 0, -- 0: No, 1: Sí (Cashea pagó al negocio)
      fecha_reconciliacion DATETIME,
      FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE,
      FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE CASCADE
    );
  `;
  db.exec(createCasheaVentasTable);

  const createCasheaCuotasTable = `
    CREATE TABLE IF NOT EXISTS cashea_cuotas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cashea_venta_id INTEGER NOT NULL,
      numero_cuota INTEGER NOT NULL,
      monto_usd REAL NOT NULL,
      fecha_vencimiento DATE NOT NULL,
      fecha_pago DATETIME,
      estado TEXT DEFAULT 'PENDIENTE', -- PENDIENTE, PAGADO
      FOREIGN KEY (cashea_venta_id) REFERENCES cashea_ventas (id) ON DELETE CASCADE
    );
  `;
  db.exec(createCasheaCuotasTable);

  // ==========================
  // MIGRACIÓN: RECONSTRUCCIÓN CASHEA_VENTAS
  // ==========================
  try {
    const casheaTableDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cashea_ventas'").get();
    // Solo reconstruir si existe la columna vieja 'monto_total' pero NO la nueva 'monto_total_usd'
    if (casheaTableDef && casheaTableDef.sql.includes('monto_total') && !casheaTableDef.sql.includes('monto_total_usd')) {
      console.log('Migración DB: Reconstruyendo cashea_ventas (mapeando monto_total -> monto_total_usd)...');
      
      db.transaction(() => {
        db.exec(`
          CREATE TABLE cashea_ventas_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            venta_id INTEGER NOT NULL,
            cliente_id INTEGER NOT NULL,
            referencia TEXT,
            monto_total_usd REAL NOT NULL,
            porcentaje_inicial INTEGER NOT NULL,
            monto_inicial_usd REAL NOT NULL,
            estado TEXT DEFAULT 'PENDIENTE',
            creado_en DATETIME DEFAULT (datetime('now', 'localtime')),
            linea TEXT DEFAULT 'principal',
            reconciliado INTEGER DEFAULT 0,
            fecha_reconciliacion DATETIME,
            FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE,
            FOREIGN KEY (cliente_id) REFERENCES clientes (id) ON DELETE CASCADE
          );
        `);

        const oldCols = db.prepare("PRAGMA table_info('cashea_ventas')").all().map(c => c.name);
        const mapMontoUsd = oldCols.includes('monto_total_usd') ? 'monto_total_usd' : 'monto_total';
        const mapPI = oldCols.includes('porcentaje_inicial') ? 'porcentaje_inicial' : '50';
        const mapMI = oldCols.includes('monto_inicial_usd') ? 'monto_inicial_usd' : (oldCols.includes('monto_inicial') ? 'monto_inicial' : '0');
        const mapLine = oldCols.includes('linea') ? 'linea' : "'principal'";
        const mapRec = oldCols.includes('reconciliado') ? 'reconciliado' : '0';
        const mapRecDate = oldCols.includes('fecha_reconciliacion') ? 'fecha_reconciliacion' : 'NULL';

        db.exec(`
          INSERT INTO cashea_ventas_temp (id, venta_id, cliente_id, referencia, monto_total_usd, porcentaje_inicial, monto_inicial_usd, estado, creado_en, linea, reconciliado, fecha_reconciliacion)
          SELECT id, venta_id, cliente_id, referencia, 
                 ${mapMontoUsd}, ${mapPI}, ${mapMI}, estado, creado_en, ${mapLine}, ${mapRec}, ${mapRecDate}
          FROM cashea_ventas;
        `);

        db.exec('DROP TABLE cashea_ventas');
        db.exec('ALTER TABLE cashea_ventas_temp RENAME TO cashea_ventas');
      })();
      console.log('Migración DB: Tabla cashea_ventas reconstruida correctamente.');
    }
  } catch (e) {
    console.error('Error FATAL en reconstrucción cashea_ventas:', e.message);
  }

  // ==========================
  // MIGRACIÓN: RECONSTRUCCIÓN CASHEA_CUOTAS
  // ==========================
  try {
    const cuotasTableDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cashea_cuotas'").get();
    if (cuotasTableDef && !cuotasTableDef.sql.includes('monto_usd')) {
      console.log('Migración DB: Reconstruyendo cashea_cuotas (faltaba monto_usd)...');
      
      db.transaction(() => {
        db.exec(`
          CREATE TABLE cashea_cuotas_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cashea_venta_id INTEGER NOT NULL,
            numero_cuota INTEGER NOT NULL,
            monto_usd REAL NOT NULL,
            fecha_vencimiento DATE NOT NULL,
            fecha_pago DATETIME,
            estado TEXT DEFAULT 'PENDIENTE',
            FOREIGN KEY (cashea_venta_id) REFERENCES cashea_ventas (id) ON DELETE CASCADE
          );
        `);

        // Intentar copiar lo que se pueda
        const oldCols = db.prepare("PRAGMA table_info('cashea_cuotas')").all().map(c => c.name);
        const hasMonto = oldCols.includes('monto');
        const hasMontoUsd = oldCols.includes('monto_usd');
        const hasFechaV = oldCols.includes('fecha_vencimiento');

        db.exec(`
          INSERT INTO cashea_cuotas_temp (id, cashea_venta_id, numero_cuota, monto_usd, fecha_vencimiento, fecha_pago, estado)
          SELECT id, cashea_venta_id, numero_cuota, 
                 ${hasMontoUsd ? 'monto_usd' : (hasMonto ? 'monto' : '0')}, 
                 ${hasFechaV ? 'fecha_vencimiento' : '"2026-04-09"'}, 
                 fecha_pago, estado
          FROM cashea_cuotas;
        `);

        db.exec('DROP TABLE cashea_cuotas');
        db.exec('ALTER TABLE cashea_cuotas_temp RENAME TO cashea_cuotas');
      })();
      console.log('Migración DB: Tabla cashea_cuotas reconstruida correctamente.');
    }
  } catch (e) {
    console.error('Error FATAL en reconstrucción cashea_cuotas:', e.message);
  }

  // ==========================
  // MIGRACIÓN: COLUMNAS EXTRA CASHEA_VENTAS
  // ==========================
  const columnsToMigrate = [
    { name: 'referencia', type: 'TEXT' },
    { name: 'monto_total_usd', type: 'REAL NOT NULL DEFAULT 0' },
    { name: 'porcentaje_inicial', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'monto_inicial_usd', type: 'REAL NOT NULL DEFAULT 0' },
    { name: 'estado', type: "TEXT DEFAULT 'PENDIENTE'" },
    { name: 'linea', type: "TEXT DEFAULT 'principal'" },
    { name: 'reconciliado', type: 'INTEGER DEFAULT 0' },
    { name: 'fecha_reconciliacion', type: 'DATETIME' }
  ];

  for (const col of columnsToMigrate) {
    try {
      db.exec(`ALTER TABLE cashea_ventas ADD COLUMN ${col.name} ${col.type}`);
      console.log(`Migración DB: Columna \`${col.name}\` añadida a cashea_ventas.`);
    } catch (e) {
      if (!e.message.includes('duplicate column name')) {
        console.warn(`Advertencia de migración, columna \`${col.name}\` no añadida:`, e.message);
      }
    }
  }

  // MIGRACIÓN: COLUMNAS EXTRA CASHEA_CUOTAS
  const columnsCuotas = [
    { name: 'monto_usd', type: 'REAL NOT NULL DEFAULT 0' },
    { name: 'fecha_vencimiento', type: 'DATE NOT NULL DEFAULT ""' },
    { name: 'fecha_pago', type: 'DATETIME' },
    { name: 'estado', type: "TEXT DEFAULT 'PENDIENTE'" }
  ];

  for (const col of columnsCuotas) {
    try {
      db.exec(`ALTER TABLE cashea_cuotas ADD COLUMN ${col.name} ${col.type}`);
    } catch (e) {}
  }

  // --- NUEVO: Iniciar Cashea desactivado por defecto ---
  try {
    const exists = db.prepare("SELECT 1 FROM settings WHERE key = 'ENABLE_CASHEA'").get();
    if (!exists) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('ENABLE_CASHEA', '0')").run();
      console.log('Configuración: Cashea desactivado por defecto.');
    }
  } catch (e) {
    console.warn('Error inicializando ENABLE_CASHEA:', e.message);
  }

  // ==========================================================
  // METODOS DE PAGO DINÁMICOS & TASAS PERSONALIZADAS
  // ==========================================================
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasas_personalizadas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        nombre TEXT NOT NULL,
        valor REAL NOT NULL,
        activo INTEGER DEFAULT 1
      );
    `);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS metodos_pago (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        nombre TEXT NOT NULL,
        moneda TEXT NOT NULL CHECK(moneda IN ('VES', 'USD', 'COP')),
        tipo_tasa TEXT NOT NULL CHECK(tipo_tasa IN ('BCV', 'PARALELO', 'PERSONALIZADA', 'FIJA')),
        tasa_valor REAL DEFAULT NULL,
        tasa_personalizada_key TEXT DEFAULT NULL,
        es_predeterminado INTEGER DEFAULT 0,
        activo INTEGER DEFAULT 1,
        FOREIGN KEY (tasa_personalizada_key) REFERENCES tasas_personalizadas(key) ON DELETE SET NULL
      );
    `);

    // Seed metodosDefault
    const metodosDefault = [
      { key: 'VES_EFECTIVO', nombre: 'Efectivo Bs', moneda: 'VES', tipo_tasa: 'BCV', tasa_valor: null, tasa_personalizada_key: null, es_predeterminado: 1 },
      { key: 'USD_EFECTIVO', nombre: 'Efectivo $', moneda: 'USD', tipo_tasa: 'BCV', tasa_valor: null, tasa_personalizada_key: null, es_predeterminado: 1 },
      { key: 'TARJETA', nombre: 'Tarjeta', moneda: 'VES', tipo_tasa: 'BCV', tasa_valor: null, tasa_personalizada_key: null, es_predeterminado: 1 },
      { key: 'PUNTO_VENTA', nombre: 'Punto de Venta', moneda: 'VES', tipo_tasa: 'BCV', tasa_valor: null, tasa_personalizada_key: null, es_predeterminado: 1 },
      { key: 'BIOPAGO', nombre: 'Biopago', moneda: 'VES', tipo_tasa: 'BCV', tasa_valor: null, tasa_personalizada_key: null, es_predeterminado: 1 },
      { key: 'PAGOMOVIL', nombre: 'Pago Móvil', moneda: 'VES', tipo_tasa: 'BCV', tasa_valor: null, tasa_personalizada_key: null, es_predeterminado: 1 },
      { key: 'TRANSFERENCIA', nombre: 'Transferencia', moneda: 'VES', tipo_tasa: 'BCV', tasa_valor: null, tasa_personalizada_key: null, es_predeterminado: 1 },
      { key: 'COP_EFECTIVO', nombre: 'Pesos Colombianos (Efectivo)', moneda: 'COP', tipo_tasa: 'COP', tasa_valor: null, tasa_personalizada_key: null, es_predeterminado: 1 },
      { key: 'COP_TRANSFERENCIA', nombre: 'Pesos Colombianos (Transferencia)', moneda: 'COP', tipo_tasa: 'COP', tasa_valor: null, tasa_personalizada_key: null, es_predeterminado: 1 },
      { key: 'CASHEA', nombre: 'Cashea', moneda: 'USD', tipo_tasa: 'BCV', tasa_valor: null, tasa_personalizada_key: null, es_predeterminado: 1 }
    ];

    const insertMetodoDefault = db.prepare(`
      INSERT OR IGNORE INTO metodos_pago (key, nombre, moneda, tipo_tasa, tasa_valor, tasa_personalizada_key, es_predeterminado, activo)
      VALUES (@key, @nombre, @moneda, @tipo_tasa, @tasa_valor, @tasa_personalizada_key, @es_predeterminado, 1)
    `);
    metodosDefault.forEach(m => insertMetodoDefault.run(m));

    // Migración de venta_pagos para remover check constraint
    const tableDefVP = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='venta_pagos'").get();
    if (tableDefVP && tableDefVP.sql.includes('CHECK')) {
      console.log('Migración DB: Actualizando venta_pagos para remover restricción CHECK de métodos...');
      
      const migrationVP = db.transaction(() => {
        // 1. Crear tabla temporal sin CHECK
        db.exec(`
          CREATE TABLE venta_pagos_temp (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            venta_id INTEGER NOT NULL,
            metodo TEXT NOT NULL,
            monto_recibido REAL NOT NULL,
            monto_en_ves REAL NOT NULL,
            tasa_bcv_momento REAL,
            FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE CASCADE
          );
        `);

        // 2. Copiar datos
        db.exec(`
          INSERT INTO venta_pagos_temp (id, venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento)
          SELECT id, venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento
          FROM venta_pagos;
        `);

        // 3. Dropear anterior
        db.exec('DROP TABLE venta_pagos');

        // 4. Renombrar
        db.exec('ALTER TABLE venta_pagos_temp RENAME TO venta_pagos');
      });

      migrationVP();
      console.log('Migración DB: Tabla venta_pagos actualizada (CHECK removido).');
    }
  } catch (e) {
    console.error('Error al inicializar métodos de pago/tasas dinámicas:', e.message);
  }

  // ==========================
  // AUDITORÍA + USUARIOS INTERNOS (Fase 4)
  // ==========================
  try {
    require('./utils/audit').ensureTables();
    console.log('Tablas de auditoría y usuarios verificadas.');
  } catch (e) {
    console.error('Error creando tablas de auditoría/usuarios:', e.message);
  }

  console.log('--- FINAL DE INICIALIZACIÓN DE DB (Base de datos lista) ---');
}

module.exports = {
  get db() { return db; },
  initializeDB,
  closeDatabase,
  reopenDatabase
};
