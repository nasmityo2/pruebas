// controllers/sales.controller.js
const { db } = require('../src/database');
const { loadSettings, getDataBasePath } = require('../src/utils/settings');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

// ===== STATEMENTS GENERALES =====

const getRatesStmt = db.prepare(
  "SELECT key, value FROM settings WHERE key IN ('BCV', 'PARALELO', 'COP', 'CALC_METHOD', 'IVA_PERCENTAGE', 'IVA_MODE')"
);

// Productos
const getProductCountStmt = db.prepare(
  'SELECT COUNT(*) as count FROM productos WHERE nombre LIKE ? OR proveedor LIKE ? OR barcode LIKE ? OR categoria LIKE ?'
);
const getPaginatedProductsStmt = db.prepare(
  'SELECT * FROM productos WHERE nombre LIKE ? OR proveedor LIKE ? OR barcode LIKE ? OR categoria LIKE ? ORDER BY nombre ASC LIMIT ? OFFSET ?'
);
const exportAllProductsStmt = db.prepare(
  'SELECT id, nombre, costo, moneda_costo, porcentaje_ganancia, stock, categoria, tipo_venta, proveedor, barcode, costo_bulto, unidades_bulto FROM productos ORDER BY id ASC'
);
const exportCategoryProductsStmt = db.prepare(
  'SELECT id, nombre, costo, moneda_costo, porcentaje_ganancia, stock, categoria, tipo_venta, proveedor, barcode, costo_bulto, unidades_bulto FROM productos WHERE categoria = ? ORDER BY id ASC'
);
const createProductStmt = db.prepare(
  'INSERT INTO productos (nombre, costo, moneda_costo, porcentaje_ganancia, stock, categoria, tipo_venta, proveedor, barcode, costo_bulto, unidades_bulto) VALUES (@nombre, @costo, @moneda_costo, @porcentaje_ganancia, @stock, @categoria, @tipo_venta, @proveedor, @barcode, @costo_bulto, @unidades_bulto)'
);
const getProductByIdStmt = db.prepare(
  'SELECT id, nombre, stock, costo, moneda_costo, porcentaje_ganancia, tipo_venta, proveedor, categoria, barcode, costo_bulto, unidades_bulto, exento_iva FROM productos WHERE id = ?'
);
const updateProductStmt = db.prepare(
  'UPDATE productos SET nombre = @nombre, costo = @costo, moneda_costo = @moneda_costo, porcentaje_ganancia = @porcentaje_ganancia, stock = @stock, categoria = @categoria, tipo_venta = @tipo_venta, proveedor = @proveedor, barcode = @barcode, costo_bulto = @costo_bulto, unidades_bulto = @unidades_bulto WHERE id = @id'
);
const deleteProductStmt = db.prepare('DELETE FROM productos WHERE id = ?');
const getProductByBarcodeStmt = db.prepare('SELECT * FROM productos WHERE barcode = ?');
const updateBarcodeStmt = db.prepare('UPDATE productos SET barcode = @barcode WHERE id = @id');
const getBultoProductsStmt = db.prepare(
  'SELECT id, nombre, costo, moneda_costo, costo_bulto, unidades_bulto FROM productos WHERE unidades_bulto > 1 ORDER BY nombre ASC'
);

// Categorías
const getCategoriesStmt = db.prepare('SELECT * FROM categorias ORDER BY nombre ASC');
const createCategoryStmt = db.prepare('INSERT OR IGNORE INTO categorias (nombre) VALUES (?)');
const getCategoryByIdStmt = db.prepare('SELECT nombre FROM categorias WHERE id = ?');
const getCategoryUsageStmt = db.prepare('SELECT COUNT(id) as count FROM productos WHERE categoria = ?');
const updateCategoryNameStmt = db.prepare('UPDATE categorias SET nombre = ? WHERE id = ?');
const updateProductsCategoryStmt = db.prepare('UPDATE productos SET categoria = ? WHERE categoria = ?');
const deleteCategoryStmt = db.prepare('DELETE FROM categorias WHERE id = ?');

// Ventas / Clientes / Abonos
const getSaleByIdStmt = db.prepare('SELECT * FROM ventas WHERE id = ?');
const getSaleProductsBySaleIdStmt = db.prepare(`
  SELECT vp.*, 
         COALESCE(p.nombre, vp.nombre, (SELECT nombre FROM productos WHERE id = vp.producto_id LIMIT 1), '[Producto Eliminado] #' || IFNULL(vp.producto_id, 'S/ID')) as producto_nombre, 
         COALESCE(p.exento_iva, vp.exento_iva) as exento_iva 
  FROM venta_productos vp 
  LEFT JOIN productos p ON CAST(vp.producto_id AS TEXT) = CAST(p.id AS TEXT) 
  WHERE vp.venta_id = ?
`);
const getSalePaymentsBySaleIdStmt = db.prepare('SELECT * FROM venta_pagos WHERE venta_id = ?');

