// controllers/reports.controller.js
const { db } = require('../src/database');
const { loadSettings, getDataBasePath } = require('../src/utils/settings');
const { ensureUnlocked, operatorFromReq } = require('../src/utils/adminUnlock');
const { logAction } = require('../src/utils/audit');
const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Helper to check if file type is supported by PDFKit (only JPG/JPEG/PNG) to avoid WebP/SVG crashes
const isImageSupportedByPdfKit = (filePath) => {
  if (!filePath) return false;
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.png' || ext === '.jpg' || ext === '.jpeg';
};

// ================== QUERIES BASE ==================

// Ventas del día
const getSalesForDateStmt = db.prepare(`
  SELECT *, (SELECT reconciliado FROM cashea_ventas WHERE venta_id = id) as cashea_reconciliado
  FROM ventas
  WHERE date(creado_en) = date('now', 'localtime')
    AND estado_pago != 'ANULADO'
  ORDER BY creado_en ASC
`);

const getSalePaymentsForDateStmt = db.prepare(`
  SELECT vp.*
  FROM venta_pagos vp
  JOIN ventas v ON vp.venta_id = v.id
  WHERE date(v.creado_en) = date('now', 'localtime')
    AND v.estado_pago != 'ANULADO'
`);

// Ventas por rango
const getSalesByDateRangeStmt = db.prepare(`
  SELECT 
      v.id,
      v.total_ves,
      v.impuesto_total,
      v.creado_en,
      v.estado_pago,
      (SELECT reconciliado FROM cashea_ventas WHERE venta_id = v.id) as cashea_reconciliado,

      -- costo total de la mercancía en VES
      (
        SELECT 
          SUM(vp.costo_unitario_ves * vp.cantidad)
        FROM venta_productos vp
        WHERE vp.venta_id = v.id
      ) AS total_costo_ves,


--pagos hechos en el momento de la venta(POS)
  (
    SELECT 
          COALESCE(SUM(p.monto_en_ves), 0)
        FROM venta_pagos p
        WHERE p.venta_id = v.id
  ) AS total_pagos_ves,

      (
        SELECT 
          COALESCE(SUM(a.monto_pagado_ves), 0)
        FROM abonos a
        LEFT JOIN ventas v_abono ON a.venta_id = v_abono.id
        WHERE a.venta_id = v.id
          AND (v_abono.id IS NULL OR v_abono.estado_pago != 'ANULADO')
      ) AS total_abonos_ves

  FROM ventas v
  WHERE date(v.creado_en) BETWEEN date(?) AND date(?)
    AND v.estado_pago != 'ANULADO'
  ORDER BY v.creado_en ASC
  `);

const getSaleProductsForSaleIdStmt = db.prepare(`
  SELECT producto_id, cantidad 
  FROM venta_productos 
  WHERE venta_id = ?
  `);

const getSaleProductsForSaleIdWithNameStmt = db.prepare(`
  SELECT vp.cantidad, COALESCE(p.nombre, vp.nombre, (SELECT nombre FROM productos WHERE id = vp.producto_id LIMIT 1), 'Prod #' || IFNULL(vp.producto_id, 'N/A')) as producto_nombre 
  FROM venta_productos vp
  LEFT JOIN productos p ON CAST(vp.producto_id AS TEXT) = CAST(p.id AS TEXT)
  WHERE vp.venta_id = ?
`);

const getDetailedSaleProductsStmt = db.prepare(`
  SELECT vp.producto_id, vp.cantidad, vp.precio_unitario_ves, vp.costo_unitario_ves,
         COALESCE(p.nombre, vp.nombre) as producto_nombre,
         COALESCE(p.exento_iva, vp.exento_iva) as exento_iva,
         p.proveedor, p.categoria
  FROM venta_productos vp
  LEFT JOIN productos p ON CAST(vp.producto_id AS TEXT) = CAST(p.id AS TEXT)
  WHERE vp.venta_id = ?
`);

// Lista de reposición: productos vendidos en los últimos 5 días agrupados por nombre/cantidad
const getDailyRestockListStmt = db.prepare(`
  SELECT
    date(v.creado_en) AS fecha_venta,
    COALESCE(p.nombre, vp.nombre, (SELECT nombre FROM productos WHERE id = vp.producto_id LIMIT 1), 'Prod #' || IFNULL(vp.producto_id, 'N/A')) AS nombre,
    SUM(vp.cantidad) AS cantidad_total
  FROM venta_productos vp
  LEFT JOIN productos p ON CAST(vp.producto_id AS TEXT) = CAST(p.id AS TEXT)
  JOIN ventas v ON vp.venta_id = v.id
  WHERE date(v.creado_en) >= date('now', '-5 days', 'localtime')
    AND v.estado_pago != 'ANULADO'
  GROUP BY date(v.creado_en), vp.producto_id, COALESCE(p.nombre, vp.nombre, (SELECT nombre FROM productos WHERE id = vp.producto_id LIMIT 1), 'Prod #' || IFNULL(vp.producto_id, 'N/A'))
  ORDER BY fecha_venta DESC, cantidad_total DESC, nombre COLLATE NOCASE ASC
`);

const searchSalesStmt = db.prepare(`
  SELECT
v.id,
  v.total_ves,
  v.creado_en,
  v.estado_pago,
  (SELECT reconciliado FROM cashea_ventas WHERE venta_id = v.id) as cashea_reconciliado,
  c.nombre as cliente_nombre,
  (SELECT SUM(vp.costo_unitario_ves * vp.cantidad) FROM venta_productos vp WHERE vp.venta_id = v.id) AS total_costo_ves,
    (SELECT COALESCE(SUM(p.monto_en_ves), 0) FROM venta_pagos p WHERE p.venta_id = v.id) AS total_pagos_ves,
    (
      SELECT 
        COALESCE(SUM(a.monto_pagado_ves), 0) 
      FROM abonos a 
      LEFT JOIN ventas v_abono ON a.venta_id = v_abono.id
      WHERE a.venta_id = v.id 
        AND (v_abono.id IS NULL OR v_abono.estado_pago != 'ANULADO')
    ) AS total_abonos_ves
  FROM ventas v
  LEFT JOIN clientes c ON v.cliente_id = c.id
  WHERE v.id LIKE ?
  OR c.nombre LIKE ?
    OR CAST(v.total_ves AS TEXT) LIKE ?
      ORDER BY v.creado_en DESC
  LIMIT 50
  `);

const getPaymentsByDateRangeStmt = db.prepare(`
SELECT
  a.id,
  a.fecha,
  a.cliente_id,
  a.venta_id,
  a.monto_pagado_ves,
  a.monto_pagado_usd,
  a.tasa_bcv_momento,
  a.metodo,
  c.nombre AS cliente_nombre
FROM abonos a
LEFT JOIN clientes c ON a.cliente_id = c.id
LEFT JOIN ventas v ON a.venta_id = v.id
WHERE date(a.fecha) BETWEEN date(?) AND date(?)
  AND (v.id IS NULL OR v.estado_pago != 'ANULADO')
ORDER BY a.fecha ASC, a.id ASC
`);



const getSaleSimpleStmt = db.prepare(`
  SELECT id, estado_pago, monto_pendiente_usd
  FROM ventas
  WHERE id = ?
  `);

const voidSaleStmt = db.prepare(`
  UPDATE ventas
  SET estado_pago = 'ANULADO',
  monto_pendiente_usd = 0
  WHERE id = ?
  `);

const restoreStockStmt = db.prepare(`
  UPDATE productos
  SET stock = stock + ?
  WHERE id = ?
    `);

// 🔴 borrar pagos y abonos asociados a una venta anulada
const deleteSalePaymentsStmt = db.prepare(`
  DELETE FROM venta_pagos
  WHERE venta_id = ?
  `);

const deleteSaleAbonosStmt = db.prepare(`
  DELETE FROM abonos
  WHERE venta_id = ?
  `);

// ---------------- PAGOS DEL DÍA (POS + COBRANZA) ----------------
// ⚠️ IMPORTANTE: esta versión SOLO cuenta movimientos DESPUÉS del último Cierre Z de hoy.

const getPaymentsSummarySinceStmt = db.prepare(`
  SELECT
    metodo,
    SUM(total_ves) AS total_ves,
    SUM(total_usd) AS total_usd
  FROM (
    -- PAGOS DEL POS (venta_pagos)
    SELECT 
      vp.metodo AS metodo,
      SUM(vp.monto_en_ves) AS total_ves,
      SUM(
        CASE 
          WHEN mp.moneda = 'USD' THEN vp.monto_recibido 
          ELSE 0 
        END
      ) AS total_usd
    FROM venta_pagos vp
    JOIN ventas v ON vp.venta_id = v.id
    LEFT JOIN metodos_pago mp ON vp.metodo = mp.key
    WHERE datetime(v.creado_en) > datetime(?)
      AND v.estado_pago != 'ANULADO'
    GROUP BY vp.metodo

    UNION ALL

    -- ABONOS DE COBRANZA
    SELECT 
      a.metodo AS metodo,
      SUM(a.monto_pagado_ves) AS total_ves,
      SUM(
        CASE 
          WHEN mp.moneda = 'USD' THEN a.monto_pagado_usd 
          ELSE 0 
        END
      ) AS total_usd
    FROM abonos a
    LEFT JOIN ventas v ON a.venta_id = v.id
    LEFT JOIN metodos_pago mp ON a.metodo = mp.key
    WHERE datetime(a.fecha) > datetime(?)
      AND (v.id IS NULL OR v.estado_pago != 'ANULADO')
    GROUP BY a.metodo
  ) AS combined
  GROUP BY metodo
`);

// ---------------- APERTURAS DE CAJA DEL DÍA ----------------

// Totales de aperturas del día DESPUÉS de cierto momento (para Cierre Z incremental)
const getOpeningsTotalsSinceStmt = db.prepare(`
SELECT
COALESCE(SUM(opening_ves), 0) AS total_opening_ves,
  COALESCE(SUM(opening_usd), 0) AS total_opening_usd
  FROM aperturas_caja
  WHERE datetime(fecha) > datetime(?)
  `);

// Detalle de aperturas del día (para el PDF Z y JSON)
const getOpeningsDetailSinceStmt = db.prepare(`
SELECT
id,
  fecha,
  opening_ves,
  opening_usd,
  tasa_bcv_momento,
  notas
  FROM aperturas_caja
  WHERE datetime(fecha) > datetime(?)
  ORDER BY fecha ASC, id ASC
  `);

// Insertar una nueva apertura de caja
const insertOpeningStmt = db.prepare(`
  INSERT INTO aperturas_caja(opening_ves, opening_usd, tasa_bcv_momento, notas)
VALUES(@opening_ves, @opening_usd, @tasa_bcv_momento, @notas)
  `);

// ---------------- RETIROS DE CAJA DEL DÍA ----------------

const getWithdrawalsSummarySinceStmt = db.prepare(`
SELECT
metodo,
  SUM(monto_ves) AS total_ves,
    SUM(monto_usd) AS total_usd
  FROM retiros_caja
  WHERE datetime(fecha) > datetime(?)
  GROUP BY metodo
  `);

// detalle de retiros del día (para el PDF Z, SIEMPRE TODO EL DÍA)
const getWithdrawalsDetailSinceStmt = db.prepare(`
SELECT
id,
  fecha,
  metodo,
  monto_ves,
  monto_usd,
  descripcion
  FROM retiros_caja
  WHERE datetime(fecha) > datetime(?)
  ORDER BY fecha ASC, id ASC
  `);

const insertWithdrawalStmt = db.prepare(`
  INSERT INTO retiros_caja(metodo, monto_ves, monto_usd, descripcion)
VALUES(@metodo, @monto_ves, @monto_usd, @descripcion)
  `);

// ---------------- CIERRES DE CAJA (HISTORIAL CIERRE Z) ----------------

// Tabla original usada para saber el último cierre del día (no la tocamos)
const insertClosureStmt = db.prepare(`
  INSERT INTO cierres_caja DEFAULT VALUES
  `);

const getLastClosureStmt = db.prepare(`
  SELECT MAX(fecha) AS last_cierre
  FROM cierres_caja
  `);

// 🔹 NUEVA TABLA: historial detallado de Cierres Z (para ver en Configuración / reimprimir)
db.exec(`
  CREATE TABLE IF NOT EXISTS cierres_z(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT DEFAULT(datetime('now', 'localtime')),
    total_sistema_ves REAL DEFAULT 0,
    total_sistema_usd REAL DEFAULT 0,
    total_manual_ves REAL DEFAULT 0,
    total_manual_usd REAL DEFAULT 0,
    diferencia_ves REAL DEFAULT 0,
    diferencia_usd REAL DEFAULT 0,
    notes TEXT,
    raw_json TEXT
  )
  `);

