// controllers/rapikom.controller.js
const { db } = require('../src/database');

const createRapikomVenta = (req, res) => {
  const { venta_id, cliente_id, referencia, monto_total_usd, monto_inicial_usd, surcharge_usd } = req.body;
  console.log(`[RAPIKOM] Creando registro para venta_id: ${venta_id}, ref: ${referencia}`);

  try {
    const stmt = db.prepare(`
      INSERT INTO rapikom_ventas (venta_id, cliente_id, referencia, monto_total_usd, monto_inicial_usd, surcharge_usd)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(venta_id, cliente_id, referencia, monto_total_usd, monto_inicial_usd, surcharge_usd);
    res.status(201).json({ ok: true, rapikomVentaId: info.lastInsertRowid });
  } catch (error) {
    console.error('Error al crear venta Rapikom:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

const getRapikomPendientes = (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT rv.*, v.total_ves, cl.nombre as cliente_nombre
      FROM rapikom_ventas rv
      JOIN ventas v ON rv.venta_id = v.id
      JOIN clientes cl ON rv.cliente_id = cl.id
      WHERE rv.reconciliado = 0
      ORDER BY rv.creado_en DESC
    `);
    const ventas = stmt.all();
    res.json(ventas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const reconciliarVentaRapikom = (req, res) => {
  const { id } = req.params;
  try {
    const stmt = db.prepare(`
      UPDATE rapikom_ventas
      SET reconciliado = 1, estado = 'COMPLETADO', fecha_reconciliacion = datetime('now', 'localtime')
      WHERE id = ?
    `);
    stmt.run(id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createRapikomVenta,
  getRapikomPendientes,
  reconciliarVentaRapikom
};
