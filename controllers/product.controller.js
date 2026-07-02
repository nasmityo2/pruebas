const { db } = require('../src/database');
const fs = require('fs');
const path = require('path');
const fastcsv = require('fast-csv');
const csv = require('csv-parser');
const xlsx = require('xlsx'); // Importamos librería para Excel
const { getDataBasePath } = require('../src/utils/settings');
const { ensureUnlocked, operatorFromReq } = require('../src/utils/adminUnlock');
const { logAction } = require('../src/utils/audit');

const getRatesStmt = db.prepare(
  "SELECT key, value FROM settings WHERE key IN ('BCV', 'PARALELO', 'COP', 'CALC_METHOD')"
);

// MODIFICACIÓN 1: Añadir 'activo = 1' para filtrar en búsqueda e inventario
const getProductCountStmt = db.prepare(
  'SELECT COUNT(*) as count FROM productos WHERE activo = 1 AND (nombre LIKE ? OR proveedor LIKE ? OR barcode LIKE ? OR categoria LIKE ?)'
);
const getPaginatedProductsStmt = db.prepare(
  'SELECT * FROM productos WHERE activo = 1 AND (nombre LIKE ? OR proveedor LIKE ? OR barcode LIKE ? OR categoria LIKE ?) ORDER BY nombre ASC LIMIT ? OFFSET ?'
);

// Export con todos los campos incluyendo 'activo'
const exportAllProductsStmt = db.prepare(`
  SELECT id, nombre, costo, moneda_costo, porcentaje_ganancia,
         stock, categoria, tipo_venta, proveedor, barcode,
         costo_bulto, unidades_bulto, activo
  FROM productos
  ORDER BY id ASC
`);

const exportCategoryProductsStmt = db.prepare(`
  SELECT id, nombre, costo, moneda_costo, porcentaje_ganancia,
         stock, categoria, tipo_venta, proveedor, barcode,
         costo_bulto, unidades_bulto, activo
  FROM productos
  WHERE categoria = ?
  ORDER BY id ASC
`);

// MODIFICACIÓN 2: Añadir 'activo' a la sentencia de creación para el valor por defecto
const createProductStmt = db.prepare(`
  INSERT INTO productos (
    nombre, costo, moneda_costo, porcentaje_ganancia, stock,
    categoria, tipo_venta, proveedor, barcode, costo_bulto,
    unidades_bulto, activo, exento_iva
  ) VALUES (
    @nombre, @costo, @moneda_costo, @porcentaje_ganancia, @stock,
    @categoria, @tipo_venta, @proveedor, @barcode, @costo_bulto,
    @unidades_bulto, @activo, @exento_iva
  )
`);

const getProductByIdStmt = db.prepare(
  'SELECT id, nombre, stock, costo, moneda_costo, porcentaje_ganancia, tipo_venta, proveedor, categoria, barcode, costo_bulto, unidades_bulto, exento_iva FROM productos WHERE id = ?'
);

const updateProductStmt = db.prepare(`
  UPDATE productos
  SET nombre = @nombre,
      costo = @costo,
      moneda_costo = @moneda_costo,
      porcentaje_ganancia = @porcentaje_ganancia,
      stock = @stock,
      categoria = @categoria,
      tipo_venta = @tipo_venta,
      proveedor = @proveedor,
      barcode = @barcode,
      costo_bulto = @costo_bulto,
      unidades_bulto = @unidades_bulto,
      exento_iva = @exento_iva
  WHERE id = @id
`);

// MODIFICACIÓN 3: Cambiar DELETE por UPDATE (Soft Delete)
const softDeleteProductStmt = db.prepare('UPDATE productos SET activo = 0, barcode = NULL WHERE id = ?');
const softDeletePresentationsByProductIdStmt = db.prepare('UPDATE presentaciones SET activo = 0, barcode = NULL WHERE producto_id = ?');

// MODIFICACIÓN 4: Añadir 'activo = 1' a la búsqueda por código de barras
const getProductByBarcodeStmt = db.prepare('SELECT * FROM productos WHERE barcode = ? AND activo = 1');

const updateBarcodeStmt = db.prepare('UPDATE productos SET barcode = @barcode WHERE id = @id');
const updateImageStmt = db.prepare('UPDATE productos SET imagen = @imagen WHERE id = @id');

// UPDATE por Barcode (Para Importación/Upsert)
const updateProductByBarcodeStmt = db.prepare(`
  UPDATE productos
  SET nombre = @nombre,
      costo = @costo,
      moneda_costo = @moneda_costo,
      porcentaje_ganancia = @porcentaje_ganancia,
      stock = @stock,
      categoria = @categoria,
      tipo_venta = @tipo_venta,
      proveedor = @proveedor,
      costo_bulto = @costo_bulto,
      unidades_bulto = @unidades_bulto,
      exento_iva = @exento_iva,
      activo = @activo
  WHERE barcode = @barcode
`);

// MODIFICACIÓN 5: Añadir 'activo = 1' a la búsqueda por bultos
const getBultoProductsStmt = db.prepare(`
  SELECT id, nombre, costo, moneda_costo, costo_bulto, unidades_bulto, categoria, proveedor
  FROM productos
  WHERE unidades_bulto > 1 AND activo = 1
  ORDER BY nombre ASC
`);