const insertCierreZHistoryStmt = db.prepare(`
  INSERT INTO cierres_z(
    total_sistema_ves,
    total_sistema_usd,
    total_manual_ves,
    total_manual_usd,
    diferencia_ves,
    diferencia_usd,
    notes,
    raw_json
  ) VALUES(
    @total_sistema_ves,
    @total_sistema_usd,
    @total_manual_ves,
    @total_manual_usd,
    @diferencia_ves,
    @diferencia_usd,
    @notes,
    @raw_json
  )
    `);

const getCierreZHistoryCountStmt = db.prepare(`
  SELECT COUNT(*) AS total
  FROM cierres_z
  `);

const getCierreZHistoryStmt = db.prepare(`
SELECT
id,
  fecha,
  total_sistema_ves,
  total_sistema_usd,
  total_manual_ves,
  total_manual_usd,
  diferencia_ves,
  diferencia_usd,
  notes,
  raw_json
  FROM cierres_z
  ORDER BY datetime(fecha) DESC
LIMIT ? OFFSET ?
  `);

const getCierreZByIdStmt = db.prepare(`
  SELECT *
  FROM cierres_z
  WHERE id = ?
  `);

const getCasheaLiquidationsByDateRangeStmt = db.prepare(`
  SELECT SUM(cv.monto_total_usd - cv.monto_inicial_usd) * (SELECT CAST(value AS REAL) FROM settings WHERE key = 'BCV') as total_ves
  FROM cashea_ventas cv
  WHERE cv.reconciliado = 1
    AND date(cv.fecha_reconciliacion) BETWEEN date(?) AND date(?)
`);

// ---------------- DASHBOARD STATS ----------------

const getTodayDashboardStatsStmt_Ventas = db.prepare(`
  SELECT
COUNT(id) as sale_count,
  SUM(total_ves) as total_ingresos_ves,
  SUM(CASE
          WHEN estado_pago = 'FIADO' THEN 0
          ELSE(total_ves - (monto_pendiente_usd * (SELECT value FROM settings WHERE key = 'BCV')))
      END) as total_cobrado_ventas_hoy,
  SUM((SELECT SUM(costo_unitario_ves * cantidad) FROM venta_productos vp WHERE vp.venta_id = v.id)) as total_costo_ves
  FROM ventas v
  WHERE date(creado_en) = date('now', 'localtime')
    AND estado_pago != 'ANULADO'
  `);

const getTodayDashboardStatsStmt_Abonos = db.prepare(`
  SELECT
    SUM(a.monto_pagado_ves) as total_abonos_hoy
  FROM abonos a
  LEFT JOIN ventas v ON a.venta_id = v.id
  WHERE date(a.fecha) = date('now', 'localtime')
    AND (v.id IS NULL OR v.estado_pago != 'ANULADO')
`);



// ---------------- NUEVOS QUERIES PARA PDF INVENTARIO / FIADOS ----------------

// inventario: usamos los datos base y calculamos el precio con las tasas
const getInventoryForPdfStmt = db.prepare(`
SELECT
id,
  nombre,
  costo,
  moneda_costo,
  porcentaje_ganancia,
  stock
  FROM productos
  WHERE activo = 1
  ORDER BY nombre COLLATE NOCASE ASC
  `);

// ventas fiadas / abonadas con saldo pendiente + nombre del cliente
const getFiadosForPdfStmt = db.prepare(`
  SELECT
    c.nombre AS cliente_nombre,
    c.cedula AS cliente_cedula,
    SUM(v.monto_pendiente_usd) AS total_pendiente_usd
  FROM ventas v
  JOIN clientes c ON v.cliente_id = c.id
  WHERE v.estado_pago IN ('FIADO', 'ABONADO')
    AND v.monto_pendiente_usd > 0
  GROUP BY c.id
  ORDER BY c.nombre COLLATE NOCASE ASC
`);

// ================== HELPERS ==================

const uploadsBasePath = path.join(getDataBasePath(), 'uploads');

function formatCurrency(value) {
  return Number(value || 0).toFixed(2);
}

function getBcvRate() {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'BCV'")
    .get();
  return row ? Number(row.value) || 0 : 0;
}

// ---------------- HELPERS: NORMALIZACIÓN CIERRE Z ----------------

function numberOr(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function mapMetodoLabel(metodo) {
  switch (metodo) {
    case 'VES_EFECTIVO':
      return 'Efectivo Bs';
    case 'USD_EFECTIVO':
      return 'Efectivo $';
    case 'COP_EFECTIVO':
      return 'Pesos Colombianos (Efectivo)';
    case 'COP_TRANSFERENCIA':
      return 'Pesos Colombianos (Transferencia)';
    case 'PUNTO_VENTA':
      return 'Punto de Venta';
    case 'BIOPAGO':
      return 'Biopago';
    case 'TARJETA':
      return 'Tarjeta';
    case 'PAGOMOVIL':
      return 'Pago Móvil';
    case 'TRANSFERENCIA':
      return 'Transferencia';
    case 'CASHEA':
      return 'Cashea';

    default:
      return metodo || 'Otro';
  }
}

function normalizeCurrencyFromMetodo(metodo) {
  const s = String(metodo || '').toUpperCase();
  return s.includes('USD') ? 'USD' : 'VES';
}

// Acepta summaryData en cualquiera de estos formatos:
// 1) { metodo, sistema, manual, diferencia, currency }
// 2) { metodo, total_ves, total_usd, ... }  (manual puede no existir)
function normalizeCierreZSummaryData(summaryData) {
  if (!Array.isArray(summaryData)) return [];

  return summaryData.map((item) => {
    const metodo = item?.metodo ?? item?.method ?? item?.nombre ?? 'Método';

    const currency =
      String(item?.currency || item?.moneda || normalizeCurrencyFromMetodo(metodo)).toUpperCase() === 'USD'
        ? 'USD'
        : 'VES';

    // sistema/manual/diferencia (si existen)
    let sistema = numberOr(item?.sistema, item?.totalSistema, item?.total_sistema, item?.system);
    let manual = numberOr(item?.manual, item?.totalManual, item?.total_manual, item?.manual_count);
    let diff = numberOr(item?.diferencia, item?.diff);

    // fallback: total_ves/total_usd
    if (sistema === null) {
      sistema =
        currency === 'USD'
          ? numberOr(item?.total_usd, item?.totalUsd, item?.usd)
          : numberOr(item?.total_ves, item?.totalVes, item?.ves, item?.total);
      if (sistema === null) sistema = 0;
    }

    // si no hay manual guardado, dejamos 0
    if (manual === null) {
      manual =
        currency === 'USD'
          ? numberOr(item?.manual_usd, item?.manualUsd)
          : numberOr(item?.manual_ves, item?.manualVes);
      if (manual === null) manual = 0;
    }

    if (diff === null) diff = manual - sistema;

    return {
      metodo,
      label: item?.label || mapMetodoLabel(metodo),
      currency,
      sistema,
      manual,
      diferencia: diff
    };
  });
}

// ---- helpers de precios (copiados del products.controller) ----

const getRatesForPricingStmt = db.prepare(
  "SELECT key, value FROM settings WHERE key IN ('BCV', 'PARALELO', 'COP', 'CALC_METHOD')"
);

function getRatesForPricing() {
  const ratesList = getRatesForPricingStmt.all();
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
}

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
      console.error(`Unknown cost currency: ${product.moneda_costo} for product ID ${product.id} `);
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

// === Helper: calcula ingresos / costo / ganancia REALIZADA y fiado por venta ===
function computeRealizedSummaryForSales(sales) {
  let totalIngresos = 0;
  let totalCosto = 0;
  let totalGanancia = 0;
  let totalFiado = 0;

  const detailedSales = sales.map((sale) => {
    const totalVes = Number(sale.total_ves) || 0;
    const costoVes = Number(sale.total_costo_ves) || 0;
    const pagosVes = Number(sale.total_pagos_ves) || 0; // venta_pagos
    const abonosVes = Number(sale.total_abonos_ves) || 0; // abonos

    // Lo realmente cobrado por esta venta
    let pagadoVes = pagosVes + abonosVes;

    if (pagadoVes > totalVes) pagadoVes = totalVes;
    if (pagadoVes < 0) pagadoVes = 0;

    // Lo que aún falta por cobrar
    let pendienteVes = totalVes - pagadoVes;
    if (pendienteVes < 0) pendienteVes = 0;
    if (pendienteVes > totalVes) pendienteVes = totalVes;

    // Seguridad: si estuviera ANULADO (aunque el query los excluye)
    if (sale.estado_pago === 'ANULADO') {
      pagadoVes = 0;
      pendienteVes = 0;
    }

    // Costo y ganancia realizada: primero se cubre costo, luego hay ganancia
    let costoRealizado;
    let gananciaRealizada;

    if (pagadoVes <= costoVes) {
      costoRealizado = pagadoVes;
      gananciaRealizada = 0;
    } else {
      costoRealizado = costoVes;
      gananciaRealizada = pagadoVes - costoVes;
    }

    totalIngresos += pagadoVes;
    totalCosto += costoRealizado;
    totalGanancia += gananciaRealizada;
    totalFiado += pendienteVes;

    return {
      ...sale,
      total_ves: totalVes,
      total_costo_ves: costoVes,
      total_pagado_ves: pagadoVes,
      total_pendiente_ves: pendienteVes,
      realized_ingreso_ves: pagadoVes,
      realized_costo_ves: costoRealizado,
      realized_ganancia_ves: gananciaRealizada
    };
  });

  return {
    summary: {
      totalIngresos,
      totalCosto,
      totalGanancia,
      totalFiado,
      totalVentas: sales.length
    },
    detailedSales
  };
}

// ================== LÓGICA DE NEGOCIO ==================

// ---------- Anular venta ----------

const voidSaleTransaction = db.transaction((saleId) => {
  const id = parseInt(saleId, 10);
  console.log(`[VOID] Iniciando anulación de venta #${id}`);
  if (!id) {
    throw new Error('ID de venta inválido.');
  }

  const sale = getSaleSimpleStmt.get(id);
  if (!sale) {
    throw new Error('Venta no encontrada.');
  }

  // Si ya está anulada, no hacemos nada más
  if (sale.estado_pago === 'ANULADO') {
    console.log(`[VOID] Venta #${id} ya estaba anulada.`);
    return { alreadyCancelled: true };
  }

  // 1) Devolver productos al stock
  const products = getSaleProductsForSaleIdStmt.all(id);
  console.log(`[VOID] Restaurendo stock para ${products.length} items de venta #${id}`);
  for (const prod of products) {
    restoreStockStmt.run(prod.cantidad, prod.producto_id);
  }

  // 2) Borrar TODOS los pagos de esa venta (POS, vuelto, etc.)
  const pResult = deleteSalePaymentsStmt.run(id);
  console.log(`[VOID] Pagos POS eliminados: ${pResult.changes}`);

  // 3) Borrar TODOS los abonos de esa venta (cobranza)
  const aResult = deleteSaleAbonosStmt.run(id);
  console.log(`[VOID] Abonos eliminados: ${aResult.changes}`);

  // 4) Marcar venta como ANULADA y sin pendiente
  voidSaleStmt.run(id);
  console.log(`[VOID] Venta #${id} marcada como ANULADA.`);

  return { alreadyCancelled: false };
});

const voidSale = (req, res) => {
  if (!ensureUnlocked(req, res)) return; // requiere clave admin (si está configurada)
  const { saleId } = req.params;
  try {
    const result = voidSaleTransaction(saleId);

    if (result.alreadyCancelled) {
      return res.json({
        success: true,
        message: `La venta #${saleId} ya estaba anulada.`
      });
    }

    logAction({
      usuario: operatorFromReq(req), rol: 'admin', accion: 'SALE_VOID',
      entidad: 'venta', entidadId: saleId, ip: req.ip,
    });
    res.json({
      success: true,
      message: `Venta #${saleId} anulada con éxito.Se devolvió el stock y se eliminaron pagos / abonos asociados.`
    });
  } catch (error) {
    console.error('Error al anular la venta:', error);
    res.status(400).json({ error: error.message || 'No se pudo anular la venta.' });
  }
};

// ---------- Resumen diario de ventas (PDF simple) ----------

const getDailyCloseReport = async (req, res) => {
  try {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year} -${month} -${day} `;

    const settings = loadSettings();
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    const sales = getSalesForDateStmt.all().map((sale) => ({
      ...sale,
      total_ves: Number(sale.total_ves || 0),
      total_usd_bcv: Number(sale.total_usd_bcv || 0)
    }));

    const payments = getSalePaymentsForDateStmt.all().map((pay) => ({
      ...pay,
      monto_en_ves: Number(pay.monto_en_ves || 0)
    }));

    const doc = new PDFDocument({ margin: 50 });
    const filename = `resumen - ventas - ${todayStr}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    doc.pipe(res);

    let currentY = doc.y;
    let logoPlacedHeight = 0;

    if (logoFullPath && fs.existsSync(logoFullPath) && isImageSupportedByPdfKit(logoFullPath)) {
      try {
        const img = doc.openImage(logoFullPath);
        const logoMaxHeight = 40;
        const logoMaxWidth = 100;
        const imgRatio = img.width / img.height;

        let finalLogoWidth = logoMaxWidth;
        let finalLogoHeight = finalLogoWidth / imgRatio;

        if (finalLogoHeight > logoMaxHeight) {
          finalLogoHeight = logoMaxHeight;
          finalLogoWidth = finalLogoHeight * imgRatio;
        }

        finalLogoWidth = Math.min(finalLogoWidth, logoMaxWidth);

        doc.image(logoFullPath, 50, currentY, {
          width: finalLogoWidth,
          height: finalLogoHeight,
          align: 'left'
        });

        logoPlacedHeight = finalLogoHeight + 5;
        doc.y = currentY + logoPlacedHeight;
      } catch (imgError) {
        console.error('Error cargando imagen del logo:', imgError);
        logoPlacedHeight = 10;
        doc.y = currentY + logoPlacedHeight;
      }
    } else {
      logoPlacedHeight = 10;
      doc.y = currentY + logoPlacedHeight;
    }

    const textStartX = 50;
    const textStartY = 50 + logoPlacedHeight;

    doc.fontSize(20).font('Helvetica-Bold').text(settings.businessName || 'Mi Negocio', textStartX, textStartY, {
      align: 'center'
    });
    doc.moveDown(1);

    doc.fontSize(16).font('Helvetica-Bold').text('Resumen de Ventas Diario', {
      align: 'center'
    });

    doc.fontSize(12).font('Helvetica').text(
      `Fecha: ${today.toLocaleDateString('es-VE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
      } `,
      { align: 'center' }
    );
    doc.moveDown(2);

    doc.fontSize(14).font('Helvetica-Bold').text('Resumen General');
    doc.moveDown(0.5);

    const totalVentasVes = sales.reduce((sum, sale) => sum + sale.total_ves, 0);
    const totalVentasUsd = sales.reduce((sum, sale) => sum + sale.total_usd_bcv, 0);
    const totalImpuestoVes = sales.reduce((sum, sale) => sum + (sale.impuesto_total || 0), 0);
    const totalPagosVesEquivalente = payments.reduce((sum, pay) => sum + pay.monto_en_ves, 0);

    doc.fontSize(11).font('Helvetica');
    doc.text(`Total Ventas(${sales.length}): ${formatCurrency(totalVentasVes)} Bs / ${formatCurrency(totalVentasUsd)} $`);
    doc.text(`Total IVA Cobrado: ${formatCurrency(totalImpuestoVes)} Bs`);
    doc.text(`Total Pagos Recibidos(Equiv.Bs): ${formatCurrency(totalPagosVesEquivalente)} Bs`);
    doc.moveDown(2);

    if (sales.length > 0) {
      doc.fontSize(14).font('Helvetica-Bold').text('Detalle de Ventas');
      doc.moveDown(0.5);

      const colWidthId = 50;
      const colWidthTime = 100;
      const colWidthVes = 150;
      const colWidthUsd = 150;
      const itemXId = doc.page.margins.left;
      const itemXTime = itemXId + colWidthId + 5;
      const itemXVes = itemXTime + colWidthTime + 5;
      const itemXUsd = itemXVes + colWidthVes + 5;

      const headerY = doc.y;

      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('ID', itemXId, headerY);
      doc.text('Hora', itemXTime, headerY);
      doc.text('Total Bs', itemXVes, headerY, { width: colWidthVes, align: 'right' });
      doc.text('Total $', itemXUsd, headerY, { width: colWidthUsd, align: 'right' });

      const headerLineY = headerY + 12;
      doc.moveTo(itemXId, headerLineY)
        .lineTo(doc.page.width - doc.page.margins.right, headerLineY)
        .strokeColor('#cccccc')
        .stroke();

      let rowY = headerLineY + 5;
      doc.fontSize(8).font('Helvetica');

      sales.forEach((sale) => {
        const saleTime = new Date(sale.creado_en).toLocaleTimeString('es-VE', {
          hour: '2-digit',
          minute: '2-digit'
        });

        doc.text(sale.id, itemXId, rowY, { width: colWidthId });
        doc.text(saleTime, itemXTime, rowY, { width: colWidthTime });
        doc.text(formatCurrency(sale.total_ves), itemXVes, rowY, { width: colWidthVes, align: 'right' });
        doc.text(formatCurrency(sale.total_usd_bcv), itemXUsd, rowY, { width: colWidthUsd, align: 'right' });

        const textHeight = doc.heightOfString(saleTime, { width: colWidthTime });
        rowY += textHeight + 5;
      });
    } else {
      doc.fontSize(11).font('Helvetica').text('No se registraron ventas en esta fecha.');
    }

    doc.end();
  } catch (error) {
    console.error('Error generando reporte PDF:', error);
    res.status(500).json({ error: 'Error interno al generar el reporte PDF.' });
  }
};