// 🔴 IMPORTANTE: sólo abonos ACTIVOS (anulado = 0)
const getAbonosBySaleIdStmt = db.prepare(`
  SELECT
    id,
    cliente_id,
    venta_id,
    monto_pagado_ves,
    monto_pagado_usd,
    tasa_bcv_momento AS tasa_usd,
    metodo,
    fecha,
    COALESCE(anulado, 0) AS anulado,
    anulado_en,
    motivo_anulacion
  FROM abonos
  WHERE venta_id = ?
    AND COALESCE(anulado, 0) = 0
  ORDER BY fecha ASC
`);

const getClienteByIdStmt = db.prepare('SELECT * FROM clientes WHERE id = ?');

// 🔽 PARA ANULAR VENTA
const deleteSalePaymentsStmt = db.prepare('DELETE FROM venta_pagos WHERE venta_id = ?');
const deleteSaleAbonosStmt = db.prepare('DELETE FROM abonos WHERE venta_id = ?');
const restoreStockOnCancelStmt = db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?');
const markSaleCancelledStmt = db.prepare(`
  UPDATE ventas
  SET estado_pago = 'ANULADO',
      monto_pendiente_usd = 0
  WHERE id = ?
`);

// 🔽 actualizar estado_pago y monto_pendiente_usd
const updateSaleStatusStmt = db.prepare(`
  UPDATE ventas
  SET estado_pago = ?, monto_pendiente_usd = ?, total_usd_bcv = ?
  WHERE id = ?
`);

const uploadsBasePath = path.join(getDataBasePath(), 'uploads');

// ===== HELPERS =====