// Presentaciones ligadas al producto
const getPresentationsByProductIdStmt = db.prepare(`
  SELECT
    id,
    producto_id,
    nombre,
    unidades_base,
    precio_ves,
    precio_usd_bcv,
    moneda,
    precio,
    barcode
  FROM presentaciones
  WHERE producto_id = ? AND activo = 1
  ORDER BY nombre ASC
`);

const getCategoriesStmt = db.prepare('SELECT * FROM categorias ORDER BY nombre ASC');
const createCategoryStmt = db.prepare('INSERT OR IGNORE INTO categorias (nombre) VALUES (?)');
const getCategoryByIdStmt = db.prepare('SELECT nombre FROM categorias WHERE id = ?');
const getCategoryUsageStmt = db.prepare('SELECT COUNT(id) as count FROM productos WHERE categoria = ?');
const updateCategoryNameStmt = db.prepare('UPDATE categorias SET nombre = ? WHERE id = ?');
const updateProductsCategoryStmt = db.prepare('UPDATE productos SET categoria = ? WHERE categoria = ?');
const deleteCategoryStmt = db.prepare('DELETE FROM categorias WHERE id = ?');

function calculateInternalCostVes(product, rates) {
  let costInVes = 0.0;

  const validRates = {
    BCV: typeof rates?.BCV === 'number' ? rates.BCV : 0,
    PARALELO: typeof rates?.PARALELO === 'number' ? rates.PARALELO : 0,
    COP: typeof rates?.COP === 'number' ? rates.COP : 0
  };

  switch (product.moneda_costo) {
    case 'VES':
      costInVes = product.costo;
      break;
    case 'BCV':
      costInVes = product.costo * validRates.BCV;
      break;
    case 'PARALELO':
      costInVes = product.costo * validRates.PARALELO;
      break;
    case 'COP':
      costInVes = product.costo * validRates.COP;
      break;
    default:
      console.error(`Unknown cost currency: ${product.moneda_costo} for product ID ${product.id}`);
  }

  return costInVes;
}

function calculateSalePrices(product, rates) {
  const costInVes = calculateInternalCostVes(product, rates);
  let finalPriceVes = 0;

  const calcMethod = rates.CALC_METHOD || 1;
  const percentage = product.porcentaje_ganancia / 100;

  if (calcMethod === 2) {
    if (percentage >= 1) {
      finalPriceVes = costInVes;
    } else {
      finalPriceVes = costInVes / (1 - percentage);
    }
  } else {
    finalPriceVes = costInVes * (1 + percentage);
  }

  const finalPriceUsdBcv = rates?.BCV && rates.BCV > 0 ? finalPriceVes / rates.BCV : 0;
  return {
    ...product,
    costo_en_ves: costInVes,
    precio_final_ves: finalPriceVes,
    precio_final_usd_bcv: finalPriceUsdBcv
  };
}

// Normaliza tasas desde la BD a números (incluye CALC_METHOD)
const getRates = () => {
  const ratesList = getRatesStmt.all();
  return ratesList.reduce((obj, rate) => {
    if (rate.key === 'CALC_METHOD') {
      const n = parseInt(rate.value, 10);
      obj[rate.key] = Number.isNaN(n) ? 1 : n;
    } else {
      const n = parseFloat(rate.value);
      obj[rate.key] = Number.isNaN(n) ? 0 : n;
    }
    return obj;
  }, {});
};

/**
 * Mapea un producto de la BD a la estructura que usará el POS:
 * - Aplica cálculo de precios de la unidad base.
 * - Agrega arreglo `presentations` con las presentaciones del producto.
 */
function mapProductWithPresentations(prod, rates) {
  if (prod.stock !== undefined && prod.stock !== null) {
    prod.stock = Number(parseFloat(prod.stock).toFixed(4));
  }
  const baseProduct = calculateSalePrices(prod, rates);
  const presentationsDB = getPresentationsByProductIdStmt.all(prod.id);

  const bcv = parseFloat(rates?.BCV || 0) || 0;
  const paralelo = parseFloat(rates?.PARALELO || 0) || 0;
  const cop = parseFloat(rates?.COP || 0) || 0;

  const presentations = presentationsDB.map((p) => {
    // Unidades base
    const unidadesBase =
      parseFloat(
        p.unidades_base !== undefined
          ? p.unidades_base
          : p.unidades !== undefined
            ? p.unidades
            : 1
      ) || 1;

    const moneda = p.moneda || 'VES';
    const precioBase = parseFloat(p.precio || 0) || 0;

    let precioVes = 0;
    let precioUsd = 0;

    // 1. Calcular precio en VES según moneda base
    if (precioBase > 0) {
      if (moneda === 'VES') {
        precioVes = precioBase;
        // Si es VES, el precio en Bolívares es FIJO.
      } else if (moneda === 'BCV') {
        precioVes = precioBase * bcv;
      } else if (moneda === 'PARALELO') {
        precioVes = precioBase * paralelo;
      } else if (moneda === 'COP') {
        precioVes = precioBase * cop;
      }
    }

    // 2. Calcular referencial en USD_BCV
    // (Siempre mostramos referencia en USD BCV, aunque el origen sea otro)
    if (precioVes > 0 && bcv > 0) {
      precioUsd = precioVes / bcv;
    }

    // Fallback: si precioBase es 0 (legacy data), usamos los antiguos
    if (precioBase <= 0 && p.precio_ves > 0) {
      precioVes = parseFloat(p.precio_ves);
      if (bcv > 0) precioUsd = p.precio_ves / bcv;
    }

    return {
      id: p.id,
      nombre: p.nombre,
      unidades_base: unidadesBase,
      precio_usd_bcv: precioUsd,
      precio_ves: precioVes,
      barcode: p.barcode || null,
      moneda: moneda, // Enviamos estos datos al front también
      precio: precioBase
    };
  });

  return {
    ...baseProduct,
    presentations
  };
}