// ---------- Reporte por rango (JSON) ----------

// ---------- Helper para obtener datos del reporte filtrados ----------

const getPaymentMethodsMap = () => {
  try {
    return db.prepare(`SELECT key, nombre FROM metodos_pago`).all().reduce((map, m) => {
      map[m.key] = m.nombre;
      return map;
    }, {});
  } catch (err) {
    console.error('Error fetching payment methods map:', err);
    return {};
  }
};

const generateReportDataHelper = (startDate, endDate, filters = {}) => {
  const filterProductId = filters.productoId ? parseInt(filters.productoId, 10) : null;
  const filterProveedor = filters.proveedor ? filters.proveedor.trim().toLowerCase() : null;
  const filterCategoria = filters.categoria ? filters.categoria.trim().toLowerCase() : null;
  const hasFilters = !!(filterProductId || filterProveedor || filterCategoria);

  const rawSales = getSalesByDateRangeStmt.all(startDate, endDate);
  const rawPayments = getPaymentsByDateRangeStmt.all(startDate, endDate);

  let totalIngresos = 0;
  let totalCosto = 0;
  let totalGanancia = 0;
  let totalFiado = 0;
  let totalIva = 0;

  const detailedSales = [];
  const saleProportions = {};

  for (const sale of rawSales) {
    const products = getDetailedSaleProductsStmt.all(sale.id);
    
    let sumAllProductsVes = 0;
    let sumMatchedProductsVes = 0;
    let sumMatchedCostoVes = 0;
    const matchedProducts = [];

    for (const p of products) {
      const pQty = Number(p.cantidad) || 0;
      const pPrice = Number(p.precio_unitario_ves) || 0;
      const pCost = Number(p.costo_unitario_ves) || 0;
      
      const itemTotal = pPrice * pQty;
      const itemCost = pCost * pQty;
      
      sumAllProductsVes += itemTotal;

      let matches = true;
      if (filterProductId && p.producto_id !== filterProductId) {
        matches = false;
      }
      if (filterProveedor && (!p.proveedor || p.proveedor.trim().toLowerCase() !== filterProveedor)) {
        matches = false;
      }
      if (filterCategoria && (!p.categoria || p.categoria.trim().toLowerCase() !== filterCategoria)) {
        matches = false;
      }

      if (matches) {
        sumMatchedProductsVes += itemTotal;
        sumMatchedCostoVes += itemCost;
        matchedProducts.push(p);
      }
    }

    let P = 1.0;
    if (hasFilters) {
      P = sumAllProductsVes > 0 ? (sumMatchedProductsVes / sumAllProductsVes) : 0;
    }

    saleProportions[sale.id] = P;

    if (P > 0) {
      const totalVes = (Number(sale.total_ves) || 0) * P;
      const costoVes = hasFilters ? sumMatchedCostoVes : (Number(sale.total_costo_ves) || 0);
      const pagosVes = (Number(sale.total_pagos_ves) || 0) * P;
      const abonosVes = (Number(sale.total_abonos_ves) || 0) * P;
      const impuestoVes = (Number(sale.impuesto_total) || 0) * P;

      let pagadoVes = pagosVes + abonosVes;
      if (pagadoVes > totalVes) pagadoVes = totalVes;
      if (pagadoVes < 0) pagadoVes = 0;

      let pendienteVes = totalVes - pagadoVes;
      if (pendienteVes < 0) pendienteVes = 0;

      let costoRealizado;
      let gananciaRealizada;

      if (pagadoVes <= costoVes) {
        costoRealizado = pagadoVes;
        gananciaRealizada = 0;
      } else {
        costoRealizado = costoVes;
        gananciaRealizada = pagadoVes - costoVes;
      }

      totalIngresos += pagadoVes;
      totalCosto += costoRealizado;
      totalGanancia += gananciaRealizada;
      totalFiado += pendienteVes;
      totalIva += impuestoVes;

      detailedSales.push({
        ...sale,
        total_ves: totalVes,
        total_costo_ves: costoVes,
        total_pagos_ves: pagadoVes,
        total_pendiente_ves: pendienteVes,
        realized_ingreso_ves: pagadoVes,
        realized_costo_ves: costoRealizado,
        realized_ganancia_ves: gananciaRealizada,
        impuesto_total: impuestoVes,
        products: matchedProducts
      });
    }
  }

  const payments = [];
  for (const p of rawPayments) {
    const saleId = p.venta_id;
    let P = 1.0;
    if (hasFilters) {
      P = saleId && (saleId in saleProportions) ? saleProportions[saleId] : 0;
    }
    if (P > 0) {
      payments.push({
        ...p,
        monto_pagado_ves: (Number(p.monto_pagado_ves) || 0) * P,
        monto_pagado_usd: (Number(p.monto_pagado_usd) || 0) * P
      });
    }
  }

  return {
    summary: {
      totalIngresos,
      totalCosto,
      totalGanancia,
      totalFiado,
      totalIva,
      totalVentas: detailedSales.length
    },
    detailedSales,
    payments
  };
};

// ---------- Reporte por rango (JSON) ----------

const getReportByDateRange = (req, res) => {
  const { startDate, endDate, productoId, proveedor, categoria } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Se requieren fechas de inicio y fin.' });
  }

  try {
    const { summary, detailedSales, payments } = generateReportDataHelper(startDate, endDate, {
      productoId,
      proveedor,
      categoria
    });

    res.json({
      summary,
      detailedSales,
      payments
    });
  } catch (error) {
    console.error('Error generando reporte por rango:', error);
    res.status(500).json({ error: 'Error interno del servidor al generar el reporte.' });
  }
};

// ---------- Reporte de abonos por rango ----------

const getPaymentsByDateRange = (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Se requieren fechas de inicio y fin.' });
  }

  try {
    const payments = getPaymentsByDateRangeStmt.all(startDate, endDate);
    res.json({ payments });
  } catch (error) {
    console.error('Error generando reporte de abonos por rango:', error);
    res.status(500).json({
      error: 'Error interno del servidor al generar el reporte de abonos.'
    });
  }
};

// ---------- Reporte por rango (PDF) ----------

