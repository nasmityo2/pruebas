// controllers/cashea.controller.js
const { db } = require('../src/database');

// Registrar una nueva venta Cashea
const createCasheaVenta = (req, res) => {
  const { venta_id, cliente_id, referencia, monto_total_usd, porcentaje_inicial, monto_inicial_usd, linea, cuotas } = req.body;
  console.log(`[CASHEA] Creando registro para venta_id: ${venta_id}, ref: ${referencia}`);

  try {
    const transaction = db.transaction(() => {
      // 1. Insertar en cashea_ventas
      const stmtVenta = db.prepare(`
        INSERT INTO cashea_ventas (venta_id, cliente_id, referencia, monto_total_usd, porcentaje_inicial, monto_inicial_usd, linea)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmtVenta.run(venta_id, cliente_id, referencia, monto_total_usd, porcentaje_inicial, monto_inicial_usd, linea || 'principal');
      const casheaVentaId = info.lastInsertRowid;

      // 2. Insertar las cuotas
      const stmtCuota = db.prepare(`
        INSERT INTO cashea_cuotas (cashea_venta_id, numero_cuota, monto_usd, fecha_vencimiento)
        VALUES (?, ?, ?, ?)
      `);

      for (const cuota of cuotas) {
        stmtCuota.run(casheaVentaId, cuota.numero, cuota.monto_usd, cuota.fecha_vencimiento);
      }

      return casheaVentaId;
    });

    const casheaVentaId = transaction();
    res.status(201).json({ ok: true, casheaVentaId });
  } catch (error) {
    console.error('Error al crear venta Cashea:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Obtener todas las ventas Cashea de un cliente
const getCasheaVentasByCliente = (req, res) => {
  const { cliente_id } = req.params;
  try {
    const stmt = db.prepare(`
      SELECT cv.*, v.total_ves, v.creado_en as fecha_venta
      FROM cashea_ventas cv
      JOIN ventas v ON cv.venta_id = v.id
      WHERE cv.cliente_id = ?
      ORDER BY cv.creado_en DESC
    `);
    const ventas = stmt.all(cliente_id);
    res.json(ventas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Obtener cuotas de una venta Cashea
const getCasheaCuotas = (req, res) => {
  const { cashea_venta_id } = req.params;
  try {
    const stmt = db.prepare(`SELECT * FROM cashea_cuotas WHERE cashea_venta_id = ? ORDER BY numero_cuota ASC`);
    const cuotas = stmt.all(cashea_venta_id);
    res.json(cuotas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Registrar pago de una cuota
const PagarCuota = (req, res) => {
  const { cuota_id } = req.params;
  try {
    const stmt = db.prepare(`
      UPDATE cashea_cuotas
      SET estado = 'PAGADO', fecha_pago = datetime('now', 'localtime')
      WHERE id = ?
    `);
    stmt.run(cuota_id);

    // Verificar si todas las cuotas están pagadas para marcar la venta como COMPLETADA
    const cuota = db.prepare('SELECT cashea_venta_id FROM cashea_cuotas WHERE id = ?').get(cuota_id);
    const pendientes = db.prepare("SELECT COUNT(*) as count FROM cashea_cuotas WHERE cashea_venta_id = ? AND estado = 'PENDIENTE'").get(cuota.cashea_venta_id);

    if (pendientes.count === 0) {
      db.prepare("UPDATE cashea_ventas SET estado = 'COMPLETADO' WHERE id = ?").run(cuota.cashea_venta_id);
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Obtener cuotas próximas a vencer (Alertas)
const getProximasCuotas = (req, res) => {
  try {
    // Cuotas que vencen hoy o mañana
    const stmt = db.prepare(`
      SELECT cc.*, cv.referencia, cl.nombre as cliente_nombre, cl.telefono as cliente_telefono
      FROM cashea_cuotas cc
      JOIN cashea_ventas cv ON cc.cashea_venta_id = cv.id
      JOIN clientes cl ON cv.cliente_id = cl.id
      WHERE cc.estado = 'PENDIENTE'
        AND (
          date(cc.fecha_vencimiento) = date('now', 'localtime')
          OR date(cc.fecha_vencimiento) = date('now', 'localtime', '+1 day')
        )
      ORDER BY cc.fecha_vencimiento ASC
    `);
    const cuotas = stmt.all();
    res.json(cuotas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Obtener ventas Cashea pendientes de conciliación (que el negocio reciba el dinero)
const getCasheaPendientesConciliacion = (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT cv.*, v.total_ves, cl.nombre as cliente_nombre
      FROM cashea_ventas cv
      JOIN ventas v ON cv.venta_id = v.id
      JOIN clientes cl ON cv.cliente_id = cl.id
      WHERE cv.reconciliado = 0
      ORDER BY cv.creado_en DESC
    `);
    const ventas = stmt.all();
    console.log(`[CASHEA] Pendientes encontrados: ${ventas.length}`);
    res.json(ventas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Marcar venta Cashea como reconciliada (dinero recibido por el negocio)
const reconciliarVentaCashea = (req, res) => {
  const { id } = req.params;
  try {
    const stmt = db.prepare(`
      UPDATE cashea_ventas
      SET reconciliado = 1, fecha_reconciliacion = datetime('now', 'localtime')
      WHERE id = ?
    `);
    stmt.run(id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createCasheaVenta,
  getCasheaVentasByCliente,
  getCasheaCuotas,
  PagarCuota,
  getProximasCuotas,
  getCasheaPendientesConciliacion,
  reconciliarVentaCashea
};
