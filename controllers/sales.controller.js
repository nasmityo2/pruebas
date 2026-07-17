// controllers/sales.controller.js
const { db } = require('../src/database');
const { loadSettings, getDataBasePath } = require('../src/utils/settings');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const salePricing = require('../src/services/salePricing');
const adminUnlock = require('../src/utils/adminUnlock');

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
  'SELECT id, nombre, stock, costo, moneda_costo, porcentaje_ganancia, tipo_venta, proveedor, categoria, barcode, costo_bulto, unidades_bulto, exento_iva, activo FROM productos WHERE id = ?'
);
const getPresentationForSaleStmt = db.prepare(
  'SELECT id, producto_id, nombre, unidades_base, precio_ves, precio_usd_bcv, moneda, precio, activo FROM presentaciones WHERE id = ?'
);
const updateProductStmt = db.prepare(
  'UPDATE productos SET nombre = @nombre, costo = @costo, moneda_costo = @moneda_costo, porcentaje_ganancia = @porcentaje_ganancia, stock = @stock, categoria = @categoria, tipo_venta = @tipo_venta, proveedor = @proveedor, barcode = @barcode, costo_bulto = @costo_bulto, unidades_bulto = @unidades_bulto WHERE id = @id'
);
// NOTA (Fase 5): se eliminó `deleteProductStmt` (DELETE FROM productos). El borrado de
// productos es SIEMPRE soft-delete (columna `activo`) en product.controller.js.
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
const getSalePaymentsBySaleIdStmt = db.prepare(
  'SELECT * FROM venta_pagos WHERE venta_id = ? AND COALESCE(activo, 1) = 1'
);

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

// NOTA (Anexo A A.6): la anulación de ventas la maneja `voidSale` en `reports.controller.js`
// (ruteado, con clave admin, soft-delete de abonos). El antiguo `cancelSale` de este archivo
// estaba EXPORTADO pero SIN ruta y hacía borrado físico de abonos/pagos: se eliminó.

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
    // Anexo A A.4: las tasas pueden estar guardadas como TEXTO (p. ej. bcvUpdater guarda BCV
    // con `toFixed(8)`), y `calculateInternalCostVes` descarta valores no numéricos (costo 0).
    // Se coercionan a número aquí; IVA_MODE es texto y se deja tal cual.
    if (rate.key === 'IVA_MODE') {
      obj[rate.key] = rate.value;
    } else {
      const n = parseFloat(rate.value);
      obj[rate.key] = Number.isNaN(n) ? rate.value : n;
    }
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
      const firstPaymentWithRate = db.prepare("SELECT tasa_bcv_momento FROM venta_pagos WHERE venta_id = ? AND COALESCE(activo, 1) = 1 AND tasa_bcv_momento > 0 LIMIT 1").get(saleId);
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