const getReportByDateRangePDF = async (req, res) => {
  const { startDate, endDate, productoId, proveedor, categoria } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).send('Se requieren fechas de inicio y fin.');
  }

  try {
    const { summary, detailedSales, payments } = generateReportDataHelper(startDate, endDate, {
      productoId,
      proveedor,
      categoria
    });

    const settings = loadSettings();
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    const bcvRate = getBcvRate() || 1;

    const totalIngresos = summary.totalIngresos || 0;
    const totalCosto = summary.totalCosto || 0;
    const totalGanancia = summary.totalGanancia || 0;
    const totalFiado = summary.totalFiado || 0;
    const totalIva = summary.totalIva || 0;

    const totalIngresosUsd = bcvRate > 0 ? totalIngresos / bcvRate : 0;
    const totalCostoUsd = bcvRate > 0 ? totalCosto / bcvRate : 0;
    const totalGananciaUsd = bcvRate > 0 ? totalGanancia / bcvRate : 0;
    const totalFiadoUsd = bcvRate > 0 ? totalFiado / bcvRate : 0;
    const totalIvaUsd = bcvRate > 0 ? totalIva / bcvRate : 0;

    const totalAbonosVes = payments.reduce((sum, p) => sum + (Number(p.monto_pagado_ves) || 0), 0);
    const liquidationsRow = getCasheaLiquidationsByDateRangeStmt.get(startDate, endDate) || { total_ves: 0 };
    const totalLiquidationsVes = Number(liquidationsRow.total_ves || 0);

    const doc = new PDFDocument({ margin: 50 });
    const filename = `reporte-ventas-${startDate}-a-${endDate}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    doc.pipe(res);

    let y = doc.y;

    if (logoFullPath && fs.existsSync(logoFullPath) && isImageSupportedByPdfKit(logoFullPath)) {
      try {
        doc.image(logoFullPath, 50, y, { width: 100, align: 'left' });
        y += 50;
      } catch (imgError) {
        console.error('Error cargando imagen del logo para PDF:', imgError);
      }
    }

    doc.fontSize(20).font('Helvetica-Bold').text(settings.businessName || 'BodegApp', {
      align: 'center'
    });
    doc.moveDown(1);

    doc.fontSize(16)
      .font('Helvetica-Bold')
      .text('Reporte de Ventas y Ganancias (ingreso realizado)', { align: 'center' });

    doc.fontSize(12).font('Helvetica').text(`Del ${startDate} al ${endDate}`, { align: 'center' });
    
    // Mostrar filtros en el PDF si existen
    const hasFilters = !!(productoId || proveedor || categoria);
    if (hasFilters) {
      let filterText = 'Filtros aplicados: ';
      const filterParts = [];
      if (productoId) filterParts.push(`ID Producto: ${productoId}`);
      if (proveedor) filterParts.push(`Proveedor: ${proveedor}`);
      if (categoria) filterParts.push(`Categoría: ${categoria}`);
      filterText += filterParts.join(', ');
      
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#d97706').text(filterText, { align: 'center' });
      doc.fillColor('black');
    }
    
    doc.moveDown(2);

    doc.fontSize(14).font('Helvetica-Bold').text('Resumen del Período');
    doc.moveDown(0.5);

    doc.fontSize(11).font('Helvetica');
    doc.text(`Ingresos cobrados (ventas): ${formatCurrency(totalIngresos)} Bs (${formatCurrency(totalIngresosUsd)} $)`);
    doc.text(`Costo asociado a lo cobrado: ${formatCurrency(totalCosto)} Bs (${formatCurrency(totalCostoUsd)} $)`);
    doc.text(`IVA Recaudado: ${formatCurrency(totalIva)} Bs (${formatCurrency(totalIvaUsd)} $)`);
    doc.text(`Saldo pendiente (fiado): ${formatCurrency(totalFiado)} Bs (${formatCurrency(totalFiadoUsd)} $)`);
    doc.text(`Total de abonos registrados en el período: ${formatCurrency(totalAbonosVes)} Bs`);
    doc.text(`Total de liquidaciones Cashea en el período: ${formatCurrency(totalLiquidationsVes)} Bs`);

    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Oblique').fillColor('gray');
    doc.text('Nota: Los ingresos cobrados incluyen pagos en el momento de la venta y abonos posteriores asociados a ventas fiadas/abonadas.');
    doc.fillColor('black');
    doc.moveDown(1.5);

    doc.fontSize(12).font('Helvetica-Bold').fillColor('green');
    doc.text(`Ganancia realizada: ${formatCurrency(totalGanancia)} Bs (${formatCurrency(totalGananciaUsd)} $)`);
    doc.fillColor('black');
    doc.moveDown(2);

    doc.fontSize(14).font('Helvetica-Bold').text('Detalle de Ventas');
    doc.moveDown(0.5);

    const colX1 = 50;
    const colX2 = 100;
    const colX3 = 250;
    const colX4 = 350;
    const colX5 = 425;
    const colX6 = 500;

    let headerY = doc.y;

    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('ID', colX1, headerY);
    doc.text('Fecha', colX2, headerY);
    doc.text('Productos', colX3, headerY);
    doc.text('Cobrado', colX4, headerY, { width: 70, align: 'right' });
    doc.text('Costo', colX5, headerY, { width: 70, align: 'right' });
    doc.text('Ganancia', colX6, headerY, { width: 70, align: 'right' });

    let headerLineY = headerY + 12;

    doc.moveTo(colX1, headerLineY)
      .lineTo(doc.page.width - doc.page.margins.right, headerLineY)
      .strokeColor('#cccccc')
      .stroke();

    doc.fontSize(8).font('Helvetica');
    let rowY = headerLineY + 5;

    if (detailedSales.length === 0) {
      doc.moveDown(1);
      doc.fontSize(11).font('Helvetica').text('No se registraron ventas en este rango de fechas.');
    } else {
      detailedSales.forEach((sale) => {
        const saleDate = new Date(sale.creado_en);
        const formattedDate = saleDate.toLocaleDateString('es-VE');
        const formattedTime = saleDate.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

        const productsList = (sale.products || [])
          .map((p) => `${p.cantidad} x ${p.producto_nombre}`)
          .join(', ');

        const textHeight = doc.heightOfString(productsList, { width: 100, align: 'left' });

        if (rowY + textHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          headerY = doc.page.margins.top;

          doc.fontSize(9).font('Helvetica-Bold');
          doc.text('ID', colX1, headerY);
          doc.text('Fecha', colX2, headerY);
          doc.text('Productos', colX3, headerY);
          doc.text('Cobrado', colX4, headerY, { width: 70, align: 'right' });
          doc.text('Costo', colX5, headerY, { width: 70, align: 'right' });
          doc.text('Ganancia', colX6, headerY, { width: 70, align: 'right' });

          headerLineY = headerY + 12;
          doc.moveTo(colX1, headerLineY)
            .lineTo(doc.page.width - doc.page.margins.right, headerLineY)
            .strokeColor('#cccccc')
            .stroke();

          rowY = headerLineY + 5;
          doc.fontSize(8).font('Helvetica');
        }

        const cobradoVenta = Number(sale.realized_ingreso_ves || 0);
        const costoVenta = Number(sale.realized_costo_ves || 0);
        const gananciaVenta = Number(sale.realized_ganancia_ves || 0);

        doc.text(`Venta #${sale.id}`, colX1, rowY);
        doc.text(`${formattedDate} ${formattedTime}`, colX2, rowY);
        doc.text(productsList, colX3, rowY, { width: 100, align: 'left' });
        doc.text(formatCurrency(cobradoVenta), colX4, rowY, { width: 70, align: 'right' });
        doc.text(formatCurrency(costoVenta), colX5, rowY, { width: 70, align: 'right' });
        doc.text(formatCurrency(gananciaVenta), colX6, rowY, { width: 70, align: 'right' });

        rowY += textHeight + 5;
      });
    }

    if (payments.length > 0) {
      doc.addPage();

      doc.fontSize(14).font('Helvetica-Bold').text('Detalle de Abonos');
      doc.moveDown(0.5);

      const abCol1 = 50;
      const abCol2 = 140;
      const abCol3 = 200;
      const abCol4 = 350;
      const abCol5 = 440;
      const abCol6 = 520;

      let abHeaderY = doc.y;

      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Fecha', abCol1, abHeaderY);
      doc.text('ID', abCol2, abHeaderY);
      doc.text('Cliente', abCol3, abHeaderY);
      doc.text('Venta', abCol4, abHeaderY);
      doc.text('Método', abCol5, abHeaderY);
      doc.text('Monto Bs', abCol6, abHeaderY, { width: 60, align: 'right' });

      let abLineY = abHeaderY + 12;
      doc.moveTo(abCol1, abLineY)
        .lineTo(doc.page.width - doc.page.margins.right, abLineY)
        .strokeColor('#cccccc')
        .stroke();

      let abRowY = abLineY + 5;
      doc.fontSize(8).font('Helvetica');

      const methodMap = getPaymentMethodsMap();
      const getMetodoLabel = (metodo) => {
        if (methodMap[metodo]) return methodMap[metodo];
        switch (metodo) {
          case 'VES_EFECTIVO':
            return 'Efectivo Bs';
          case 'USD_EFECTIVO':
            return 'Efectivo $';
          case 'COP_EFECTIVO':
            return 'Pesos Colombianos (Efectivo)';
          case 'COP_TRANSFERENCIA':
            return 'Pesos Colombianos (Transferencia)';
          case 'PUNTO_VENTA':
            return 'Punto de Venta';
          case 'BIOPAGO':
            return 'Biopago';
          case 'TARJETA':
            return 'Tarjeta';
          case 'PAGOMOVIL':
            return 'Pago Móvil';
          case 'TRANSFERENCIA':
            return 'Transferencia';
          case 'CASHEA':
            return 'Cashea';
          case 'CASHEA_LIQUIDACION':
            return 'Liquidación Cashea';
          default:
            return metodo || 'Otro';
        }
      };

      payments.forEach((p) => {
        if (abRowY > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();

          abHeaderY = doc.page.margins.top;
          doc.fontSize(9).font('Helvetica-Bold');
          doc.text('Fecha', abCol1, abHeaderY);
          doc.text('ID', abCol2, abHeaderY);
          doc.text('Cliente', abCol3, abHeaderY);
          doc.text('Venta', abCol4, abHeaderY);
          doc.text('Método', abCol5, abHeaderY);
          doc.text('Monto Bs', abCol6, abHeaderY, { width: 60, align: 'right' });

          abLineY = abHeaderY + 12;
          doc.moveTo(abCol1, abLineY)
            .lineTo(doc.page.width - doc.page.margins.right, abLineY)
            .strokeColor('#cccccc')
            .stroke();

          abRowY = abLineY + 5;
          doc.fontSize(8).font('Helvetica');
        }

        const dateObj = p.fecha ? new Date(p.fecha) : null;
        let fechaStr = p.fecha || '';
        if (dateObj && !isNaN(dateObj.getTime())) {
          const d = dateObj.toLocaleDateString('es-VE');
          const h = dateObj.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
          fechaStr = `${d} ${h}`;
        }

        const cliente = p.cliente_nombre || 'Cliente';
        const ventaId = p.venta_id ? `Venta #${p.venta_id}` : '-';
        const metodoLabel = getMetodoLabel(p.metodo);

        const montoVes = typeof p.monto_pagado_ves === 'number' ? p.monto_pagado_ves : 0;

        doc.text(fechaStr, abCol1, abRowY);
        doc.text(`#${p.id}`, abCol2, abRowY);
        doc.text(cliente, abCol3, abRowY, { width: 140 });
        doc.text(ventaId, abCol4, abRowY, { width: 80 });
        doc.text(metodoLabel, abCol5, abRowY, { width: 70 });
        doc.text(formatCurrency(montoVes), abCol6, abRowY, { width: 60, align: 'right' });

        abRowY += 14;
      });
    }

    doc.end();
  } catch (error) {
    console.error('Error generando reporte PDF por rango:', error);
    res.status(500).send('Error interno al generar el reporte PDF.');
  }
};

// ---------- Exportar reporte por rango a Excel ----------