// Helper to detect and map a2 Software exports
function detectAndMapA2Export(dataRows) {
  let headerIdx = -1;
  for (let i = 0; i < Math.min(dataRows.length, 25); i++) {
    const row = dataRows[i];
    if (!row) continue;
    const rowStr = JSON.stringify(row).toLowerCase();
    if ((rowStr.includes('descripcion') || rowStr.includes('descripción')) &&
      (rowStr.includes('codigo') || rowStr.includes('código'))) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) return null;

  const headers = dataRows[headerIdx];
  const mapping = { barcode: -1, nombre: -1, stock: -1, costo: -1, pvp: -1 };

  headers.forEach((h, idx) => {
    if (!h) return;
    const s = String(h).toLowerCase().trim();
    if (s.includes('codigo') || s.includes('código')) mapping.barcode = idx;
    else if (s.includes('descripcion') || s.includes('descripción') || s === 'nombre') mapping.nombre = idx;
    else if (s.includes('existencia') || s.includes('cantidad') || s === 'stock') mapping.stock = idx;
    else if (s.includes('costo')) mapping.costo = idx;
    else if (s === 'pvp' || s.includes('precio 1')) mapping.pvp = idx;
    else if (s === 'precio' && mapping.pvp === -1) mapping.pvp = idx;
  });

  if (mapping.pvp === 9 && headers[12] && String(headers[12]).toLowerCase().includes('pvp')) {
    mapping.pvp = 12;
    mapping.costo = 9;
  }
  if (mapping.pvp === -1 && mapping.costo !== -1) mapping.pvp = mapping.costo;

  if (mapping.nombre === -1) return null;

  const products = [];
  for (let i = headerIdx + 1; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row || row.length === 0) continue;
    if (!row[mapping.nombre] && !row[mapping.barcode]) continue;

    const nombre = String(row[mapping.nombre] || '').trim();
    if (!nombre || nombre.toLowerCase() === 'descripcion' || nombre.toLowerCase() === 'descripción' || nombre.includes('Página')) continue;

    const getVal = (idx) => {
      if (idx === -1) return 0;
      if (row[idx] !== null && row[idx] !== undefined && row[idx] !== '') return row[idx];
      for (let s = 1; s <= 8; s++) {
        if (row[idx + s] !== null && row[idx + s] !== undefined && row[idx + s] !== '') return row[idx + s];
      }
      return 0;
    };

    products.push({
      nombre,
      barcode: mapping.barcode !== -1 ? String(row[mapping.barcode] || '').trim() || null : null,
      stock: parseFloat(getVal(mapping.stock)) || 0,
      costo: parseFloat(getVal(mapping.costo)) || 0,
      precio_final: parseFloat(getVal(mapping.pvp)) || 0
    });
  }
  return products;
}

const getProducts = (req, res) => {
  const search = req.query.search || '';
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 40;
  const offset = (page - 1) * limit;
  const searchTerm = `%${search}%`;

  try {
    const rates = getRates();
    const totalProductsResult = getProductCountStmt.get(
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm
    );
    const totalProducts = totalProductsResult.count;
    const totalPages = Math.ceil(totalProducts / limit);

    const productsDB = getPaginatedProductsStmt.all(
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
      limit,
      offset
    );

    // ⬇️ Aquí devolvemos cada producto con precios + arreglo `presentations`
    const productsWithPrices = productsDB.map((prod) =>
      mapProductWithPresentations(prod, rates)
    );

    res.json({
      products: productsWithPrices,
      totalPages,
      currentPage: page,
      totalProducts
    });
  } catch (error) {
    console.error('Error getting paginated products:', error);
    res
      .status(500)
      .json({ error: 'Internal server error getting paginated products' });
  }
};

const exportProducts = (req, res) => {
  try {
    const categoria = req.query.categoria || null;
    let products;
    let categoryName = '';

    if (categoria && categoria !== '_TODAS_') {
      products = exportCategoryProductsStmt.all(categoria);
      categoryName = `-${categoria}`;
    } else {
      products = exportAllProductsStmt.all();
    }

    // Mapear a columnas legibles para el Excel
    const data = products.map(p => ({
      'Nombre': p.nombre,
      'Costo': p.costo,
      'Moneda Costo': p.moneda_costo || 'BCV',
      'Ganancia %': p.porcentaje_ganancia,
      'Stock': p.stock !== undefined && p.stock !== null ? Number(parseFloat(p.stock).toFixed(4)) : 0,
      'Categoría': p.categoria || 'General',
      'Tipo Venta': p.tipo_venta || 'UNIDAD',
      'Proveedor': p.proveedor || '',
      'Código de Barras': p.barcode || '',
      'Costo Bulto': p.costo_bulto,
      'Unidades Bulto': p.unidades_bulto,
      'Activo': p.activo
    }));

    const ws = xlsx.utils.json_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Inventario');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const filename = `export-productos${categoryName}-${timestamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(buffer);
  } catch (error) {
    console.error('Error exporting products:', error);
    res.status(500).json({ error: 'Error exporting products' });
  }
};