const processSaleTransaction = db.transaction((sale) => {
  const ventaInfo = db.prepare(`
    INSERT INTO ventas (
      total_ves, total_usd_bcv, cliente_id, estado_pago, monto_pendiente_usd,
      impuesto_total, archivado, nota, tasa_bcv
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sale.pricing.totalVes,
    sale.pricing.totalUsd,
    sale.clienteId,
    sale.estadoPago,
    sale.montoPendienteUsd,
    sale.pricing.taxTotalVes,
    sale.estadoPago === 'PAGADO' ? 1 : 0,
    sale.nota,
    sale.pricing.bcv,
  );
  const ventaId = ventaInfo.lastInsertRowid;

  const insertLine = db.prepare(`
    INSERT INTO venta_productos (
      venta_id, producto_id, cantidad, precio_unitario_ves, costo_unitario_ves,
      nombre, exento_iva, presentacion_id, presentacion_nombre, cantidad_venta,
      unidades_base, tasa_bcv_momento, impuesto_unitario_ves, precio_origen, moneda_precio
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStock = db.prepare(
    'UPDATE productos SET stock = stock - ? WHERE id = ? AND activo = 1 AND stock >= ?'
  );
  for (const line of sale.pricing.lines) {
    insertLine.run(
      ventaId,
      line.productId,
      line.quantity,
      line.unitPriceVes,
      line.costUnitVes,
      line.name,
      line.exempt ? 1 : 0,
      line.presentationId,
      line.presentationName,
      line.saleQuantity,
      line.unitsBase,
      sale.pricing.bcv,
      line.quantity > 0 ? salePricing.round4(line.tax / line.quantity) : 0,
      line.priceSource,
      line.priceCurrency,
    );
    if (line.productId !== null) {
      const result = updateStock.run(line.quantity, line.productId, line.quantity);
      if (result.changes !== 1) throw new Error(`Stock insuficiente para el producto ${line.productId}.`);
    }
  }

  const insertPayment = db.prepare(`
    INSERT INTO venta_pagos (
      venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento, activo
    ) VALUES (?, ?, ?, ?, ?, 1)
  `);
  for (const payment of sale.paymentResult.payments) {
    insertPayment.run(
      ventaId,
      payment.method,
      payment.amountReceived,
      payment.amountInVes,
      payment.conversionRate,
    );
  }

  const replay = {
    saleId: Number(ventaId),
    estado_pago: sale.estadoPago,
    monto_pendiente: salePricing.round2(Math.max(0, sale.pricing.totalVes - sale.paymentResult.totalPaidVes)),
    monto_pendiente_usd: sale.montoPendienteUsd,
    impuesto_total: sale.pricing.taxTotalVes,
    total_ves: sale.pricing.totalVes,
    total_usd: sale.pricing.totalUsd,
  };
  db.prepare(
    'INSERT INTO sale_requests (request_id, venta_id, response_json) VALUES (?, ?, ?)'
  ).run(sale.requestId, ventaId, JSON.stringify(replay));
  return replay;
});

const processSale = (req, res) => {
  const { cart, payments, cliente_id, nota } = req.body || {};
  const requestId = String(req.headers['x-idempotency-key'] || req.body?.requestId || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) {
    return res.status(400).json({ error: 'Falta una clave de idempotencia válida.' });
  }
  try {
    const existing = db.prepare('SELECT response_json FROM sale_requests WHERE request_id = ?').get(requestId);
    if (existing && existing.response_json) {
      return res.status(200).json({ ...JSON.parse(existing.response_json), replayed: true });
    }

    const currentRates = getRates();
    if (isNaN(currentRates.BCV) || currentRates.BCV <= 0) {
      throw new Error('Tasa BCV no configurada o inválida.');
    }
    const activeMethods = db.prepare('SELECT * FROM metodos_pago WHERE activo = 1').all();
    const customRates = db.prepare('SELECT key, valor FROM tasas_personalizadas WHERE activo = 1')
      .all()
      .reduce((result, rate) => {
        result[rate.key] = Number(rate.valor);
        return result;
      }, {});
    const allowPriceOverride = adminUnlock.verifyUnlock(adminUnlock.tokenFromReq(req));
    const pricing = salePricing.buildCanonicalLines({
      cart,
      rates: currentRates,
      getProduct: (id) => getProductByIdStmt.get(id),
      getPresentation: (id) => getPresentationForSaleStmt.get(id),
      allowPriceOverride,
    });
    const paymentResult = salePricing.buildCanonicalPayments({
      payments,
      methods: activeMethods,
      rates: currentRates,
      customRates,
    });
    const finalClienteId = cliente_id ? Number.parseInt(cliente_id, 10) : null;
    if (finalClienteId && !getClienteByIdStmt.get(finalClienteId)) {
      return res.status(400).json({ error: 'Cliente inválido.' });
    }

    const remainingVes = salePricing.round2(Math.max(0, pricing.totalVes - paymentResult.totalPaidVes));
    const remainingUsd = salePricing.round4(remainingVes / pricing.bcv);
    const isPending = remainingVes > 0.50 && remainingUsd > 0.05;
    const estadoPago = isPending
      ? (paymentResult.totalPaidVes > 0.01 ? 'ABONADO' : 'FIADO')
      : 'PAGADO';
    const montoPendienteUsd = isPending ? remainingUsd : 0;
    if (isPending && finalClienteId === null) {
      return res.status(400).json({
        error: 'Se debe seleccionar un cliente para guardar una venta a crédito.',
      });
    }
    const cleanNote = nota === undefined || nota === null ? null : String(nota).trim().slice(0, 500);
    const replay = processSaleTransaction({
      pricing,
      paymentResult,
      clienteId: finalClienteId,
      estadoPago,
      montoPendienteUsd,
      nota: cleanNote,
      requestId,
    });
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
    if (finalClienteId) {
      clienteData = getClienteByIdStmt.get(finalClienteId);
    }

    res.status(201).json({
      message: 'Sale completed successfully!',
      ...replay,
      printTicket: normalizedPrintTicket,
      printMode,
      printerName,
      printCopies,
      ticketSize: paperWidth,
      printHeader,
      printFooter,
      printQr: settings.printQr !== false,
      printLogo: settings.printLogo !== false,
      printQrContent: settings.printQrContent || '',
      logoPath: settings.logoPath || '',
      businessRIF: settings.businessRIF || '',
      businessAddress: settings.businessAddress || '',
      businessPhone: settings.businessPhone || '',
      cliente: clienteData,
    });
  } catch (error) {
    console.error('Error processing sale transaction:', error);
    if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const existing = db.prepare('SELECT response_json FROM sale_requests WHERE request_id = ?').get(requestId);
      if (existing && existing.response_json) {
        return res.status(200).json({ ...JSON.parse(existing.response_json), replayed: true });
      }
    }
    const forbidden = /requiere autorización|precio autorizado/.test(error.message || '');
    res.status(forbidden ? 403 : 400).json({ error: error.message || 'Failed to process sale.' });
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
    const qrContent = settings.printQrContent || '';
    if (settings.printQr !== false && qrContent) {
      try {
        qrImage = await QRCode.toDataURL(qrContent);
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

module.exports = {
  processSale,
  getSaleReceipt,
  getSaleDetails,
  registerChange,
  recalcSalePendingAndStatus,
};