function calculateInternalCostVes(product, rates) {
  let costInVes = 0.0;
  const validRates = {
    BCV: typeof rates?.BCV === 'number' ? rates.BCV : 0,
    PARALELO: typeof rates?.PARALELO === 'number' ? rates.PARALELO : 0,
    COP: typeof rates?.COP === 'number' ? rates.COP : 0,
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

  const finalPriceUsdBcv =
    rates?.BCV && rates.BCV > 0 ? finalPriceVes / rates.BCV : 0;
  return {
    ...product,
    costo_en_ves: costInVes,
    precio_final_ves: finalPriceVes,
    precio_final_usd_bcv: finalPriceUsdBcv,
  };
}

const getRates = () => {
  const ratesList = getRatesStmt.all();
  return ratesList.reduce((obj, rate) => {
    obj[rate.key] = rate.value;
    return obj;
  }, {});
};

/**
 * 🔧 Recalcula cuánto falta realmente por pagar en una venta
 * usando los pagos iniciales (venta_pagos) + abonos (SOLO los no anulados),
 * y actualiza ventas.estado_pago / ventas.monto_pendiente_usd.
 */
function recalcSalePendingAndStatus(saleId) {
  const sale = getSaleByIdStmt.get(saleId);
  if (!sale) {
    return null;
  }

  // Ventas anuladas: no tocamos nada
  if (sale.estado_pago === 'ANULADO') {
    return {
      ...sale,
      pendienteVes: 0,
      pendienteUsd: 0,
      monto_pendiente_usd: 0,
      estado_pago: 'ANULADO',
    };
  }

  // Tasa BCV actual (solo para display en Bs del pendiente FINAL)
  const rates = getRates();
  const bcvRate = !isNaN(rates.BCV) && rates.BCV > 0 ? Number(rates.BCV) : 1;

  // ===== LÓGICA DE CALCULO SUPER ESTRICTO (2 DECIMALES) =====

  // 1) Obtener Total Original USD y redondearlo a 4 decimales inmediatamente
  let totalUsdOriginal = Number(sale.total_usd_bcv) || 0;
  let needsTotalUsdFix = false;

  if (totalUsdOriginal <= 0) {
    const totalVes = Number(sale.total_ves) || 0;
    if (totalVes > 0) {
      // Intentar buscar una tasa histórica en los pagos o abonos para no usar la de hoy (que haría bajar la deuda)
      const firstPaymentWithRate = db.prepare("SELECT tasa_bcv_momento FROM venta_pagos WHERE venta_id = ? AND tasa_bcv_momento > 0 LIMIT 1").get(saleId);
      const firstAbonoWithRate = db.prepare("SELECT tasa_bcv_momento FROM abonos WHERE venta_id = ? AND tasa_bcv_momento > 0 LIMIT 1").get(saleId);
      
      let historicalRate = 0;
      if (firstPaymentWithRate) historicalRate = firstPaymentWithRate.tasa_bcv_momento;
      else if (firstAbonoWithRate) historicalRate = firstAbonoWithRate.tasa_bcv_momento;
      else historicalRate = bcvRate;

      if (historicalRate > 0) {
        totalUsdOriginal = totalVes / historicalRate;
        needsTotalUsdFix = true;
      }
    }
  }
  // Enforce 4 decimals
  totalUsdOriginal = Math.round(totalUsdOriginal * 10000) / 10000;

  // Calcular Tasa Implícita de la Venta (para usar como fallback en pagos históricos)
  const totalVesOriginal = Number(sale.total_ves) || 0;
  let saleImpliedRate = 0;
  if (totalUsdOriginal > 0 && totalVesOriginal > 0) {
    saleImpliedRate = totalVesOriginal / totalUsdOriginal;
  } else if (bcvRate > 0) {
    saleImpliedRate = bcvRate;
  }

  // Si no hay deuda original válida, asumo PAGADO y salgo
  if (totalUsdOriginal <= 0) {
    if (sale.estado_pago !== 'PAGADO') {
      updateSaleStatusStmt.run('PAGADO', 0, 0, saleId);
    }
    return { ...sale, total_usd_bcv: 0, pendienteVes: 0, pendienteUsd: 0, monto_pendiente_usd: 0, estado_pago: 'PAGADO' };
  }

  // 2) Sumar pagos iniciales (venta_pagos)
  // Cada pago se convierte a USD y se redondea a 2 decimales INDIVIDUALMENTE antes de sumar
  let totalPagadoUsd = 0;

  const allMethods = db.prepare('SELECT key, moneda FROM metodos_pago').all();
  const methodsCurrencyMap = allMethods.reduce((obj, m) => { obj[m.key] = m.moneda; return obj; }, {});

  const payments = getSalePaymentsBySaleIdStmt.all(saleId);
  payments.forEach((p) => {
    let pagoUsdRaw = 0;
    const currency = methodsCurrencyMap[p.metodo] || 'VES';

    // Si ya venía en USD (USD_EFECTIVO u otro método configurado en USD con monto_recibido)
    if (currency === 'USD' && p.monto_recibido) {
      pagoUsdRaw = Number(p.monto_recibido);
    } else {
      // Conversión desde VES o COP
      const montoVes = Number(p.monto_en_ves) || 0;
      // USAR TASA IMPLICITA SI FALTA
      let tasaPago = Number(p.tasa_bcv_momento);
      if (!tasaPago || tasaPago <= 0) tasaPago = saleImpliedRate;
      if (!tasaPago || tasaPago <= 0) tasaPago = bcvRate || 1;

      pagoUsdRaw = montoVes / tasaPago;
    }

    // SUMA DIRECTA (sin redondear aquí)
    totalPagadoUsd += pagoUsdRaw;
  });

  // 3) Sumar Abonos
  const abonos = getAbonosBySaleIdStmt.all(saleId);
  abonos.forEach((a) => {
    let abonoUsdRaw = 0;
    const abonoCurrency = methodsCurrencyMap[a.metodo] || 'VES';

    // Prioridad: monto_pagado_usd explícito en la BD para USD
    if (abonoCurrency === 'USD' && a.monto_pagado_usd != null && !isNaN(Number(a.monto_pagado_usd))) {
      abonoUsdRaw = Number(a.monto_pagado_usd);
    } else {
      // Fallback: calcular desde VES
      const montoVes = Number(a.monto_pagado_ves) || 0;
      const tasaAbono = Number(a.tasa_usd) || bcvRate || 1;
      abonoUsdRaw = montoVes / tasaAbono;
    }

    // SUMA DIRECTA (sin redondear aquí)
    totalPagadoUsd += abonoUsdRaw;
  });

  // 4) Calcular Pendiente
  let pendienteUsd = totalUsdOriginal - totalPagadoUsd;
  // REDONDEO FINAL A 4 DECIMALES (Para soportar micro-pagos en Bs que no llegan a 1 centavo)
  pendienteUsd = Math.round((pendienteUsd + Number.EPSILON) * 10000) / 10000;

  // ===== REGLAS DE NEGOCIO Y TOLERANCIAS =====

  // 1. FORZADO ABSOLUTO (Relaxed Logic for Recovery)
  // Si la BD dice 'PAGADO', confiamos... pero si hay una deuda evidente (> $0.01),
  // asumimos que fue un error de "auto-cierre" anterior y la mostramos.
  if (sale.estado_pago === 'PAGADO') {
    if (pendienteUsd > 0.01) {
      // WARNING: La deuda es real. Dejamos que el sistema la muestre como pendiente.
    } else {
      pendienteUsd = 0;
    }
  }

  // 2. Tolerancia de redondeo (USD Tolerance)
  // Incrementado a 0.05 USD para manejar picos y tasas paralelas/personalizadas sin desactivar ventas
  if (pendienteUsd > 0 && pendienteUsd <= 0.05) {
    pendienteUsd = 0;
  }

  // 3. Tolerancia negativa (pagó de más por centavos)
  if (pendienteUsd < 0 && pendienteUsd >= -0.05) {
    pendienteUsd = 0;
  }

  // 5) Determinar Estado Final
  let nuevoEstado = '';
  if (pendienteUsd <= 0) {
    nuevoEstado = 'PAGADO';
    pendienteUsd = 0; // Asegurar que no sea -0.00
  } else if (totalPagadoUsd > 0) {
    nuevoEstado = 'ABONADO';
  } else {
    nuevoEstado = 'FIADO';
  }

  // 6) Persistencia solo si cambió algo
  const salePendienteActual = Number(sale.monto_pendiente_usd) || 0;
  const saleTotalUsdActual = Number(sale.total_usd_bcv) || 0;

  if (
    nuevoEstado !== sale.estado_pago ||
    Math.abs(salePendienteActual - pendienteUsd) > 0.0001 ||
    Math.abs(saleTotalUsdActual - totalUsdOriginal) > 0.0001 ||
    needsTotalUsdFix
  ) {
    updateSaleStatusStmt.run(nuevoEstado, pendienteUsd, totalUsdOriginal, saleId);
    sale.estado_pago = nuevoEstado;
    sale.monto_pendiente_usd = pendienteUsd;
    sale.total_usd_bcv = totalUsdOriginal;
  }

  const pendienteVes = Number((pendienteUsd * bcvRate).toFixed(2));

  return {
    ...sale,
    pendienteVes,
    pendienteUsd,
    monto_pendiente_usd: pendienteUsd,
    estado_pago: nuevoEstado,
  };
}



// ===== VENTA: CREAR =====

const processSaleTransaction = db.transaction(
  (cart, payments, totalVes, totalUsd, rates, cliente_id, estado_pago, monto_pendiente_usd, impuesto_total, nota) => {
    const productDetails = {};

    for (const item of cart) {
      if (typeof item.id === 'string' && item.id.startsWith('vl-')) {
        continue;
      }
      const product = getProductByIdStmt.get(item.id);
      if (!product) throw new Error(`Product with ID ${item.id} not found.`);
      if (product.stock < item.quantity) {
        throw new Error(
          `Stock insufficient for ${product.nombre}. Available: ${product.stock}, Required: ${item.quantity}`
        );
      }
      productDetails[item.id] = product;
    }

    const ventaInfo = db
      .prepare(
        'INSERT INTO ventas (total_ves, total_usd_bcv, cliente_id, estado_pago, monto_pendiente_usd, impuesto_total, archivado, nota) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(totalVes, totalUsd, cliente_id, estado_pago, monto_pendiente_usd, impuesto_total, (estado_pago === 'PAGADO' ? 1 : 0), nota);
    const ventaId = ventaInfo.lastInsertRowid;

    // Insertar productos y descontar stock
    for (const item of cart) {
      const isVentaLibre = typeof item.id === 'string' && item.id.startsWith('vl-');
      let costoUnitarioVes = 0;

      if (isVentaLibre) {
        costoUnitarioVes = item.costVes || 0;
      } else {
        const productData = productDetails[item.id];
        costoUnitarioVes = calculateInternalCostVes(productData, rates);
      }

      db.prepare(
        'INSERT INTO venta_productos (venta_id, producto_id, cantidad, precio_unitario_ves, costo_unitario_ves, nombre, exento_iva) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        ventaId,
        isVentaLibre ? null : item.id,
        item.quantity,
        item.priceVes,
        costoUnitarioVes,
        isVentaLibre ? item.name : item.name,
        isVentaLibre ? (item.exento_iva ? 1 : 0) : (productDetails[item.id] ? productDetails[item.id].exento_iva : 1)
      );

      if (!isVentaLibre) {
        const stockUpdateInfo = db
          .prepare('UPDATE productos SET stock = stock - ? WHERE id = ?')
          .run(item.quantity, item.id);
        if (stockUpdateInfo.changes !== 1) {
          throw new Error(
            `Failed to update stock correctly for product ID ${item.id}. Changes: ${stockUpdateInfo.changes}`
          );
        }
      }
    }

    // Insertar pagos iniciales
    const activeMethods = db.prepare('SELECT * FROM metodos_pago WHERE activo = 1').all();
    const methodsMap = activeMethods.reduce((obj, m) => { obj[m.key] = m; return obj; }, {});

    for (const payment of payments) {
      const methodConfig = methodsMap[payment.method];
      if (!methodConfig) {
        throw new Error(`Invalid payment method received: ${payment.method}`);
      }

      const currency = methodConfig.moneda;
      let rateUsed = rates.BCV;
      if (currency === 'USD' && payment.amountReceived > 0) {
        rateUsed = payment.amountInVes / payment.amountReceived;
      }

      db.prepare(
        'INSERT INTO venta_pagos (venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento) VALUES (?, ?, ?, ?, ?)'
      ).run(
        ventaId,
        payment.method,
        payment.amountReceived,
        payment.amountInVes,
        rateUsed
      );
    }

    return ventaId;
  }
);

const processSale = (req, res) => {
  const { cart, payments, totalVes, totalUsd, cliente_id, roundingAdjustment, nota } = req.body;

  if (!Array.isArray(cart) || cart.length === 0)
    return res.status(400).json({ error: 'Cart is empty or invalid.' });
  if (!Array.isArray(payments))
    return res.status(400).json({ error: 'Payment information is missing or invalid.' });
  if (isNaN(parseFloat(totalVes)) || isNaN(parseFloat(totalUsd)))
    return res.status(400).json({ error: 'Total amounts are missing or invalid.' });

  try {
    const currentRates = getRates();
    if (isNaN(currentRates.BCV) || currentRates.BCV <= 0) {
      throw new Error('Tasa BCV no configurada o inválida.');
    }

    const round2 = (n) => Math.round(n * 100) / 100;
    const final_cliente_id = cliente_id || null;
    const round4 = (n) => Math.round(n * 10000) / 10000;

    let finalTotalVes = round2(parseFloat(totalVes));
    const finalTotalUsd = round4(parseFloat(totalUsd));

    let totalPagadoVes = 0;
    payments.forEach((p) => {
      totalPagadoVes += p.amountInVes;
    });

    const USD_TOLERANCE = 0.0001;

    const activeMethods = db.prepare('SELECT * FROM metodos_pago WHERE activo = 1').all();
    const methodsMap = activeMethods.reduce((obj, m) => { obj[m.key] = m; return obj; }, {});

    let totalPagadoUsdEstimado = 0;
    payments.forEach(p => {
      const methodConfig = methodsMap[p.method];
      const currency = methodConfig ? methodConfig.moneda : 'VES';
      
      let valUsd = 0;
      if (currency === 'USD') {
        valUsd = p.amountReceived;
      } else {
        valUsd = p.amountInVes / currentRates.BCV;
      }
      totalPagadoUsdEstimado += valUsd;
    });

    const remainingVes = finalTotalVes - totalPagadoVes;
    const faltanteUsd = Math.max(0, remainingVes) / currentRates.BCV;
    const faltanteVes = Number(Math.max(0, remainingVes).toFixed(2));

    let estado_pago = 'PAGADO';
    let monto_pendiente_usd = 0;

    // Se consideran créditos sólo si supera la tolerancia de USD (0.05) y la tolerancia de VES (0.50)
    if (faltanteUsd > 0.05 && remainingVes > 0.50) {
      if (totalPagadoUsdEstimado > 0.01) {
        estado_pago = 'ABONADO';
      } else {
        estado_pago = 'FIADO';
      }

      if (final_cliente_id === null) {
        return res.status(400).json({
          error: 'Se debe seleccionar un cliente para guardar una venta a crédito.',
        });
      }

      monto_pendiente_usd = round4(faltanteUsd);
      if (monto_pendiente_usd < 0) monto_pendiente_usd = 0;
    }

    let totalImpuestoVes = 0;
    const ivaPercentage = currentRates.IVA_PERCENTAGE !== undefined ? parseFloat(currentRates.IVA_PERCENTAGE) : 16.0;
    const ivaRate = ivaPercentage / 100;
    const ivaMode = currentRates.IVA_MODE === 'EXCLUDED' ? 'EXCLUDED' : 'INCLUDED';

    for (const item of cart) {
      const isVentaLibre = typeof item.id === 'string' && item.id.startsWith('vl-');
      let isExempt = true;

      if (isVentaLibre) {
        isExempt = !!item.exento_iva;
      } else {
        const product = getProductByIdStmt.get(item.id);
        isExempt = !product || (product.exento_iva === 1 || product.exento_iva === true);
      }

      if (!isExempt) {
        const lineTotal = item.priceVes * item.quantity;
        if (ivaMode === 'EXCLUDED') {
          totalImpuestoVes += (lineTotal * ivaRate);
        } else {
          const base = lineTotal / (1 + ivaRate);
          totalImpuestoVes += (lineTotal - base);
        }
      }
    }
    const finalImpuestoVes = Number(totalImpuestoVes.toFixed(2));

    const saleId = processSaleTransaction(
      cart,
      payments,
      finalTotalVes,
      finalTotalUsd,
      currentRates,
      final_cliente_id,
      estado_pago,
      monto_pendiente_usd,
      finalImpuestoVes,
      nota || null
    );

    recalcSalePendingAndStatus(saleId);

    const settings = loadSettings();

    const rawPrintTicket =
      settings.printTicket !== undefined
        ? settings.printTicket
        : (settings.printTicketEnabled !== undefined ? settings.printTicketEnabled : true);

    const normalizedPrintTicket = !!rawPrintTicket;


    const printMode = settings.printMode || 'preview';
    const printerName = settings.printerName || '';
    const printCopies = Number(settings.printCopies) || 1;
    const paperWidth =
      Number(settings.printPaperWidth || settings.ticketSize || 80) || 80;
    const printHeader = settings.printHeader || '';
    const printFooter = settings.printFooter || '';

    let clienteData = null;
    if (final_cliente_id) {
      clienteData = getClienteByIdStmt.get(final_cliente_id);
    }

    res.status(201).json({
      message: 'Sale completed successfully!',
      saleId: saleId,
      estado_pago: estado_pago,
      monto_pendiente: faltanteVes,
      monto_pendiente_usd: monto_pendiente_usd,
      printTicket: normalizedPrintTicket,
      printMode,
      printerName,
      printCopies,
      ticketSize: paperWidth,
      printHeader,
      printFooter,
      printQr: settings.printQr !== false,
      printLogo: settings.printLogo !== false,
      printQrContent: settings.printQrContent || 'https://bodegapp.com.ve',
      logoPath: settings.logoPath || '',
      businessRIF: settings.businessRIF || '',
      businessAddress: settings.businessAddress || '',
      businessPhone: settings.businessPhone || '',
      impuesto_total: finalImpuestoVes,
      cliente: clienteData,
    });
  } catch (error) {
    console.error('Error processing sale transaction:', error);
    res.status(400).json({ error: error.message || 'Failed to process sale.' });
  }
};


// ===== RECIBO PDF =====

const getSaleReceipt = async (req, res) => {
  const saleId = parseInt(req.params.id, 10);
  if (isNaN(saleId)) return res.status(400).send('ID de venta inválido.');

  try {
    const sale = getSaleByIdStmt.get(saleId);
    if (!sale) return res.status(404).send('Venta no encontrada.');

    let cliente = null;
    if (sale.cliente_id) {
      cliente = getClienteByIdStmt.get(sale.cliente_id);
    }

    const ratesList = getRatesStmt.all();
    const currentRates = ratesList.reduce((obj, rate) => {
      obj[rate.key] = rate.value;
      return obj;
    }, {});
    const bcvRate = currentRates.BCV > 0 ? currentRates.BCV : 1;

    const products = getSaleProductsBySaleIdStmt.all(saleId);
    const payments = getSalePaymentsBySaleIdStmt.all(saleId);
    const settings = loadSettings();

    const ticketSize = Number(settings.ticketSize) || 80;
    const is58mm = ticketSize === 58;
    const fontSize = is58mm ? '10px' : '9px';
    const width = is58mm ? 32 : 48; 

    let logoHtml = '';
    const shouldPrintLogo = settings.printLogo !== false;
    if (shouldPrintLogo) {
      const logoFullPath = settings.logoPath ? path.join(uploadsBasePath, path.basename(settings.logoPath)) : null;
      if (logoFullPath && fs.existsSync(logoFullPath)) {
        try {
          const logoData = fs.readFileSync(logoFullPath);
          const base64Image = logoData.toString('base64');
          const ext = path.extname(logoFullPath).toLowerCase().replace('.', '');
          const mime = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/generic');
          logoHtml = `<div style="text-align: center; width: 100%;"><img src="data:${mime};base64,${base64Image}" class="logo" alt="Logo" style="max-width: 45%; max-height: 60px; margin-bottom: 5px;" /></div>`;
        } catch (e) {
          console.error('Error leyendo logo para HTML:', e);
        }
      }
    }

    const formatPriceStr = (num) => Number(num).toFixed(2).replace('.', ',');
    const formatLine = (l, r, w) => {
      l = (l || '').toString();
      r = (r || '').toString();
      if (l.length + r.length >= w) {
        l = l.slice(0, Math.max(0, w - r.length - 1));
        return (l + ' ' + r).slice(0, w);
      }
      return l + ' '.repeat(w - l.length - r.length) + r;
    };

    const line = '-'.repeat(width);
    let text = '';

    const clientRif = cliente ? cliente.cedula : 'V-000000000';
    const clientName = cliente ? cliente.nombre.toUpperCase() : 'AL MAYOR / CONSUMIDOR FINAL';
    const clientDir = (cliente && cliente.direccion) ? cliente.direccion.toUpperCase() : 'N/A';
    const clientPhone = (cliente && cliente.telefono) ? cliente.telefono : 'N/A';

    const headerLines = (settings.printHeader || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (headerLines.length > 0) {
      headerLines.forEach(l => {
        text += ' '.repeat(Math.max(0, Math.floor((width - l.length) / 2))) + l.toUpperCase() + '\n';
      });
    }

    const bizRIF = settings.businessRIF || '';
    const bizAddr = settings.businessAddress || '';
    const bizPhone = settings.businessPhone || '';

    if (bizRIF) text += ' '.repeat(Math.max(0, Math.floor((width - bizRIF.length - 5) / 2))) + `RIF: ${bizRIF.toUpperCase()}\n`;
    if (bizAddr) {
      const addrLines = bizAddr.split('\n');
      addrLines.forEach(l => {
        text += ' '.repeat(Math.max(0, Math.floor((width - l.length) / 2))) + l.toUpperCase() + '\n';
      });
    }
    if (bizPhone) text += ' '.repeat(Math.max(0, Math.floor((width - bizPhone.length - 5) / 2))) + `TEL: ${bizPhone}\n`;

    if (headerLines.length === 0 && !bizRIF && !bizAddr && !bizPhone) {
      const hddef = 'SENIAT\nRIF J-000000000\nMI NEGOCIO CA\nCALLE PRINCIPAL S/N\nESTADO';
      hddef.split('\n').forEach(l => {
        text += ' '.repeat(Math.max(0, Math.floor((width - l.length) / 2))) + l + '\n';
      });
    }
    text += '\n';

    text += `RIF/C.I.: ${clientRif}\n`;
    text += `RAZON SOCIAL: ${clientName.length > width - 14 ? clientName.slice(0, width - 14) : clientName}\n`;
    text += `Direccion: ${clientDir.length > width - 11 ? clientDir.slice(0, width - 11) : clientDir}\n`;
    text += `Telefono: ${clientPhone.length > width - 10 ? clientPhone.slice(0, width - 10) : clientPhone}\n`;
    text += `Ref. Interna: ${String(sale.id).padStart(10, '0')}\n`;
    text += `Vendedor: 01\n`;
    text += ' '.repeat(Math.max(0, Math.floor((width - 6) / 2))) + 'RECIBO\n\n';

    const saleDate = new Date(sale.creado_en);
    const fStr = ('0' + saleDate.getDate()).slice(-2) + '-' + ('0' + (saleDate.getMonth() + 1)).slice(-2) + '-' + saleDate.getFullYear();
    const hStr = saleDate.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

    text += formatLine(`RECIBO:`, String(sale.id).padStart(8, '0'), width) + '\n';
    text += formatLine(`FECHA: ${fStr}`, `HORA: ${hStr}`, width) + '\n';
    text += line + '\n';

    let subtotal = 0;
    products.forEach(p => {
      const isExempt = (p.exento_iva === 1 || p.exento_iva === true || p.exento_iva === '1');
      const indicator = isExempt ? '(E)' : '(G)';
      const name = (p.producto_nombre || `Prod ${p.producto_id}`).toUpperCase() + ` ${indicator}`;
      const truncName = name.length > width - 14 ? name.slice(0, width - 14) : name;
      const totalItem = p.cantidad * p.precio_unitario_ves;
      subtotal += totalItem;

      const qtyStr = Number(p.cantidad || 0).toFixed(2).replace('.', ',');
      const leftPart = `${qtyStr} ${truncName}`;
      
      const totalItemUsd = totalItem / bcvRate;
      const rightPart = `Bs ${formatPriceStr(totalItem)} ($ ${totalItemUsd.toFixed(2)})`;
      text += formatLine(leftPart, rightPart, width) + '\n';
    });

    text += line + '\n';
    text += formatLine('SUBTTL', `Bs ${formatPriceStr(subtotal)}`, width) + '\n';
    text += formatLine('SUBTTL ($)', `$ ${Number(subtotal / bcvRate).toFixed(2)}`, width) + '\n';
    text += line + '\n';

    const impuesto_total = sale.impuesto_total || 0;
    if (impuesto_total > 0) {
      const base = Math.max(0, subtotal - impuesto_total);
      const lBase = `BI G16,00%`;
      const valBase = `Bs ${formatPriceStr(base)}`;
      const lIva = `IVA G16,00%`;
      const valIva = `Bs ${formatPriceStr(impuesto_total)}`;

      if (width >= 48) {
        const p1 = lBase.padEnd(10) + '  ' + valBase.padStart(11);
        const p2 = '  ' + lIva.padEnd(12) + ' ' + valIva.padStart(10);
        text += (p1 + p2).slice(0, width) + '\n';
      } else {
        text += formatLine(lBase, valBase, width) + '\n';
        text += formatLine(lIva, valIva, width) + '\n';
      }
      text += line + '\n';
    }

    payments.forEach(p => {
      let m = p.metodo === 'VES_EFECTIVO' ? 'EFECTIVO' :
        p.metodo === 'USD_EFECTIVO' ? 'EFE DIVISA' :
          p.metodo === 'PUNTO_VENTA' ? 'PUNTO' :
            p.metodo === 'BIOPAGO' ? 'BIOPAGO' :
              p.metodo === 'TARJETA' ? 'TARJETA' :
                p.metodo === 'PAGOMOVIL' ? 'PAGOMOVIL' : p.metodo;
      text += formatLine(m, `Bs ${formatPriceStr(Number(p.monto_en_ves))}`, width) + '\n';
    });

    text += line + '\n';
    text += formatLine('TOTAL', `Bs ${formatPriceStr(sale.total_ves)}`, width) + '\n';
    text += formatLine('TOTAL ($)', `$ ${Number(sale.total_usd_bcv || (sale.total_ves / bcvRate)).toFixed(2)}`, width) + '\n';

    if (sale.monto_pendiente_usd > 0) {
      text += line + '\n';
      const pVES = sale.monto_pendiente_usd * bcvRate;
      text += formatLine('PENDIENTE Bs:', `Bs ${formatPriceStr(pVES)}`, width) + '\n';
      text += formatLine('PENDIENTE $:', `$ ${formatPriceStr(sale.monto_pendiente_usd)}`, width) + '\n';
    }

    const hash = 'Z' + Math.random().toString(36).substring(2, 6).toUpperCase() + String(sale.id).padStart(4, '0');
    text += hash.padStart(width, ' ') + '\n';

    const footerLines = (settings.printFooter || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
    footerLines.forEach(l => {
      text += ' '.repeat(Math.max(0, Math.floor((width - l.length) / 2))) + l + '\n';
    });
    text += '\n' + ' '.repeat(Math.max(0, Math.floor((width - 19) / 2))) + 'DOCUMENTO NO FISCAL\n';

    let qrImage = '';
    if (settings.printQr !== false) {
      try {
        qrImage = await QRCode.toDataURL(settings.printQrContent || 'https://bodegapp.com.ve');
      } catch (err) {
        console.error('Error generating QR code for HTML receipt:', err);
      }
    }

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recibo #${sale.id}</title>
  <style>
    body {
      background-color: #f3f4f6;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
    }
    .toolbar {
      position: sticky;
      top: 0;
      width: 100%;
      background: white;
      padding: 10px 0;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      display: flex;
      justify-content: center;
      gap: 15px;
      z-index: 100;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      border: none;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 14px;
    }
    .btn-print { background-color: #2563eb; color: white; }
    .btn-close { background-color: #ef4444; color: white; }
    .preview-container {
      margin-top: 20px;
      margin-bottom: 40px;
      background: white;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
      padding: 0;
      width: ${is58mm ? '58mm' : '80mm'};
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    }
    .receipt-body {
      font-family: 'Courier New', Courier, monospace; 
      font-weight: bold;
      font-size: ${fontSize};
      line-height: 1.1;
      color: #000;
      padding: 0 4mm;
      margin: 10px 0;
      white-space: pre; 
      overflow: hidden; 
      width: 100%;
      box-sizing: border-box;
    }
    @media print {
      body { background: none; margin: 0; padding: 0; }
      .toolbar, .btn { display: none !important; }
      .preview-container { box-shadow: none; margin: 0; padding: 0; width: ${is58mm ? '58mm' : '80mm'}; border: none; }
      .receipt-body { width: 100%; white-space: pre; word-break: normal; }
      @page { size: auto; margin: 0mm; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="btn btn-print" onclick="window.print()">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
      </svg>
      Imprimir
    </button>
    <button class="btn btn-close" onclick="window.close()">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
      Cerrar
    </button>
  </div>
  <div class="preview-container">
    ${settings.printLogo !== false ? logoHtml : ''}
    <pre class="receipt-body">${text}</pre>
    ${settings.printQr !== false && qrImage ? `
    <div style="display: flex; justify-content: center; margin-bottom: 10px;">
      <img src="${qrImage}" 
            style="width: 35mm; height: 35mm; image-rendering: pixelated;">
    </div>
    ` : ''}
  </div>
  <script>
    window.onload = function() {
      setTimeout(() => { window.print(); }, 500);
    };
  </script>
</body>
</html>
    `;

    res.send(html);

  } catch (error) {
    console.error(`Error generando recibo HTML para venta ${saleId}:`, error);
    res.status(500).send('Error interno al generar el recibo.');
  }
};

// ===== DETALLES DE VENTA (para la vista) =====

const getSaleDetails = (req, res) => {
  const { id } = req.params;
  const saleId = parseInt(id, 10);

  if (isNaN(saleId)) {
    return res.status(400).json({ error: 'ID de venta inválido.' });
  }

  try {
    const sale = recalcSalePendingAndStatus(saleId);
    if (!sale) {
      return res.status(404).json({ error: 'Venta no encontrada.' });
    }

    let cliente = null;
    if (sale.cliente_id) {
      cliente = getClienteByIdStmt.get(sale.cliente_id);
    }

    const products = getSaleProductsBySaleIdStmt.all(saleId);
    const payments = getSalePaymentsBySaleIdStmt.all(saleId);
    const abonos = getAbonosBySaleIdStmt.all(saleId);

    res.json({
      sale,
      cliente,
      products,
      payments,
      abonos,
    });
  } catch (error) {
    console.error(`Error obteniendo detalles de venta ${saleId}: `, error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
};

// ===== REGISTRAR VUELTO (cambio) =====

const registerChange = (req, res) => {
  const saleId = req.params.id;
  const { changePayments } = req.body;

  if (!changePayments || changePayments.length === 0) {
    return res.status(200).json({ message: 'No change to register.' });
  }

  try {
    const rates = getRates();

    const insertChangeStmt = db.prepare(
      'INSERT INTO venta_pagos (venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento) VALUES (?, ?, ?, ?, ?)'
    );

    const transaction = db.transaction((payments) => {
      for (const p of payments) {
        const amount = parseFloat(p.amount) * -1;

        let amountInVes = 0;
        let tasa = null;

        if (p.method === 'USD_EFECTIVO') {
          tasa = rates.BCV;
          amountInVes = amount * tasa;
        } else {
          amountInVes = amount;
        }

        insertChangeStmt.run(saleId, p.method, amount, amountInVes, tasa);
      }
    });

    transaction(changePayments);
    res.json({ success: true, message: 'Vuelto registrado correctamente en el sistema.' });
  } catch (error) {
    console.error('Error registrando el vuelto:', error);
    res.status(500).json({ error: 'Error interno al registrar el vuelto.' });
  }
};

// ===== ANULAR VENTA (revertir stock + borrar pagos + borrar abonos) =====

const cancelSale = (req, res) => {
  const saleId = parseInt(req.params.id, 10);
  if (isNaN(saleId)) {
    return res.status(400).json({ error: 'ID de venta inválido.' });
  }

  try {
    const tx = db.transaction((id) => {
      const sale = getSaleByIdStmt.get(id);
      if (!sale) {
        throw new Error('Venta no encontrada.');
      }

      if (sale.estado_pago === 'ANULADO') {
        return { alreadyCancelled: true };
      }

      const items = getSaleProductsBySaleIdStmt.all(id);
      items.forEach((item) => {
        restoreStockOnCancelStmt.run(item.cantidad, item.producto_id);
      });

      deleteSalePaymentsStmt.run(id);
      deleteSaleAbonosStmt.run(id);
      markSaleCancelledStmt.run(id);

      return { alreadyCancelled: false };
    });

    const result = tx(saleId);

    if (result.alreadyCancelled) {
      return res.json({
        success: true,
        message: 'La venta ya estaba anulada previamente.',
      });
    }

    return res.json({
      success: true,
      message: 'Venta anulada correctamente. Stock restaurado y pagos/abonos eliminados.',
    });
  } catch (error) {
    console.error(`Error anulando venta ${saleId}: `, error);
    return res.status(500).json({ error: 'Error interno al anular la venta.' });
  }
};

module.exports = {
  processSale,
  getSaleReceipt,
  getSaleDetails,
  registerChange,
  cancelSale,
  recalcSalePendingAndStatus,
};