const importProducts = (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  // DIAGNOSTIC LOG
  try {
    const logPath = path.join(__dirname, '../DEBUG_IMPORT.txt');
    const info = `\n[${new Date().toISOString()}] Uploaded: ${req.file.originalname}\n`;
    fs.appendFileSync(logPath, info);
  } catch (e) { console.error("Log error", e); }

  const filePath = req.file.path;
  const isExcel = filePath.match(/\.(xlsx|xls)$/i);

  // Helper para limpiar números (quita letras, símbolos y maneja coma como decimal)
  const cleanNumber = (val) => {
    if (!val) return 0;
    const str = String(val).trim();
    if (str === '') return 0;

    // Eliminamos todo lo que NO sea número, punto, coma o guión
    let clean = str.replace(/[^0-9.,-]/g, '');

    // Si la cadena tiene comas, las tratamos como puntos decimales
    clean = clean.replace(/,/g, '.');

    // Resolver múltiples puntos
    const lastDotIndex = clean.lastIndexOf('.');
    if (lastDotIndex !== -1) {
      const integerPart = clean.substring(0, lastDotIndex).replace(/\./g, '');
      const decimalPart = clean.substring(lastDotIndex);
      clean = integerPart + decimalPart;
    }

    return parseFloat(clean) || 0;
  };

  const processImport = (productsToImport) => {
    const importTransaction = db.transaction((products) => {
      let count = 0;
      let errors = [];

      const shouldConvert = req.body.convertFromVes === 'true';
      const rates = getRates();
      const bcvRate = rates.BCV || 0;

      for (const [index, prod] of products.entries()) {
        try {
          // --- Lógica de Mapeo Flexible ---
          const normalizeKey = (k) => k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\*/g, "");
          const rowData = {};
          Object.keys(prod).forEach(k => {
            rowData[normalizeKey(k)] = prod[k];
          });

          const getValue = (possibleKeys) => {
            for (const key of possibleKeys) {
              const normalized = normalizeKey(key);
              if (rowData[normalized] !== undefined && rowData[normalized] !== '') {
                return rowData[normalized];
              }
            }
            return null;
          };

          const valNombre = getValue(['nombre', 'descripcion', 'producto', 'description', 'product', 'nombre del producto']);
          const valCosto = getValue(['costo', 'precio costo', 'costo unitario', 'cost', 'p. costo', 'p costo', 'precio de costo', 'costo promedio']);
          const valPrecioVenta = getValue(['precio_final', 'precio venta', 'precio', 'price', 'precio 1', 'p. venta', 'p venta', 'precio de venta', 'precio publico']);
          const valGanancia = getValue(['porcentaje_ganancia', 'ganancia', 'utilidad', 'margen', 'ganancia %', '% ganancia']);
          const valCategoria = getValue(['categoria', 'departamento', 'familia', 'category', 'rubro']);
          const valStock = getValue(['stock', 'existencia', 'inventario', 'cantidad', 'quantity', 'inventario actual', 'existencia actual']);
          const valBarcode = getValue(['barcode', 'codigo', 'codigo de barras', 'code', 'id', 'código de barras', 'codigo articulo']);
          const valMoneda = getValue(['moneda_costo', 'moneda', 'moneda costo']);

          const valCostoBulto = getValue(['costo_bulto', 'costo bulto', 'costo de bulto']);
          const valUnidadesBulto = getValue(['unidades_bulto', 'unidades bulto', 'cantidad bulto', 'piezas por bulto']);
          const valTipoVenta = getValue(['tipo_venta', 'tipo de venta', 'unidad', 'forma de venta']);
          const valProveedor = getValue(['proveedor', 'provider']);
          const valExento = getValue(['exento_iva', 'exento', 'iva', 'is_exempt', 'tax_exempt']);
          const valActivo = getValue(['activo', 'active', 'estado', 'status', 'habilitado']);

          if (!valNombre) {
            errors.push(`Row ${index + 1}: Could not find product name. Check headers.`);
            continue;
          }

          let monedaCosto = valMoneda ? valMoneda.toUpperCase() : 'BCV';

          let costoUnitario = cleanNumber(valCosto);
          try { if (index === 0) { const logPath = path.join(__dirname, '../DEBUG_IMPORT.txt'); fs.appendFileSync(logPath, `Row 0 Calc: Costo=${costoUnitario}, ValCosto=${valCosto}, Type=${typeof valCosto}\n`); } } catch (e) { }
          let costoBulto = cleanNumber(valCostoBulto);
          let unidadesBulto = parseInt(cleanNumber(valUnidadesBulto), 10) || 1;

          // LÓGICA DE CONVERSIÓN (Nueva solicitud)
          if (shouldConvert) {
            if (bcvRate > 0) {
              // Asumimos que los valores en el CSV vienen en Bs
              // Convertimos a USD
              costoUnitario = costoUnitario / bcvRate;
              if (costoBulto > 0) {
                costoBulto = costoBulto / bcvRate;
              }
              // Forzamos la moneda a BCV
              monedaCosto = 'BCV';
            } else {
              // Si no hay tasa, no podemos convertir con seguridad. 
              // Podríamos agregar un error o simplemente no convertir.
              // Decisión: Loggear advertencia y continuar sin convertir (o tratar como VES)
              // Pero para no bloquear todo, seguiremos como si nada, el usuario verá que sigue en Bs.
            }
          }

          if (unidadesBulto < 1) unidadesBulto = 1;

          if (costoBulto > 0 && unidadesBulto > 1) {
            if (costoUnitario === 0) costoUnitario = costoBulto / unidadesBulto;
          } else if (costoUnitario > 0) {
            costoBulto = costoUnitario;
            unidadesBulto = 1;
          }

          let porcentajeGanancia = cleanNumber(valGanancia);
          if (porcentajeGanancia === 0 && valPrecioVenta) {
            let precioVenta = cleanNumber(valPrecioVenta);

            // Si convertimos costo, debemos convertir precio para calcular ganancia correctamente
            if (shouldConvert && bcvRate > 0) {
              precioVenta = precioVenta / bcvRate;
            }

            if (precioVenta > 0 && costoUnitario > 0) {
              porcentajeGanancia = ((precioVenta / costoUnitario) - 1) * 100;
              porcentajeGanancia = Number(porcentajeGanancia.toFixed(8));
            } else {
              porcentajeGanancia = 30;
            }
          } else if (porcentajeGanancia === 0) {
            porcentajeGanancia = 30;
          }

          const categoriaFinal = valCategoria ? valCategoria.trim() : 'General';
          let tipoVentaFinal = 'UNIDAD';
          if (valTipoVenta) {
            const tv = valTipoVenta.toUpperCase();
            if (tv.includes('PESO') || tv.includes('KG') || tv.includes('GRANEL')) tipoVentaFinal = 'PESO';
          }

          // Auto-detectar si es por PESO basado en decimales del stock
          const stockValue = cleanNumber(valStock);
          if (tipoVentaFinal === 'UNIDAD' && stockValue % 1 !== 0) {
            tipoVentaFinal = 'PESO';
          }

          // DEBUG LOG


          // Determinar valor de exento_iva (default 0)
          let exentoVal = 0;
          if (valExento) {
            const cleanExento = String(valExento).trim().toLowerCase();
            if (cleanExento === '1' || cleanExento === 'true' || cleanExento === 'si' || cleanExento === 'yes') {
              exentoVal = 1;
            }
          }

          createCategoryStmt.run(categoriaFinal);

          const finalActivo = (() => {
            if (valActivo !== null && valActivo !== undefined) {
              const s = String(valActivo).trim().toLowerCase();
              if (s === '0' || s === 'false' || s === 'no' || s === 'inactivo') return 0;
            }
            return 1;
          })();

          let existingId = null;
          if (valBarcode) {
            const row = db.prepare('SELECT id FROM productos WHERE barcode = ?').get(valBarcode.trim());
            if (row) existingId = row.id;
          }

          if (existingId) {
            // UPDATE
            try { if (index === 0) { const logPath = path.join(__dirname, '../DEBUG_IMPORT.txt'); fs.appendFileSync(logPath, `Row 0 Action: UPDATE ID ${existingId}\n`); } } catch (e) { }
            const info = updateProductByBarcodeStmt.run({
              nombre: valNombre.trim(),
              costo: costoUnitario,
              moneda_costo: monedaCosto,
              porcentaje_ganancia: porcentajeGanancia,
              stock: stockValue,
              categoria: categoriaFinal,
              tipo_venta: tipoVentaFinal,
              proveedor: valProveedor ? valProveedor.trim() : '',
              barcode: valBarcode.trim(),
              costo_bulto: costoBulto,
              unidades_bulto: unidadesBulto,
              exento_iva: exentoVal,
              activo: finalActivo
            });
            if (info.changes > 0) {
              count++;
            } else {
              errors.push(`Row ${index + 1}: El producto existe (ID ${existingId}) pero no se pudo actualizar.`);
            }
          } else {
            // INSERT
            try { if (index === 0) { const logPath = path.join(__dirname, '../DEBUG_IMPORT.txt'); fs.appendFileSync(logPath, `Row 0 Action: INSERT\n`); } } catch (e) { }
            createProductStmt.run({
              nombre: valNombre.trim(),
              costo: costoUnitario,
              moneda_costo: monedaCosto,
              porcentaje_ganancia: porcentajeGanancia,
              stock: stockValue,
              categoria: categoriaFinal,
              tipo_venta: tipoVentaFinal,
              proveedor: valProveedor ? valProveedor.trim() : '',
              barcode: valBarcode ? valBarcode.trim() : null,
              costo_bulto: costoBulto,
              unidades_bulto: unidadesBulto,
              exento_iva: exentoVal,
              activo: finalActivo
            });
            count++;
          }

        } catch (err) {
          console.error(`Error processing row ${index + 1}:`, err.message);
          errors.push(`Row ${index + 1}: ${err.message}`);
        }
      }

      if (errors.length > 0) return { count, errors };
      return { count };
    });

    try {
      const result = importTransaction(productsToImport);
      fs.unlink(filePath, () => { });

      let msg = `Import successful! Added ${result.count} products.`;
      if (result.errors && result.errors.length > 0) {
        msg = `Partial import: ${result.count} added. ${result.errors.length} errors/skips.`;
        return res.status(207).json({ message: msg, errors: result.errors });
      }
      res.json({ message: msg });
    } catch (error) {
      console.error('Transaction error:', error);
      fs.unlink(filePath, () => { });
      res.status(500).json({ error: `Database error: ${error.message}` });
    }
  };


  // --- Caso 1: Archivo EXCEL (.xlsx, .xls) ---
  if (isExcel) {
    try {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0]; // Usamos la primera hoja
      const sheet = workbook.Sheets[sheetName];

      // Intento de detección formato a2
      const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      const a2Products = detectAndMapA2Export(rawData);

      if (a2Products) {
        processImport(a2Products);
      } else {
        // Mapeo flexible estándar
        const productsToImport = xlsx.utils.sheet_to_json(sheet);
        processImport(productsToImport);
      }
    } catch (err) {
      console.error('Error reading Excel file:', err);
      fs.unlink(filePath, () => { });
      res.status(400).json({ error: `Error reading Excel file: ${err.message}` });
    }
    return;
  }

  // --- Caso 2: Archivo CSV (Original) ---
  const detectSeparator = async (file) => {
    return new Promise((resolve) => {
      const stream = fs.createReadStream(file, { start: 0, end: 1024, encoding: 'utf8' });
      stream.on('data', (chunk) => {
        const firstLine = chunk.split(/\r\n|\r|\n/)[0];
        const commaCount = (firstLine.match(/,/g) || []).length;
        const semicolonCount = (firstLine.match(/;/g) || []).length;
        stream.destroy();
        resolve(semicolonCount >= commaCount ? ';' : ',');
      });
      stream.on('error', () => resolve(';'));
      stream.on('end', () => resolve(';'));
    });
  };

  detectSeparator(filePath).then((separator) => {
    const productsToImport = [];

    fs.createReadStream(filePath, { encoding: 'utf8' })
      .pipe(
        csv({
          separator: separator,
          mapHeaders: ({ header }) => header.trim()
        })
      )
      .on('data', (data) => productsToImport.push(data))
      .on('error', (err) => {
        console.error('Error reading CSV:', err);
        fs.unlink(filePath, () => { });
        res.status(400).json({
          error: `Error reading CSV file. (Detected separator: '${separator}')`
        });
      })
      .on('end', () => {
        if (productsToImport.length === 0) {
          fs.unlink(filePath, () => { });
          return res.status(400).json({ error: 'CSV empty or format unrecognized.' });
        }
        processImport(productsToImport);
      });
  });
};

