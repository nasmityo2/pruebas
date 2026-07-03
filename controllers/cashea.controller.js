// controllers/cashea.controller.js
const { db } = require('../src/database');

// Registrar una nueva venta Cashea
const createCasheaVenta = (req, res) => {
  const { venta_id, cliente_id, referencia, monto_total_usd, porcentaje_inicial, monto_inicial_usd, linea, cuotas } = req.body;
  console.log(`[CASHEA] Creando registro para venta_id: ${venta_id}, ref: ${referencia}`);

  // B.D / A.4: validar entradas y que las cuotas sean coherentes antes de insertar.
  if (!venta_id || !cliente_id) {
    return res.status(400).json({ error: 'venta_id y cliente_id son obligatorios.' });
  }
  if (!Array.isArray(cuotas) || cuotas.length === 0) {
    return res.status(400).json({ error: 'Se requiere al menos una cuota.' });
  }
  for (const c of cuotas) {
    if (c == null || c.numero == null || isNaN(parseFloat(c.monto_usd)) || !c.fecha_vencimiento) {
      return res.status(400).json({ error: 'Cada cuota requiere numero, monto_usd y fecha_vencimiento válidos.' });
    }
  }
  const totalCuotas = cuotas.reduce((s, c) => s + parseFloat(c.monto_usd), 0);
  const esperado = (parseFloat(monto_total_usd) || 0) - (parseFloat(monto_inicial_usd) || 0);
  // Tolerancia de 1 centavo por redondeos.
  if (Math.abs(totalCuotas - esperado) > 0.01) {
    return res.status(400).json({
      error: `Las cuotas ($${totalCuotas.toFixed(2)}) no suman el saldo financiado esperado ($${esperado.toFixed(2)}).`,
    });
  }

  try {
    // Evitar duplicar el registro Cashea de una misma venta.
    const yaExiste = db.prepare('SELECT 1 FROM cashea_ventas WHERE venta_id = ?').get(venta_id);
    if (yaExiste) {
      return res.status(409).json({ error: 'Esta venta ya tiene un registro Cashea.' });
    }

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
    // B.D / A.4: validar existencia y ejecutar en una transacción (pago de cuota + posible
    // cierre de la venta Cashea son atómicos).
    const cuota = db.prepare('SELECT id, cashea_venta_id, estado FROM cashea_cuotas WHERE id = ?').get(cuota_id);
    if (!cuota) {
      return res.status(404).json({ error: 'Cuota no encontrada.' });
    }
    if (cuota.estado === 'PAGADO') {
      return res.status(400).json({ error: 'La cuota ya está pagada.' });
    }

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE cashea_cuotas
        SET estado = 'PAGADO', fecha_pago = datetime('now', 'localtime')
        WHERE id = ?
      `).run(cuota_id);

      const pendientes = db.prepare("SELECT COUNT(*) as count FROM cashea_cuotas WHERE cashea_venta_id = ? AND estado = 'PENDIENTE'").get(cuota.cashea_venta_id);
      if (pendientes.count === 0) {
        db.prepare("UPDATE cashea_ventas SET estado = 'COMPLETADO' WHERE id = ?").run(cuota.cashea_venta_id);
      }
    });
    tx();

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