const exportSalesReportExcel = (req, res) => {
  const { startDate, endDate, productoId, proveedor, categoria } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Se requieren fechas de inicio y fin.' });
  }

  try {
    const { summary, detailedSales } = generateReportDataHelper(startDate, endDate, {
      productoId,
      proveedor,
      categoria
    });

    const workbook = XLSX.utils.book_new();

    // 1. Resumen sheet
    const summaryData = [
      ['Reporte de Ventas y Ganancias'],
      ['Desde', startDate],
      ['Hasta', endDate],
      [],
      ['Filtro - Producto ID', productoId || 'Todos'],
      ['Filtro - Proveedor', proveedor || 'Todos'],
      ['Filtro - Categoría', categoria || 'Todos'],
      [],
      ['Métrica', 'Valor en Bolívares (VES)'],
      ['Ingresos Cobrados', summary.totalIngresos],
      ['Costo Asociado', summary.totalCosto],
      ['Ganancia Realizada', summary.totalGanancia],
      ['Saldo Pendiente (Fiado)', summary.totalFiado],
      ['IVA Recaudado', summary.totalIva],
      ['Total Ventas', summary.totalVentas]
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumen');

    // 2. Detalle de Ventas sheet
    const salesHeader = [
      'ID Venta',
      'Fecha',
      'Cliente ID',
      'Estado Pago',
      'Total Venta (VES)',
      'Total Costo (VES)',
      'Total Pagado (VES)',
      'Pendiente (VES)',
      'IVA (VES)',
      'Ingreso Realizado (VES)',
      'Costo Realizado (VES)',
      'Ganancia Realizada (VES)',
      'Productos Vendidos'
    ];

    const salesRows = detailedSales.map(sale => {
      const productsStr = sale.products
        .map(p => `${p.producto_nombre} (x${p.cantidad})`)
        .join(', ');

      return [
        sale.id,
        sale.creado_en,
        sale.cliente_id || 'N/A',
        sale.estado_pago,
        sale.total_ves,
        sale.total_costo_ves,
        sale.total_pagos_ves,
        sale.total_pendiente_ves,
        sale.impuesto_total || 0,
        sale.realized_ingreso_ves,
        sale.realized_costo_ves,
        sale.realized_ganancia_ves,
        productsStr
      ];
    });

    const salesSheet = XLSX.utils.aoa_to_sheet([salesHeader, ...salesRows]);
    XLSX.utils.book_append_sheet(workbook, salesSheet, 'Detalle Ventas');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="reporte_ventas_${startDate}_a_${endDate}.xlsx"`
    );
    res.send(buffer);
  } catch (error) {
    console.error('Error al exportar reporte a Excel:', error);
    res.status(500).json({ error: 'Error interno al exportar a Excel.' });
  }
};

// ---------- Resumen de pagos del día (para Cierre Z) ----------
// ⚠️ AQUÍ ES DONDE HACEMOS QUE, DESPUÉS DE UN CIERRE Z, EL SALDO DEL SISTEMA VUELVA A 0.

const getTodayPaymentSummary = (req, res) => {
  try {
    // 1) Buscamos el último cierre GLOBAL (cualquier fecha)
    let fromDateTime = '1970-01-01 00:00:00';
    try {
      const row = getLastClosureStmt.get();
      if (row && row.last_cierre) {
        fromDateTime = row.last_cierre;
      }
    } catch (e) {
      console.warn('Advertencia: no se pudo obtener el último cierre de caja:', e.message);
    }

    // 2) Movimientos desde ese momento en adelante
    const payments = getPaymentsSummarySinceStmt.all(fromDateTime, fromDateTime);

    let withdrawals = [];
    let openingsTotals = null;

    try {
      withdrawals = getWithdrawalsSummarySinceStmt.all(fromDateTime);
    } catch (e) {
      console.warn('Advertencia: no se pudo obtener el resumen de retiros de caja:', e.message);
    }

    try {
      openingsTotals = getOpeningsTotalsSinceStmt.get(fromDateTime);
    } catch (e) {
      console.warn('Advertencia: no se pudo obtener el resumen de aperturas de caja:', e.message);
    }

    const byMethod = {};

    const ensureMethod = (metodo) => {
      if (!byMethod[metodo]) {
        byMethod[metodo] = {
          metodo,
          total_ves: 0,
          total_usd: 0
        };
      }
      return byMethod[metodo];
    };

    // 3) Sumamos aperturas de caja (saldo inicial desde el último cierre)
    if (openingsTotals) {
      const aperturaVes = Number(openingsTotals.total_opening_ves || 0);
      const aperturaUsd = Number(openingsTotals.total_opening_usd || 0);

      if (aperturaVes !== 0) {
        const mVes = ensureMethod('VES_EFECTIVO');
        mVes.total_ves += aperturaVes;
      }
      if (aperturaUsd !== 0) {
        const mUsd = ensureMethod('USD_EFECTIVO');
        mUsd.total_usd += aperturaUsd;
      }
    }

    // 4) Sumamos cobros del período (ventas + abonos)
    payments.forEach((row) => {
      const m = ensureMethod(row.metodo);
      m.total_ves += Number(row.total_ves || 0);
      m.total_usd += Number(row.total_usd || 0);
    });

    // 5) Restamos retiros de caja del período
    withdrawals.forEach((row) => {
      const m = ensureMethod(row.metodo);
      m.total_ves -= Number(row.total_ves || 0);
      m.total_usd -= Number(row.total_usd || 0);
    });

    const summary = Object.values(byMethod);
    res.json(summary);
  } catch (error) {
    console.error('Error al obtener resumen de pagos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------- PDF Cierre Z ----------

const printCierreZ = (req, res) => {
  const { summaryData, notes, totals } = req.body;

  try {
    const settings = loadSettings();
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // 1) Determinar desde cuándo buscar (último cierre)
    let fromDateTime = '1970-01-01 00:00:00';
    try {
      const row = getLastClosureStmt.get();
      if (row && row.last_cierre) {
        fromDateTime = row.last_cierre;
      }
    } catch (e) {
      console.warn('Advertencia: no se pudo obtener el último cierre de caja:', e.message);
    }

    // 🔹 Registrar un nuevo Cierre Z en el historial "simple" (tabla cierres_caja)
    try {
      insertClosureStmt.run();
      console.log('Cierre de caja registrado en cierres_caja.');
    } catch (e) {
      console.error('Error registrando cierre de caja (cierres_caja):', e.message);
    }

    // Aperturas de caja del período
    let openings = [];
    try {
      openings = getOpeningsDetailSinceStmt.all(fromDateTime);
    } catch (e) {
      console.warn('No se pudieron cargar las aperturas para el Cierre Z:', e.message);
    }

    // Retiros del período
    let withdrawals = [];
    try {
      withdrawals = getWithdrawalsDetailSinceStmt.all(fromDateTime);
    } catch (e) {
      console.warn('No se pudieron cargar los retiros para el Cierre Z:', e.message);
    }

    // 🔹 Guardar snapshot detallado en tabla cierres_z (para historial / reimpresión)
    try {
      const sistemaVes = Number(totals && totals.sistemaVes !== undefined ? totals.sistemaVes : 0);
      const sistemaUsd = Number(totals && totals.sistemaUsd !== undefined ? totals.sistemaUsd : 0);
      const manualVes = Number(totals && totals.manualVes !== undefined ? totals.manualVes : 0);
      const manualUsd = Number(totals && totals.manualUsd !== undefined ? totals.manualUsd : 0);

      const diffVes =
        Number(
          totals && totals.diferenciaVes !== undefined
            ? totals.diferenciaVes
            : manualVes - sistemaVes
        ) || 0;

      const diffUsd =
        Number(
          totals && totals.diferenciaUsd !== undefined
            ? totals.diferenciaUsd
            : manualUsd - sistemaUsd
        ) || 0;

      const payload = {
        summaryData: summaryData || [],
        totals: totals || {},
        openings,
        withdrawals
      };

      insertCierreZHistoryStmt.run({
        total_sistema_ves: sistemaVes,
        total_sistema_usd: sistemaUsd,
        total_manual_ves: manualVes,
        total_manual_usd: manualUsd,
        diferencia_ves: diffVes,
        diferencia_usd: diffUsd,
        notes: notes ? String(notes) : null,
        raw_json: JSON.stringify(payload)
      });

      console.log('Cierre Z registrado en tabla cierres_z.');
    } catch (e) {
      console.error('Error registrando historial de cierre Z (cierres_z):', e.message);
    }

    const doc = new PDFDocument({ margin: 50 });
    const filename = `cierre - z - ${todayStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    doc.pipe(res);

    if (logoFullPath && fs.existsSync(logoFullPath) && isImageSupportedByPdfKit(logoFullPath)) {
      try {
        doc.image(logoFullPath, 50, doc.y, { width: 100, align: 'left' });
        doc.y += 50;
      } catch (imgError) {
        console.error('Error cargando imagen del logo para PDF:', imgError);
      }
    }

    doc.fontSize(20).font('Helvetica-Bold').text(settings.businessName || 'BodegApp', {
      align: 'center'
    });
    doc.moveDown(1);

    doc.fontSize(16).font('Helvetica-Bold').text('Reporte de Cierre de Caja (Cierre Z)', {
      align: 'center'
    });

    doc.fontSize(12).font('Helvetica').text(
      `Fecha: ${today.toLocaleString('es-VE', { dateStyle: 'long', timeStyle: 'short' })} `,
      { align: 'center' }
    );

    doc.moveDown(2);

    // -------- Conteo de pagos --------
    doc.fontSize(14).font('Helvetica-Bold').text('Conteo de Pagos');
    doc.moveDown(0.5);

    const col1 = 50;
    const col2 = 200;
    const col3 = 325;
    const col4 = 450;

    const headerY = doc.y;

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Método de Pago', col1, headerY);
    doc.text('Total Sistema', col2, headerY, { width: 100, align: 'right' });
    doc.text('Conteo Manual', col3, headerY, { width: 100, align: 'right' });
    doc.text('Diferencia', col4, headerY, { width: 100, align: 'right' });

    let rowY = headerY + 15;

    doc.moveTo(col1, rowY - 5)
      .lineTo(doc.page.width - col1, rowY - 5)
      .strokeColor('#cccccc')
      .stroke();

    rowY += 5;

    doc.fontSize(10).font('Helvetica');

    (summaryData || []).forEach((item) => {
      doc.text(item.metodo, col1, rowY);
      doc.text(String(item.sistema ?? ''), col2, rowY, { width: 100, align: 'right' });
      doc.text(String(item.manual ?? ''), col3, rowY, { width: 100, align: 'right' });

      const diff = item.diferencia ?? 0;
      const diffStr = typeof diff === 'number' ? diff.toFixed(2) : String(diff);

      if (diff !== 0 && diffStr !== '0.00') {
        doc.fillColor('red').text(diffStr, col4, rowY, { width: 100, align: 'right' });
      } else {
        doc.fillColor('black').text(diffStr, col4, rowY, { width: 100, align: 'right' });
      }

      doc.fillColor('black');
      rowY += 20;
    });

    doc.moveTo(col1, rowY - 5)
      .lineTo(doc.page.width - col1, rowY - 5)
      .strokeColor('#cccccc')
      .stroke();

    doc.font('Helvetica-Bold');

    // Totales en VES
    doc.text('Total Bolívares (VES)', col1, rowY);
    doc.text(String(totals.sistemaVes ?? ''), col2, rowY, { width: 100, align: 'right' });
    doc.text(String(totals.manualVes ?? ''), col3, rowY, { width: 100, align: 'right' });

    const diffVes = totals.diferenciaVes ?? 0;
    const diffVesStr = typeof diffVes === 'number' ? diffVes.toFixed(2) : String(diffVes);

    if (diffVes !== 0 && diffVesStr !== '0.00') doc.fillColor('red');
    doc.text(diffVesStr, col4, rowY, { width: 100, align: 'right' });
    doc.fillColor('black');
    rowY += 20;

    // Totales en USD
    doc.text('Total Dólares (USD)', col1, rowY);
    doc.text(String(totals.sistemaUsd ?? ''), col2, rowY, { width: 100, align: 'right' });
    doc.text(String(totals.manualUsd ?? ''), col3, rowY, { width: 100, align: 'right' });

    const diffUsd = totals.diferenciaUsd ?? 0;
    const diffUsdStr = typeof diffUsd === 'number' ? diffUsd.toFixed(2) : String(diffUsd);

    if (diffUsd !== 0 && diffUsdStr !== '0.00') doc.fillColor('red');
    doc.text(diffUsdStr, col4, rowY, { width: 100, align: 'right' });
    doc.fillColor('black');
    rowY += 30;

    if (notes) {
      doc.fontSize(14).font('Helvetica-Bold').text('Notas / Justificación');
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica').text(String(notes));
    }

    // ---------- Aperturas de Caja del Día (vista histórica del día completo) ----------
    if (openings && openings.length > 0) {
      doc.addPage();

      doc.fontSize(14).font('Helvetica-Bold').text('Aperturas de Caja del Día');
      doc.moveDown(0.5);

      const aCol1 = 50; // Fecha
      const aCol2 = 150; // ID
      const aCol3 = 200; // Tasa BCV
      const aCol4 = 300; // Monto Bs
      const aCol5 = 380; // Monto $
      const aCol6 = 460; // Notas

      let aHeaderY = doc.y;

      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Fecha', aCol1, aHeaderY);
      doc.text('ID', aCol2, aHeaderY);
      doc.text('Tasa BCV', aCol3, aHeaderY, { width: 90, align: 'right' });
      doc.text('Monto Bs', aCol4, aHeaderY, { width: 70, align: 'right' });
      doc.text('Monto $', aCol5, aHeaderY, { width: 70, align: 'right' });
      doc.text('Notas', aCol6, aHeaderY);

      let aLineY = aHeaderY + 12;
      doc.moveTo(aCol1, aLineY)
        .lineTo(doc.page.width - doc.page.margins.right, aLineY)
        .strokeColor('#cccccc')
        .stroke();

      let aRowY = aLineY + 5;
      doc.fontSize(8).font('Helvetica');

      let totalAperturaVes = 0;
      let totalAperturaUsd = 0;

      openings.forEach((o) => {
        if (aRowY > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();

          aHeaderY = doc.page.margins.top;
          doc.fontSize(9).font('Helvetica-Bold');
          doc.text('Fecha', aCol1, aHeaderY);
          doc.text('ID', aCol2, aHeaderY);
          doc.text('Tasa BCV', aCol3, aHeaderY, { width: 90, align: 'right' });
          doc.text('Monto Bs', aCol4, aHeaderY, { width: 70, align: 'right' });
          doc.text('Monto $', aCol5, aHeaderY, { width: 70, align: 'right' });
          doc.text('Notas', aCol6, aHeaderY);

          aLineY = aHeaderY + 12;
          doc.moveTo(aCol1, aLineY)
            .lineTo(doc.page.width - doc.page.margins.right, aLineY)
            .strokeColor('#cccccc')
            .stroke();

          aRowY = aLineY + 5;
          doc.fontSize(8).font('Helvetica');
        }

        const dateObj = o.fecha ? new Date(o.fecha) : null;
        let fechaStr = o.fecha || '';
        if (dateObj && !isNaN(dateObj.getTime())) {
          const d = dateObj.toLocaleDateString('es-VE');
          const h = dateObj.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
          fechaStr = `${d} ${h} `;
        }

        const montoVes = Number(o.opening_ves || 0);
        const montoUsd = Number(o.opening_usd || 0);
        const tasaBcv = Number(o.tasa_bcv_momento || 0);
        const notas = o.notas || '';

        totalAperturaVes += montoVes;
        totalAperturaUsd += montoUsd;

        doc.text(fechaStr, aCol1, aRowY, { width: 90 });
        doc.text(`#${o.id} `, aCol2, aRowY, { width: 40 });
        doc.text(formatCurrency(tasaBcv), aCol3, aRowY, { width: 90, align: 'right' });
        doc.text(formatCurrency(montoVes), aCol4, aRowY, { width: 70, align: 'right' });
        doc.text(formatCurrency(montoUsd), aCol5, aRowY, { width: 70, align: 'right' });
        doc.text(notas, aCol6, aRowY, {
          width: doc.page.width - doc.page.margins.right - aCol6
        });

        aRowY += 14;
      });

      doc.fontSize(10).font('Helvetica-Bold');
      doc.text(
        `Total aperturas del día: ${formatCurrency(totalAperturaVes)} Bs / ${formatCurrency(totalAperturaUsd)} $`,
        aCol1,
        aRowY + 5
      );
    }

    // ---------- Retiros de Caja del Día (vista histórica del día completo) ----------
    if (withdrawals && withdrawals.length > 0) {
      doc.addPage();

      doc.fontSize(14).font('Helvetica-Bold').text('Retiros de Caja del Día');
      doc.moveDown(0.5);

      const wCol1 = 50; // Fecha
      const wCol2 = 150; // ID
      const wCol3 = 200; // Método
      const wCol4 = 300; // Monto Bs
      const wCol5 = 380; // Monto $
      const wCol6 = 460; // Descripción

      let wHeaderY = doc.y;

      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Fecha', wCol1, wHeaderY);
      doc.text('ID', wCol2, wHeaderY);
      doc.text('Método', wCol3, wHeaderY);
      doc.text('Monto Bs', wCol4, wHeaderY, { width: 70, align: 'right' });
      doc.text('Monto $', wCol5, wHeaderY, { width: 70, align: 'right' });
      doc.text('Descripción', wCol6, wHeaderY);

      let wLineY = wHeaderY + 12;
      doc.moveTo(wCol1, wLineY)
        .lineTo(doc.page.width - doc.page.margins.right, wLineY)
        .strokeColor('#cccccc')
        .stroke();

      let wRowY = wLineY + 5;
      doc.fontSize(8).font('Helvetica');

      let totalRetiroVes = 0;
      let totalRetiroUsd = 0;

      const mapMetodo = (metodo) => {
        switch (metodo) {
          case 'VES_EFECTIVO':
            return 'Efectivo Bs';
          case 'USD_EFECTIVO':
            return 'Efectivo $';
          case 'COP_EFECTIVO':
            return 'Pesos Colombianos (Efectivo)';
          case 'COP_TRANSFERENCIA':
            return 'Pesos Colombianos (Transferencia)';
          case 'PUNTO_VENTA':
            return 'Punto de Venta';
          case 'BIOPAGO':
            return 'Biopago';
          case 'TARJETA':
            return 'Tarjeta';
          case 'PAGOMOVIL':
            return 'Pago Móvil';
          case 'TRANSFERENCIA':
            return 'Transferencia';
          case 'CASHEA':
            return 'Cashea';
          case 'CASHEA_LIQUIDACION':
            return 'Liquidación Cashea';
          default:
            return metodo || 'Otro';
        }
      };

      withdrawals.forEach((w) => {
        if (wRowY > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();

          wHeaderY = doc.page.margins.top;
          doc.fontSize(9).font('Helvetica-Bold');
          doc.text('Fecha', wCol1, wHeaderY);
          doc.text('ID', wCol2, wHeaderY);
          doc.text('Método', wCol3, wHeaderY);
          doc.text('Monto Bs', wCol4, wHeaderY, { width: 70, align: 'right' });
          doc.text('Monto $', wCol5, wHeaderY, { width: 70, align: 'right' });
          doc.text('Descripción', wCol6, wHeaderY);

          wLineY = wHeaderY + 12;
          doc.moveTo(wCol1, wLineY)
            .lineTo(doc.page.width - doc.page.margins.right, wLineY)
            .strokeColor('#cccccc')
            .stroke();

          wRowY = wLineY + 5;
          doc.fontSize(8).font('Helvetica');
        }

        const dateObj = w.fecha ? new Date(w.fecha) : null;
        let fechaStr = w.fecha || '';
        if (dateObj && !isNaN(dateObj.getTime())) {
          const d = dateObj.toLocaleDateString('es-VE');
          const h = dateObj.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
          fechaStr = `${d} ${h} `;
        }

        const metodoLabel = mapMetodo(w.metodo);
        const montoVes = Number(w.monto_ves || 0);
        const montoUsd = Number(w.monto_usd || 0);

        totalRetiroVes += montoVes;
        totalRetiroUsd += montoUsd;

        const desc = w.descripcion || '';

        doc.text(fechaStr, wCol1, wRowY, { width: 90 });
        doc.text(`#${w.id} `, wCol2, wRowY, { width: 40 });
        doc.text(metodoLabel, wCol3, wRowY, { width: 90 });
        doc.text(formatCurrency(montoVes), wCol4, wRowY, { width: 70, align: 'right' });
        doc.text(formatCurrency(montoUsd), wCol5, wRowY, { width: 70, align: 'right' });
        doc.text(desc, wCol6, wRowY, {
          width: doc.page.width - doc.page.margins.right - wCol6
        });

        wRowY += 14;
      });

      doc.fontSize(10).font('Helvetica-Bold');
      doc.text(
        `Total retiros del día: ${formatCurrency(totalRetiroVes)} Bs / ${formatCurrency(totalRetiroUsd)} $`,
        wCol1,
        wRowY + 5
      );
    }

    doc.end();
  } catch (error) {
    console.error('Error generando PDF de Cierre Z:', error);
    res.status(500).send('Error interno al generar el PDF.');
  }
};

// ---------- Dashboard (home) ----------
// ⚠️ NOTA: Esto sigue usando TODO el día, NO se ve afectado por los cierres.

const getTodayDashboardStats = (req, res) => {
  try {
    const bcvRate = getBcvRate();

    const statsVentas = getTodayDashboardStatsStmt_Ventas.get() || {};
    const statsAbonos = getTodayDashboardStatsStmt_Abonos.get() || {};
    const totalCobradoVes = 
      Number(statsVentas.total_cobrado_ventas_hoy || 0) + 
      Number(statsAbonos.total_abonos_hoy || 0);

    const profitVes = Number(statsVentas.total_ingresos_ves || 0) - Number(statsVentas.total_costo_ves || 0);

    const profitUsd = bcvRate > 0 ? profitVes / bcvRate : 0;

    res.json({
      sale_count: Number(statsVentas.sale_count || 0),
      profit_ves: profitVes,
      profit_usd: profitUsd,
      total_cobrado_ves: totalCobradoVes
    });
  } catch (error) {
    console.error('Error al obtener estadísticas del dashboard:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------- Top productos ----------

const getTopSellingProducts = (req, res) => {
  try {
    const products = db.prepare(`
        SELECT
          COALESCE(p.nombre, vp.nombre, 'Venta Libre') as nombre,
          SUM(vp.cantidad) as total_sold
        FROM venta_productos vp
        LEFT JOIN productos p ON vp.producto_id = p.id
        JOIN ventas v ON vp.venta_id = v.id
        WHERE v.creado_en >= date('now', '-28 days')
          AND v.estado_pago != 'ANULADO'
        GROUP BY vp.producto_id, COALESCE(p.nombre, vp.nombre, 'Venta Libre')
        ORDER BY total_sold DESC
        LIMIT 5
      `).all();

    res.json(products);
  } catch (error) {
    console.error('Error al obtener top products:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// ---------- Registrar retiro de caja ----------

const registerCashWithdrawal = (req, res) => {
  try {
    const { metodo, monto, descripcion = '' } = req.body;
    const amount = parseFloat(monto);

    if (!metodo || !['VES_EFECTIVO', 'USD_EFECTIVO'].includes(metodo)) {
      return res.status(400).json({ error: 'Método de retiro inválido.' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
    }

    const bcv = getBcvRate() || 1;

    let monto_ves = 0;
    let monto_usd = 0;

    if (metodo === 'VES_EFECTIVO') {
      monto_ves = amount;
      monto_usd = amount / bcv;
    } else if (metodo === 'USD_EFECTIVO') {
      monto_usd = amount;
      monto_ves = amount * bcv;
    }

    const info = insertWithdrawalStmt.run({
      metodo,
      monto_ves,
      monto_usd,
      descripcion: typeof descripcion === 'string' && descripcion.trim() ? descripcion.trim() : null
    });

    res.json({
      success: true,
      id: info.lastInsertRowid,
      metodo,
      monto_ves,
      monto_usd
    });
  } catch (error) {
    console.error('Error registrando retiro de caja:', error);
    res.status(500).json({
      error: 'Error interno al registrar el retiro de caja.'
    });
  }
};

// ---------- Registrar Avance de Efectivo (Cash Advance) ----------
const registerCashAdvance = (req, res) => {
  try {
    const { amount_out, fee_amount, method_in, description } = req.body;

    const cashOut = parseFloat(amount_out);
    const fee = parseFloat(fee_amount);
    const totalIn = cashOut + fee;

    if (!cashOut || cashOut <= 0) {
      return res.status(400).json({ error: 'El monto a entregar debe ser mayor a 0.' });
    }
    // fee puede ser 0
    if (fee < 0) {
      return res.status(400).json({ error: 'La comisión no puede ser negativa.' });
    }
    if (!method_in) {
      return res.status(400).json({ error: 'Debe especificar el método de cobro.' });
    }

    const bcv = getBcvRate() || 1;

    // Transacción para asegurar integridad
    const tx = db.transaction(() => {
      // 1. Crear Venta (Ingreso Digital)
      // Como es un servicio, podemos poner cliente NULL (o id 0 si la FK lo requiere, pero suele ser NULL)
      // Estado PAGADO
      const insertSale = db.prepare(`
        INSERT INTO ventas (total_ves, total_usd_bcv, estado_pago, monto_pendiente_usd, creado_en)
        VALUES (?, ?, 'PAGADO', 0, datetime('now', 'localtime'))
      `);
      // total_in es en VES
      const infoSale = insertSale.run(totalIn, totalIn / bcv);
      const saleId = infoSale.lastInsertRowid;

      // Insertar producto abstracto "Avance de Efectivo"
      // Usamos costo = cashOut para que la ganancia refleje solo el fee (totalIn - cashOut)
      const insertSaleProduct = db.prepare(`
        INSERT INTO venta_productos (venta_id, producto_id, cantidad, precio_unitario_ves, costo_unitario_ves)
        VALUES (?, NULL, 1, ?, ?)
      `);
      insertSaleProduct.run(saleId, totalIn, cashOut);

      // Insertar pago recibido (Total cobrado)
      const insertPayment = db.prepare(`
        INSERT INTO venta_pagos (venta_id, metodo, monto_recibido, monto_en_ves, tasa_bcv_momento)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      let montoRecibido = totalIn;
      let montoEnVes = totalIn;

      if (method_in === 'USD_EFECTIVO') {
        montoRecibido = totalIn / bcv;
      } else if (method_in === 'COP_EFECTIVO') {
        const rates = getRatesForPricing();
        const copRate = !isNaN(rates.COP) && rates.COP > 0 ? Number(rates.COP) : 1;
        montoRecibido = totalIn * (copRate / bcv);
      }

      insertPayment.run(saleId, method_in, montoRecibido, montoEnVes, bcv);

      // 2. Crear Retiro de Caja (Salida Física)
      // Asumimos que entregamos VES_EFECTIVO.
      const monto_ves_retiro = cashOut;
      const monto_usd_retiro = cashOut / bcv;

      const descFinal = description ? `${description} (Venta #${saleId})` : `Avance de Efectivo (Venta #${saleId})`;

      const insertRetiro = db.prepare(`
        INSERT INTO retiros_caja (metodo, monto_ves, monto_usd, descripcion, fecha)
        VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
      `);
      insertRetiro.run('VES_EFECTIVO', monto_ves_retiro, monto_usd_retiro, descFinal);

      return { saleId, totalIn, cashOut, fee };
    });

    const result = tx();
    res.json({ success: true, ...result });

  } catch (error) {
    console.error('Error registrando avance de efectivo:', error);
    res.status(500).json({ error: 'Error interno al procesar el avance.' });
  }
};


// ---------- NUEVO: Registrar apertura de caja (versión robusta) ----------

const registerCashOpening = (req, res) => {
  try {
    console.log('🧾 Body recibido en /cash-opening:', req.body);

    const rawOpeningVes =
      req.body.opening_ves ?? req.body.openingVes ?? req.body.monto_ves ?? req.body.montoBs ?? 0;

    const rawOpeningUsd =
      req.body.opening_usd ?? req.body.openingUsd ?? req.body.monto_usd ?? req.body.montoUsd ?? 0;

    const rawNotes = req.body.notes ?? req.body.notas ?? req.body.descripcion ?? '';

    const aperturaVes = Number(rawOpeningVes) || 0;
    const aperturaUsd = Number(rawOpeningUsd) || 0;

    if (aperturaVes <= 0 && aperturaUsd <= 0) {
      return res.status(400).json({
        error: 'Debes ingresar al menos un monto distinto de 0.'
      });
    }

    const bcv = getBcvRate() || 0;

    const info = insertOpeningStmt.run({
      opening_ves: aperturaVes,
      opening_usd: aperturaUsd,
      tasa_bcv_momento: bcv,
      notas: typeof rawNotes === 'string' && rawNotes.trim() ? rawNotes.trim() : null
    });

    return res.json({
      success: true,
      id: info.lastInsertRowid,
      opening_ves: aperturaVes,
      opening_usd: aperturaUsd,
      tasa_bcv_momento: bcv
    });
  } catch (error) {
    console.error('Error registrando apertura de caja:', error);
    return res.status(500).json({
      error: 'Error interno al registrar la apertura de caja.'
    });
  }
};

// ---------- Obtener aperturas de caja de hoy (JSON) ----------

const getTodayCashOpening = (req, res) => {
  try {
    // 1) Buscar último cierre
    let fromDateTime = '1970-01-01 00:00:00';
    try {
      const row = getLastClosureStmt.get();
      if (row && row.last_cierre) {
        fromDateTime = row.last_cierre;
      }
    } catch (e) { }

    const openings = getOpeningsDetailSinceStmt.all(fromDateTime);

    // Calcular totales reutilizando la sentencia "TotalsSince"
    const totalsRow = getOpeningsTotalsSinceStmt.get(fromDateTime) || { total_opening_ves: 0, total_opening_usd: 0 };

    res.json({
      openings,
      totals: totalsRow
    });
  } catch (error) {
    console.error('Error al obtener aperturas de caja de hoy:', error);
    res.status(500).json({
      error: 'Error interno al obtener las aperturas de caja de hoy.'
    });
  }
};

// ---------- PDF Inventario ----------

const printInventoryPdf = (req, res) => {
  try {
    const settings = loadSettings();
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const rates = getRatesForPricing();

    const productsDb = getInventoryForPdfStmt.all();
    const products = productsDb.map((p) => {
      const prod = {
        ...p,
        costo: parseFloat(p.costo) || 0,
        porcentaje_ganancia: parseFloat(p.porcentaje_ganancia) || 0,
        stock: p.stock !== undefined && p.stock !== null ? Number(parseFloat(p.stock).toFixed(4)) : 0
      };
      const priced = calculateSalePrices(prod, rates);

      return {
        nombre: priced.nombre || '',
        stock: Number(priced.stock || 0),
        priceUsd: Number(priced.precio_final_usd_bcv || 0),
        priceVes: Number(priced.precio_final_ves || 0)
      };
    });

    const doc = new PDFDocument({ margin: 40 });
    const filename = `inventario - ${todayStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    doc.pipe(res);

    let y = doc.y;

    if (logoFullPath && fs.existsSync(logoFullPath) && isImageSupportedByPdfKit(logoFullPath)) {
      try {
        doc.image(logoFullPath, 50, y, { width: 100, align: 'left' });
        y += 50;
      } catch (err) {
        console.error('Error cargando logo inventario:', err);
      }
    }

    doc.fontSize(20).font('Helvetica-Bold').text(settings.businessName || 'BodegApp', {
      align: 'center'
    });
    doc.moveDown(1);

    doc.fontSize(16).font('Helvetica-Bold').text('Inventario de Productos', { align: 'center' });

    doc.fontSize(11).font('Helvetica').text(`Fecha: ${today.toLocaleDateString('es-VE')} `, {
      align: 'center'
    });

    doc.moveDown(1);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Tasa BCV usada: ${formatCurrency(rates.BCV || 0)} Bs / $`, { align: 'center' });
    doc.moveDown(2);

    const col1 = 50;
    const col2 = 320;
    const col3 = 380;
    const col4 = 460;

    const headerY = doc.y;

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Producto', col1, headerY);
    doc.text('Stock', col2, headerY, { width: 50, align: 'right' });
    doc.text('Precio $', col3, headerY, { width: 60, align: 'right' });
    doc.text('Precio Bs', col4, headerY, { width: 70, align: 'right' });

    let rowY = headerY + 15;

    doc.moveTo(col1, rowY - 5)
      .lineTo(doc.page.width - doc.page.margins.right, rowY - 5)
      .strokeColor('#cccccc')
      .stroke();

    rowY += 5;

    if (products.length === 0) {
      doc.moveDown(1);
      doc.fontSize(11).font('Helvetica').text('No hay productos registrados en el inventario.');
      doc.end();
      return;
    }

    doc.fontSize(9).font('Helvetica');
    const lineHeight = 14;

    products.forEach((p) => {
      if (rowY > doc.page.height - doc.page.margins.bottom - lineHeight) {
        doc.addPage();
        rowY = doc.page.margins.top;

        const pageHeaderY = rowY;
        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Producto', col1, pageHeaderY);
        doc.text('Stock', col2, pageHeaderY, { width: 50, align: 'right' });
        doc.text('Precio $', col3, pageHeaderY, { width: 60, align: 'right' });
        doc.text('Precio Bs', col4, pageHeaderY, { width: 70, align: 'right' });

        rowY = pageHeaderY + 15;
        doc.moveTo(col1, rowY - 5)
          .lineTo(doc.page.width - doc.page.margins.right, rowY - 5)
          .strokeColor('#cccccc')
          .stroke();

        rowY += 5;
        doc.fontSize(9).font('Helvetica');
      }

      doc.text(p.nombre, col1, rowY, { width: col2 - col1 - 10 });
      doc.text(String(p.stock), col2, rowY, { width: 50, align: 'right' });
      doc.text(formatCurrency(p.priceUsd), col3, rowY, { width: 60, align: 'right' });
      doc.text(formatCurrency(p.priceVes), col4, rowY, { width: 70, align: 'right' });

      rowY += lineHeight;
    });

    doc.end();
  } catch (error) {
    console.error('Error generando PDF de inventario:', error);
    res.status(500).send('Error interno al generar el PDF de inventario.');
  }
};

// ---------- PDF Fiados ----------

const printFiadosPdf = (req, res) => {
  try {
    const settings = loadSettings();
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const bcv = getBcvRate() || 1;

    const fiados = getFiadosForPdfStmt.all().map((row) => {
      const pendienteUsd = Number(row.total_pendiente_usd || 0);
      return {
        cliente_nombre: row.cliente_nombre || 'SIN NOMBRE',
        cliente_cedula: row.cliente_cedula || 'N/A',
        total_pendiente_usd: pendienteUsd,
        total_pendiente_ves: pendienteUsd * bcv
      };
    });

    const totalPendienteUsd = fiados.reduce((acc, v) => acc + v.total_pendiente_usd, 0);
    const totalPendienteVes = fiados.reduce((acc, v) => acc + v.total_pendiente_ves, 0);

    const doc = new PDFDocument({ margin: 40 });
    const filename = `fiados-${todayStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    doc.pipe(res);

    if (logoFullPath && fs.existsSync(logoFullPath) && isImageSupportedByPdfKit(logoFullPath)) {
      try {
        const logoImg = doc.openImage(logoFullPath);
        const logoWidth = 100;
        const logoHeight = (logoImg.height / logoImg.width) * logoWidth;
        doc.image(logoFullPath, 50, 40, { width: logoWidth });
        doc.y = Math.max(doc.y, 40 + logoHeight + 30); // Garantizar espacio limpio debajo
      } catch (err) {
        console.error('Error cargando logo fiados:', err);
      }
    } else {
        doc.y += 30; // Si no hay logo, bajar un poco para el titulo
    }

    doc.fontSize(20).font('Helvetica-Bold').text(settings.businessName || 'BodegApp', {
      align: 'center'
    });
    doc.moveDown(1);

    doc.fontSize(16).font('Helvetica-Bold').text('Reporte General de Deudores (Fiados)', {
      align: 'center'
    });

    doc.fontSize(11).font('Helvetica').text(`Fecha de Emisión: ${today.toLocaleDateString('es-VE')}`, {
      align: 'center'
    });

    doc.moveDown(1);

    doc.fontSize(11).font('Helvetica-Bold').text('Resumen de Deuda Total');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Tasa de Cambio (BCV): ${formatCurrency(bcv)} Bs/$`);
    doc.text(`Total por Cobrar en USD: ${formatCurrency(totalPendienteUsd)} $`);
    doc.text(`Total por Cobrar en Bs: ${formatCurrency(totalPendienteVes)} Bs`);
    doc.moveDown(2);

    if (fiados.length === 0) {
      doc.fontSize(11).font('Helvetica').text('No se encontraron deudores con saldo pendiente.');
      doc.end();
      return;
    }

    const col1 = 50;  // Nombre
    const col2 = 250; // Cédula
    const col3 = 380; // Pendiente $
    const col4 = 480; // Pendiente Bs

    const headerY = doc.y;

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Cliente / Nombre Completo', col1, headerY);
    doc.text('Cédula de Identidad', col2, headerY);
    doc.text('Deuda Total $', col3, headerY, { width: 80, align: 'right' });
    doc.text('Deuda Total Bs', col4, headerY, { width: 80, align: 'right' });

    let rowY = headerY + 15;

    doc.moveTo(col1, rowY - 5)
      .lineTo(doc.page.width - doc.page.margins.right, rowY - 5)
      .strokeColor('#cccccc')
      .stroke();

    rowY += 5;

    doc.fontSize(9).font('Helvetica');
    const lineHeight = 16;

    fiados.forEach((f) => {
      if (rowY > doc.page.height - doc.page.margins.bottom - lineHeight) {
        doc.addPage();
        rowY = doc.page.margins.top;

        const pageHeaderY = rowY;

        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Cliente / Nombre Completo', col1, pageHeaderY);
        doc.text('Cédula de Identidad', col2, pageHeaderY);
        doc.text('Deuda Total $', col3, pageHeaderY, { width: 80, align: 'right' });
        doc.text('Deuda Total Bs', col4, pageHeaderY, { width: 80, align: 'right' });

        rowY = pageHeaderY + 15;

        doc.moveTo(col1, rowY - 5)
          .lineTo(doc.page.width - doc.page.margins.right, rowY - 5)
          .strokeColor('#cccccc')
          .stroke();

        rowY += 5;
        doc.fontSize(9).font('Helvetica');
      }

      doc.text(f.cliente_nombre, col1, rowY, { width: col2 - col1 - 10 });
      doc.text(f.cliente_cedula, col2, rowY, { width: col3 - col2 - 10 });
      doc.text(formatCurrency(f.total_pendiente_usd), col3, rowY, { width: 80, align: 'right' });
      doc.text(formatCurrency(f.total_pendiente_ves), col4, rowY, { width: 80, align: 'right' });

      rowY += lineHeight;
    });

    doc.end();
  } catch (error) {
    console.error('Error generando PDF de fiados:', error);
    res.status(500).send('Error interno al generar el PDF de fiados.');
  }
};

// ---------- NUEVOS CONTROLADORES: Historial y reimpresión de Cierre Z ----------

// GET /api/reports/cierre-z/history?limit=50&page=1
const getCierreZHistory = (req, res) => {
  try {
    const limitParam = req.query.limit;
    const pageParam = req.query.page;

    let limit = 50;
    if (limitParam !== undefined) {
      const parsed = parseInt(limitParam, 10);
      if (!Number.isNaN(parsed) && parsed > 0) limit = parsed;
    }
    if (limit > 200) limit = 200;

    let page = 1;
    if (pageParam !== undefined) {
      const parsed = parseInt(pageParam, 10);
      if (!Number.isNaN(parsed) && parsed > 0) page = parsed;
    }

    const totalRow = getCierreZHistoryCountStmt.get() || { total: 0 };
    const total = Number(totalRow.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    if (page > totalPages) page = totalPages;

    const offset = (page - 1) * limit;

    const rowsDb = getCierreZHistoryStmt.all(limit, offset) || [];

    const rows = rowsDb.map((r) => {
      let parsed = null;
      try {
        parsed = r.raw_json ? JSON.parse(r.raw_json) : null;
      } catch (e) {
        parsed = null;
      }

      const summaryData = parsed?.summaryData || [];
      const totalsFromJson = parsed?.totals || {};

      return {
        id: r.id,
        fecha: r.fecha,
        total_sistema_ves: r.total_sistema_ves,
        total_sistema_usd: r.total_sistema_usd,
        total_manual_ves: r.total_manual_ves,
        total_manual_usd: r.total_manual_usd,
        diferencia_ves: r.diferencia_ves,
        diferencia_usd: r.diferencia_usd,
        notes: r.notes,

        // ✅ Detalle por método listo para usar
        summaryData: normalizeCierreZSummaryData(summaryData),
        totalsFromJson
      };
    });

    res.json({
      page,
      limit,
      total,
      totalPages,
      rows
    });
  } catch (error) {
    console.error('Error cargando historial de cierres Z:', error);
    res.status(500).json({ error: 'No se pudo cargar el historial de cierres.' });
  }
};

// GET /api/reports/cierre-z/:id/pdf
const printCierreZById = (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (!id) {
    return res.status(400).json({ error: 'ID de cierre inválido.' });
  }

  try {
    const cierre = getCierreZByIdStmt.get(id);
    if (!cierre) {
      return res.status(404).json({ error: 'Cierre Z no encontrado.' });
    }

    const settings = loadSettings();
    const logoFullPath = settings.logoPath
      ? path.join(uploadsBasePath, path.basename(settings.logoPath))
      : null;

    let fecha = new Date();
    if (cierre.fecha) {
      const tmp = new Date(cierre.fecha);
      if (!Number.isNaN(tmp.getTime())) {
        fecha = tmp;
      }
    }

    let summaryDataFromJson = [];
    let totalsFromJson = {};

    try {
      if (cierre.raw_json) {
        const raw = JSON.parse(cierre.raw_json);
        if (raw && typeof raw === 'object') {
          if (Array.isArray(raw.summaryData)) {
            summaryDataFromJson = raw.summaryData;
          }
          if (raw.totals && typeof raw.totals === 'object') {
            totalsFromJson = raw.totals;
          }
        }
      }
    } catch (e) {
      console.warn('No se pudo parsear raw_json para cierre Z #' + id, e);
    }

    const sistemaVes =
      Number(
        totalsFromJson.sistemaVes !== undefined ? totalsFromJson.sistemaVes : cierre.total_sistema_ves
      ) || 0;

    const sistemaUsd =
      Number(
        totalsFromJson.sistemaUsd !== undefined ? totalsFromJson.sistemaUsd : cierre.total_sistema_usd
      ) || 0;

    const manualVes =
      Number(
        totalsFromJson.manualVes !== undefined ? totalsFromJson.manualVes : cierre.total_manual_ves
      ) || 0;

    const manualUsd =
      Number(
        totalsFromJson.manualUsd !== undefined ? totalsFromJson.manualUsd : cierre.total_manual_usd
      ) || 0;

    const diffVes =
      Number(
        totalsFromJson.diferenciaVes !== undefined
          ? totalsFromJson.diferenciaVes
          : cierre.diferencia_ves !== null && cierre.diferencia_ves !== undefined
            ? cierre.diferencia_ves
            : manualVes - sistemaVes
      ) || 0;

    const diffUsd =
      Number(
        totalsFromJson.diferenciaUsd !== undefined
          ? totalsFromJson.diferenciaUsd
          : cierre.diferencia_usd !== null && cierre.diferencia_usd !== undefined
            ? cierre.diferencia_usd
            : manualUsd - sistemaUsd
      ) || 0;

    // ✅ Normalizar para soportar snapshots viejos/nuevos
    const normalizedSummary = normalizeCierreZSummaryData(summaryDataFromJson);

    const doc = new PDFDocument({ margin: 50 });
    const filename = `cierre - z - ${id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    doc.pipe(res);

    let y = doc.y;
    if (logoFullPath && fs.existsSync(logoFullPath) && isImageSupportedByPdfKit(logoFullPath)) {
      try {
        doc.image(logoFullPath, 50, y, { width: 100, align: 'left' });
        y += 50;
      } catch (err) {
        console.error('Error cargando logo para reimpresión de cierre Z:', err);
      }
    }

    doc.fontSize(20).font('Helvetica-Bold').text(settings.businessName || 'BodegApp', {
      align: 'center'
    });
    doc.moveDown(1);

    doc.fontSize(16).font('Helvetica-Bold').text(`Cierre de Caja(Cierre Z) #${id} `, {
      align: 'center'
    });

    doc.fontSize(12).font('Helvetica').text(
      `Fecha de cierre: ${fecha.toLocaleString('es-VE', { dateStyle: 'long', timeStyle: 'short' })} `,
      { align: 'center' }
    );

    doc.moveDown(2);

    doc.fontSize(14).font('Helvetica-Bold').text('Resumen del Cierre');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');

    doc.text(`Total sistema en Bolívares: ${formatCurrency(sistemaVes)} Bs`);
    doc.text(`Total sistema en Dólares: ${formatCurrency(sistemaUsd)} $`);
    doc.moveDown(0.5);
    doc.text(`Total conteo manual en Bolívares: ${formatCurrency(manualVes)} Bs`);
    doc.text(`Total conteo manual en Dólares: ${formatCurrency(manualUsd)} $`);
    doc.moveDown(0.5);

    doc.text(`Diferencia en Bolívares: ${formatCurrency(diffVes)} Bs`);
    doc.text(`Diferencia en Dólares: ${formatCurrency(diffUsd)} $`);
    doc.moveDown(1.5);

    const notasFinales = (cierre.notes && String(cierre.notes).trim()) || '';
    if (notasFinales) {
      doc.fontSize(13).font('Helvetica-Bold').text('Notas del cierre');
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica').text(notasFinales);
      doc.moveDown(1.5);
    }

    if (Array.isArray(normalizedSummary) && normalizedSummary.length > 0) {
      doc.fontSize(13).font('Helvetica-Bold').text('Detalle por método de pago');
      doc.moveDown(0.5);

      const col1 = 50;
      const col2 = 250;
      const col3 = 380;
      const col4 = 480;

      const headerY = doc.y;

      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Método', col1, headerY);
      doc.text('Sistema', col2, headerY, { width: 80, align: 'right' });
      doc.text('Manual', col3, headerY, { width: 80, align: 'right' });
      doc.text('Diferencia', col4, headerY, { width: 80, align: 'right' });

      let rowY = headerY + 15;

      doc.moveTo(col1, rowY - 5)
        .lineTo(doc.page.width - doc.page.margins.right, rowY - 5)
        .strokeColor('#cccccc')
        .stroke();

      rowY += 5;
      doc.fontSize(9).font('Helvetica');

      normalizedSummary.forEach((item) => {
        if (rowY > doc.page.height - doc.page.margins.bottom - 16) {
          doc.addPage();
          rowY = doc.page.margins.top;
        }

        const label = item.label || mapMetodoLabel(item.metodo);
        const cur = item.currency || normalizeCurrencyFromMetodo(item.metodo);
        const sistema = Number(item.sistema || 0);
        const manual = Number(item.manual || 0);
        const diff = Number(item.diferencia || manual - sistema);

        const suf = String(cur).toUpperCase() === 'USD' ? '$' : 'Bs';

        doc.text(label, col1, rowY, { width: 180 });
        doc.text(`${formatCurrency(sistema)} ${suf} `, col2, rowY, { width: 80, align: 'right' });
        doc.text(`${formatCurrency(manual)} ${suf} `, col3, rowY, { width: 80, align: 'right' });

        if (Math.abs(diff) > 0.005) doc.fillColor('red');
        else doc.fillColor('black');

        doc.text(`${formatCurrency(diff)} ${suf} `, col4, rowY, { width: 80, align: 'right' });
        doc.fillColor('black');

        rowY += 14;
      });
    }

    doc.end();
  } catch (error) {
    console.error('Error generando PDF de reimpresión de cierre Z:', error);
    res.status(500).json({ error: 'Error interno al generar el PDF del cierre Z.' });
  }
};

// ================== SEARCH ==================

const searchSales = (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json({ detailedSales: [] });
  }

  try {
    const term = `% ${q}% `;
    const sales = searchSalesStmt.all(term, term, term);

    const { detailedSales } = computeRealizedSummaryForSales(sales);

    // Poblar productos
    const salesWithProducts = detailedSales.map(sale => {
      const products = getSaleProductsForSaleIdWithNameStmt.all(sale.id);
      return { ...sale, products };
    });

    res.json({ detailedSales: salesWithProducts });
  } catch (error) {
    console.error('Error searching sales:', error);
    res.status(500).json({ error: 'Error al buscar ventas' });
  }
};

// ================== LISTA DE REPOSICIÓN DEL DÍA ==================

const getDailyRestockList = (req, res) => {
  try {
    const today = new Date();
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(today.getDate() - 5);

    const items = getDailyRestockListStmt.all();

    const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
    const dateRange = `desde ${fiveDaysAgo.toLocaleDateString('es-VE', options)} hasta ${today.toLocaleDateString('es-VE', options)}`;

    res.json({
      success: true,
      fecha: dateRange,
      items
    });
  } catch (error) {
    console.error('Error al obtener lista de reposición:', error);
    res.status(500).json({ error: 'Error al obtener lista de reposición.' });
  }
};

// ================== EXPORTS ==================

module.exports = {
  getDailyCloseReport,
  getReportByDateRange,
  getPaymentsByDateRange,
  getReportByDateRangePDF,
  exportSalesReportExcel,
  voidSale,
  getTodayPaymentSummary,
  printCierreZ,
  getTodayDashboardStats,
  getTopSellingProducts,
  registerCashWithdrawal,
  registerCashOpening,
  getTodayCashOpening,
  registerCashAdvance,
  printInventoryPdf,
  printFiadosPdf,
  getCierreZHistory,
  printCierreZById,
  searchSales,
  getDailyRestockList
};