const createProduct = (req, res) => {
  const {
    nombre,
    costMode,
    costo_bulto,
    unidades_bulto = 1,
    costo,
    moneda_costo,
    porcentaje_ganancia,
    stock = 0,
    categoria,
    tipo_venta = 'UNIDAD',
    proveedor = '',
    barcode = null,
    exento_iva
  } = req.body;

  if (
    !nombre?.trim() ||
    !moneda_costo?.trim() ||
    isNaN(parseFloat(porcentaje_ganancia)) ||
    !categoria?.trim()
  ) {
    return res.status(400).json({
      error: 'Faltan campos obligatorios (nombre, moneda, ganancia, categoría).'
    });
  }

  let final_costo_unitario = parseFloat(costo) || 0;
  let final_costo_bulto = parseFloat(costo_bulto) || 0;
  let final_unidades_bulto = parseInt(unidades_bulto, 10) || 1;

  if (costMode === 'bulto') {
    if (final_costo_bulto <= 0 || final_unidades_bulto <= 0) {
      return res.status(400).json({
        error: 'El costo y unidades del bulto deben ser mayores a cero.'
      });
    }
    final_costo_unitario = final_costo_bulto / final_unidades_bulto;
  } else {
    if (final_costo_unitario <= 0) {
      return res
        .status(400)
        .json({ error: 'El costo unitario debe ser mayor a cero.' });
    }
    final_costo_bulto = final_costo_unitario;
    final_unidades_bulto = 1;
  }

  const validCurrencies = ['VES', 'BCV', 'PARALELO', 'COP'];
  if (!validCurrencies.includes(moneda_costo.toUpperCase())) {
    return res.status(400).json({ error: `Moneda inválida.` });
  }

  if (!['UNIDAD', 'PESO', 'LITRO', 'METRO'].includes(tipo_venta)) {
    return res.status(400).json({ error: 'Tipo de venta inválido.' });
  }

  // Si no se envía explicitamente, asumimos 1 (Exento) por defecto para nuevos productos,
  // pero el frontend debería enviarlo.
  // Pero espera, el frontend checkbox "checked" = exento (1).
  const valExento = (exento_iva === 1 || exento_iva === '1' || exento_iva === true) ? 1 : 0;

  try {
    createCategoryStmt.run(categoria.trim());
    const info = createProductStmt.run({
      nombre: nombre.trim(),
      costo: final_costo_unitario,
      moneda_costo: moneda_costo.toUpperCase(),
      porcentaje_ganancia: parseFloat(porcentaje_ganancia),
      stock: Number(parseFloat(stock).toFixed(4)) || 0,
      categoria: categoria.trim(),
      tipo_venta: tipo_venta,
      proveedor: proveedor,
      barcode: barcode || null,
      costo_bulto: final_costo_bulto,
      unidades_bulto: final_unidades_bulto,
      exento_iva: valExento,
      activo: 1
    });

    res
      .status(201)
      .json({ message: 'Product created successfully', id: info.lastInsertRowid });
  } catch (error) {
    console.error('Error creating product:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res
        .status(409)
        .json({ error: `El código de barras '${barcode}' ya está en uso.` });
    }
    if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
      return res.status(400).json({
        error: `Database constraint failed: ${error.message}`
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getProductById = (req, res) => {
  try {
    const product = getProductByIdStmt.get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.stock !== undefined && product.stock !== null) {
      product.stock = Number(parseFloat(product.stock).toFixed(4));
    }
    res.json(product);
  } catch (error) {
    console.error(`Error getting product ID ${req.params.id}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateProduct = (req, res) => {
  const { id } = req.params;
  const {
    nombre,
    costMode,
    costo_bulto,
    unidades_bulto = 1,
    costo,
    moneda_costo,
    porcentaje_ganancia,
    stock,
    categoria,
    tipo_venta,
    proveedor,
    barcode,
    exento_iva
  } = req.body;

  if (
    !nombre?.trim() ||
    !moneda_costo?.trim() ||
    isNaN(parseFloat(porcentaje_ganancia)) ||
    isNaN(parseFloat(stock)) ||
    !categoria?.trim()
  ) {
    return res.status(400).json({
      error:
        'Faltan campos obligatorios (nombre, moneda, ganancia, stock, categoría).'
    });
  }

  let final_costo_unitario = parseFloat(costo) || 0;
  let final_costo_bulto = parseFloat(costo_bulto) || 0;
  let final_unidades_bulto = parseInt(unidades_bulto, 10) || 1;

  if (costMode === 'bulto') {
    if (final_costo_bulto <= 0 || final_unidades_bulto <= 0) {
      return res.status(400).json({
        error: 'El costo y unidades del bulto deben ser mayores a cero.'
      });
    }
    final_costo_unitario = final_costo_bulto / final_unidades_bulto;
  } else {
    if (final_costo_unitario <= 0) {
      return res
        .status(400)
        .json({ error: 'El costo unitario debe ser mayor a cero.' });
    }
    final_costo_bulto = final_costo_unitario;
    final_unidades_bulto = 1;
  }

  const validCurrencies = ['VES', 'BCV', 'PARALELO', 'COP'];
  if (!validCurrencies.includes(moneda_costo.toUpperCase())) {
    return res.status(400).json({ error: `Moneda inválida.` });
  }
  if (!['UNIDAD', 'PESO', 'LITRO', 'METRO'].includes(tipo_venta)) {
    return res.status(400).json({ error: 'Tipo de venta inválido.' });
  }

  const valExento = (exento_iva === 1 || exento_iva === '1' || exento_iva === true) ? 1 : 0;

  try {
    createCategoryStmt.run(categoria.trim());
    const info = updateProductStmt.run({
      id: parseInt(id, 10),
      nombre: nombre.trim(),
      costo: final_costo_unitario,
      moneda_costo: moneda_costo.toUpperCase(),
      porcentaje_ganancia: parseFloat(porcentaje_ganancia),
      stock: Number(parseFloat(stock).toFixed(4)),
      categoria: categoria.trim(),
      tipo_venta: tipo_venta,
      proveedor: proveedor || '',
      barcode: barcode || null,
      costo_bulto: final_costo_bulto,
      unidades_bulto: final_unidades_bulto,
      exento_iva: valExento
    });

    if (info.changes === 0)
      return res
        .status(404)
        .json({ error: 'Product not found or no changes made' });

    res.json({ message: 'Product updated successfully' });
  } catch (error) {
    console.error(`Error updating product ID ${id}:`, error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({
        error: `El código de barras '${barcode}' ya está en uso por otro producto.`
      });
    }
    if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
      return res.status(400).json({
        error: `Database constraint failed: ${error.message}`
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateImage = (req, res) => {
  const { id } = req.params;
  const imagen = req.file ? req.file.filename : null;

  try {
    const info = updateImageStmt.run({ imagen, id });
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ message: 'Image updated successfully', imagen });
  } catch (error) {
    console.error(`Error updating image for product ID ${req.params.id}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteProduct = (req, res) => {
  try {
    if (!ensureUnlocked(req, res)) return; // requiere clave admin (si está configurada)
    const product = getProductByIdStmt.get(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    // Soft Delete product and presentations in a transaction
    const deleteTx = db.transaction((productId) => {
      softDeleteProductStmt.run(productId);
      softDeletePresentationsByProductIdStmt.run(productId);
    });
    
    deleteTx(req.params.id);
    logAction({
      usuario: operatorFromReq(req), rol: 'admin', accion: 'PRODUCT_DELETE',
      entidad: 'producto', entidadId: req.params.id,
      detalle: { nombre: product.nombre }, ip: req.ip,
    });
    res.json({ message: 'Producto y sus presentaciones eliminados (ocultados) con éxito' });
  } catch (error) {
    console.error(`Error deleting product ID ${req.params.id}:`, error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

const getProductByBarcode = (req, res) => {
  const { barcode } = req.params;
  if (!barcode) {
    return res.status(400).json({ error: 'No barcode provided' });
  }
  try {
    const product = getProductByBarcodeStmt.get(barcode);
    if (!product) {
      return res
        .status(404)
        .json({ error: 'Producto no encontrado con ese código de barras.' });
    }
    const rates = getRates();

    // ⬇️ Ahora devolvemos producto + prices + presentations
    const productWithPrices = mapProductWithPresentations(product, rates);

    res.json(productWithPrices);
  } catch (error) {
    console.error('Error getting product by barcode:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateBarcode = (req, res) => {
  const { id } = req.params;
  const { barcode } = req.body;
  const finalBarcode = barcode || null;

  try {
    const info = updateBarcodeStmt.run({
      id: parseInt(id, 10),
      barcode: finalBarcode
    });
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    res.json({ success: true, message: 'Código de barras actualizado.' });
  } catch (error) {
    console.error('Error updating barcode:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res
        .status(409)
        .json({ error: `El código de barras '${finalBarcode}' ya está en uso.` });
    }
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

const getCategories = (req, res) => {
  try {
    res.json(getCategoriesStmt.all());
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateCategory = (req, res) => {
  const { id } = req.params;
  const { newName } = req.body;

  if (!newName || newName.trim() === '') {
    return res.status(400).json({ error: 'El nuevo nombre no puede estar vacío.' });
  }

  const findOldName = db.transaction(() => {
    const category = getCategoryByIdStmt.get(id);
    if (!category) {
      throw new Error('Category not found');
    }

    updateProductsCategoryStmt.run(newName, category.nombre);
    updateCategoryNameStmt.run(newName, id);
  });

  try {
    findOldName();
    res.json({ success: true, message: 'Categoría actualizada con éxito.' });
  } catch (error) {
    console.error('Error actualizando categoría:', error);
    if (error.message === 'Category not found') {
      return res.status(404).json({ error: 'Categoría no encontrada.' });
    }
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

const deleteCategory = (req, res) => {
  const { id } = req.params;
  try {
    const category = getCategoryByIdStmt.get(id);
    if (!category) {
      return res.status(404).json({ error: 'Categoría no encontrada.' });
    }

    const usage = getCategoryUsageStmt.get(category.nombre);
    if (usage.count > 0) {
      return res.status(400).json({
        error: `La categoría "${category.nombre}" está en uso por ${usage.count} producto(s) y no se puede eliminar.`
      });
    }

    deleteCategoryStmt.run(id);
    res.json({ success: true, message: 'Categoría eliminada con éxito.' });
  } catch (error) {
    console.error('Error eliminando categoría:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateStock = (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;

  const qty = parseFloat(quantity);
  if (isNaN(qty)) {
    return res.status(400).json({ error: 'La cantidad debe ser un número válido.' });
  }

  try {
    const info = db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?').run(qty, id);

    if (info.changes === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }

    const updatedProduct = db.prepare('SELECT stock FROM productos WHERE id = ?').get(id);
    res.json({ message: 'Stock actualizado', newStock: updatedProduct.stock });
  } catch (error) {
    console.error('Error updating stock:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

const getBultoProducts = (req, res) => {
  try {
    const products = getBultoProductsStmt.all();
    res.json(products);
  } catch (error) {
    console.error('Error al obtener productos por bulto:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// --- MASS ACTIONS ---
const deleteProductsMassive = (req, res) => {
  if (!ensureUnlocked(req, res)) return; // requiere clave admin (si está configurada)
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: 'No se proporcionaron IDs.' });
  }

  // Transaction for soft delete of products and presentations
  const deleteTransaction = db.transaction((productIds) => {
    let deletedCount = 0;
    for (const id of productIds) {
      const info = softDeleteProductStmt.run(id);
      softDeletePresentationsByProductIdStmt.run(id);
      deletedCount += info.changes;
    }
    return deletedCount;
  });

  try {
    const count = deleteTransaction(ids);
    logAction({
      usuario: operatorFromReq(req), rol: 'admin', accion: 'PRODUCT_DELETE_MASS',
      entidad: 'producto', detalle: { count, ids }, ip: req.ip,
    });
    res.json({ success: true, message: `${count} productos eliminados correctamente.` });
  } catch (error) {
    console.error('Error en eliminación masiva:', error);
    res.status(500).json({ success: false, message: 'Error interno al eliminar productos.' });
  }
};

const updateProductsProfitMassive = (req, res) => {
  const { percentage, category, ids } = req.body;

  if (percentage === undefined || percentage === null || isNaN(parseFloat(percentage))) {
    return res.status(400).json({ success: false, message: 'Porcentaje inválido.' });
  }

  const newPercentage = parseFloat(percentage);

  try {
    let stmt;
    let info;

    // NOTE: NOT updating last_updated_at because schema in database.js confirms no such column in `productos`.
    if (ids && Array.isArray(ids) && ids.length > 0) {
      // Scope: Selected IDs
      const placeholders = ids.map(() => '?').join(',');
      stmt = db.prepare(`UPDATE productos SET porcentaje_ganancia = ? WHERE id IN (${placeholders})`);
      info = stmt.run(newPercentage, ...ids);
    } else if (category && category !== '' && category !== '_TODAS_') {
      stmt = db.prepare("UPDATE productos SET porcentaje_ganancia = ? WHERE categoria = ? AND activo = 1");
      info = stmt.run(newPercentage, category);
    } else {
      stmt = db.prepare("UPDATE productos SET porcentaje_ganancia = ? WHERE activo = 1");
      info = stmt.run(newPercentage);
    }

    res.json({ success: true, message: `${info.changes} productos actualizados con éxito.` });
  } catch (error) {
    console.error('Error en actualización masiva de ganancia:', error);
    res.status(500).json({ success: false, message: 'Error interno al actualizar ganancias.' });
  }
};

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  exportProducts,
  importProducts,
  getCategories,
  updateCategory,
  deleteCategory,
  getProductByBarcode,
  updateBarcode,
  getBultoProducts,
  updateStock,
  deleteProductsMassive,
  updateProductsProfitMassive,
  updateImage
};
