// controllers/client.controller.js
const { db } = require('../src/database');
// Importamos el recalculador de ventas (única fuente de verdad)
const { recalcSalePendingAndStatus } = require('./sales.controller');

// ======== STATEMENTS Y HELPERS DE BD ========

// Tasa BCV
const getRatesStmt = db.prepare(`
  SELECT key, value
  FROM settings
  WHERE key = 'BCV'
`);

// Clientes
const listClientsStmt = db.prepare(`
  SELECT id, nombre, cedula, telefono, direccion, activo
  FROM clientes
  WHERE activo = 1
    AND (nombre LIKE @term OR cedula LIKE @term)
  ORDER BY nombre ASC
`);

const listClientsWithDebtsStmt = db.prepare(`
  SELECT 
    c.id, 
    c.nombre, 
    c.cedula, 
    c.telefono, 
    c.direccion, 
    c.activo,
    COALESCE(SUM(v.monto_pendiente_usd), 0) AS deuda_total_usd
  FROM clientes c
  LEFT JOIN ventas v ON c.id = v.cliente_id AND v.archivado = 0 AND v.estado_pago != 'ANULADO'
  WHERE c.activo = 1
    AND (c.nombre LIKE @term OR c.cedula LIKE @term)
  GROUP BY c.id, c.nombre, c.cedula, c.telefono, c.direccion, c.activo
  ORDER BY c.nombre ASC
`);


const getClientByIdStmt = db.prepare(`
  SELECT id, nombre, cedula, telefono, direccion, activo
  FROM clientes
  WHERE id = ?
`);

const insertClientStmt = db.prepare(`
  INSERT INTO clientes (nombre, cedula, telefono, direccion, activo)
  VALUES (@nombre, @cedula, @telefono, @direccion, 1)
`);

const updateClientStmt = db.prepare(`
  UPDATE clientes
  SET nombre = @nombre,
      cedula = @cedula,
      telefono = @telefono,
      direccion = @direccion
  WHERE id = @id
`);

const softDeleteClientStmt = db.prepare(`
  UPDATE clientes
  SET activo = 0
  WHERE id = ?
`);

// 🔴 NUEVO: Ventas en ciclo de deuda (FIADO/ABONADO o PAGADO no archivado)
const getClientOpenSalesStmt = db.prepare(`
  SELECT
    id,
    cliente_id,
    creado_en,
    total_usd_bcv,
    monto_pendiente_usd,
    estado_pago,
    nota
  FROM ventas
  WHERE cliente_id = ?
    AND archivado = 0
    AND estado_pago != 'ANULADO'
  ORDER BY creado_en ASC
`);

// Productos por venta (para mensaje WhatsApp)
const getProductsByVentaStmt = db.prepare(`
  SELECT
    COALESCE(p.nombre, 'Producto') AS nombre,
    vp.cantidad,
    vp.precio_unitario_ves,
    CASE
      WHEN v.total_usd_bcv > 0 AND v.total_ves > 0
      THEN v.total_ves / v.total_usd_bcv
      ELSE 0
    END AS tasa_venta
  FROM venta_productos vp
  LEFT JOIN productos p ON vp.producto_id = p.id
  JOIN ventas v ON v.id = vp.venta_id
  WHERE vp.venta_id = ?
  ORDER BY p.nombre COLLATE NOCASE ASC
`);

// Abonos
const insertAbonoStmt = db.prepare(`
  INSERT INTO abonos (
    cliente_id,
    venta_id,
    monto_pagado_ves,
    monto_pagado_usd,
    tasa_bcv_momento,
    metodo
  )
  VALUES (
    @cliente_id,
    @venta_id,
    @monto_pagado_ves,
    @monto_pagado_usd,
    @tasa_bcv_momento,
    @metodo
  )
`);

const getAbonoByIdStmt = db.prepare(`
  SELECT *
  FROM abonos
  WHERE id = ?
`);

const deleteAbonoStmt = db.prepare(`
  DELETE FROM abonos
  WHERE id = ?
`);

const updateSaleStatusStmt = db.prepare(`
  UPDATE ventas
  SET estado_pago = ?, monto_pendiente_usd = ?, total_usd_bcv = ?
  WHERE id = ?
`);

const archiveClientSalesStmt = db.prepare(`
  UPDATE ventas
  SET archivado = 1
  WHERE cliente_id = ?
    AND archivado = 0
`);

const unarchiveSaleStmt = db.prepare(`
  UPDATE ventas
  SET archivado = 0
  WHERE id = ?
`);

// ======== HELPERS ========

function getBcvRate() {
  const rows = getRatesStmt.all();
  if (!rows.length) return 1;
  const row = rows[0];
  const bcv = parseFloat(row.value);
  return Number.isFinite(bcv) && bcv > 0 ? bcv : 1;
}

/**
 * Verifica si el cliente ya no tiene deuda en su ciclo actual (archivado=0).
 * Si la deuda total es 0, archiva todas esas ventas para que no aparezcan más.
 */
function checkAndArchiveClientDebts(clientId) {
  const openSales = getClientOpenSalesStmt.all(clientId);
  let totalPendiente = 0;

  for (const s of openSales) {
    const updated = recalcSalePendingAndStatus(s.id);
    totalPendiente += (updated ? (Number(updated.monto_pendiente_usd) || 0) : 0);
  }

  // Si la deuda es prácticamente cero (tolerancia 0.01 USD)
  if (totalPendiente < 0.01) {
    archiveClientSalesStmt.run(clientId);
    return true;
  }
  return false;
}

// ======== CONTROLADORES ========

// GET /api/clients?search=
function getClients(req, res) {
  try {
    const search = (req.query.search || '').trim();
    const term = `%${search}%`;
    const bcv = getBcvRate();

    const clients = listClientsWithDebtsStmt.all({ term });

    const responseClients = clients.map((c) => {
      const totalUsd = Number(c.deuda_total_usd) || 0;
      const totalVes = totalUsd * bcv;

      return {
        id: c.id,
        nombre: c.nombre,
        cedula: c.cedula,
        telefono: c.telefono,
        direccion: c.direccion,
        deuda_total_usd: Number(totalUsd.toFixed(2)),
        deuda_total_ves: Number(totalVes.toFixed(2)),
      };
    });

    res.json(responseClients);
  } catch (error) {
    console.error('Error getClients:', error);
    res.status(500).json({ error: 'Error interno al obtener clientes.' });
  }
}

// GET /api/clients/:id/debts
function getClientDebts(req, res) {
  try {
    const clientId = parseInt(req.params.id, 10);
    if (!clientId) {
      return res.status(400).json({ error: 'ID de cliente inválido.' });
    }

    const cliente = getClientByIdStmt.get(clientId);
    if (!cliente || cliente.activo === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }

    const bcv = getBcvRate();
    const sales = getClientOpenSalesStmt.all(clientId);

    const deudas = sales.map((row) => {
      const deudaOriginalUsd = Number(row.total_usd_bcv) || 0;
      const pendienteUsd = Number(row.monto_pendiente_usd) || 0;
      const pendienteVes = pendienteUsd * bcv;

      return {
        id: row.id,
        creado_en: row.creado_en,
        deuda_original_usd: Number(deudaOriginalUsd.toFixed(2)),
        monto_pendiente_usd: Number(pendienteUsd.toFixed(2)),
        monto_pendiente_ves: Number(pendienteVes.toFixed(2)),
      };
    });

    res.json({
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre,
        cedula: cliente.cedula,
        telefono: cliente.telefono,
        direccion: cliente.direccion,
      },
      deudas,
    });
  } catch (error) {
    console.error('Error getClientDebts:', error);
    res.status(500).json({ error: 'Error interno al obtener deudas del cliente.' });
  }
}

// GET /api/clients/:id/debts-with-products
function getClientDebtsWithProducts(req, res) {
  try {
    const clientId = parseInt(req.params.id, 10);
    if (!clientId) {
      return res.status(400).json({ error: 'ID de cliente inválido.' });
    }

    const cliente = getClientByIdStmt.get(clientId);
    if (!cliente || cliente.activo === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }

    const bcv = getBcvRate();
    const sales = getClientOpenSalesStmt.all(clientId);

    const deudas = sales.map((row) => {
      const pendienteUsd = Number(row.monto_pendiente_usd) || 0;
      const pendienteVes = pendienteUsd * bcv;

      const productos = getProductsByVentaStmt.all(row.id);

      return {
        id: row.id,
        creado_en: row.creado_en,
        monto_pendiente_usd: Number(pendienteUsd.toFixed(2)),
        monto_pendiente_ves: Number(pendienteVes.toFixed(2)),
        productos,
        nota: row.nota
      };
    }).filter(Boolean);

    res.json({
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre,
        cedula: cliente.cedula,
        telefono: cliente.telefono,
      },
      deudas,
      bcv: Number(bcv.toFixed(2))
    });
  } catch (error) {
    console.error('Error getClientDebtsWithProducts:', error);
    res.status(500).json({ error: 'Error interno al obtener deudas con productos.' });
  }
}

// POST /api/clients
function createClient(req, res) {
  try {
    const { nombre, cedula = null, telefono = null, direccion = null } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
    }

    const info = insertClientStmt.run({
      nombre: nombre.trim(),
      cedula: cedula ? cedula.trim() : null,
      telefono: telefono ? telefono.trim() : null,
      direccion: direccion ? direccion.trim() : null,
    });

    res.status(201).json({ message: 'Cliente creado con éxito.', id: info.lastInsertRowid });
  } catch (error) {
    console.error('Error createClient:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe un cliente con esa cédula.' });
    }
    res.status(500).json({ error: 'Error interno al crear cliente.' });
  }
}

// PUT /api/clients/:id
function updateClient(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ error: 'ID de cliente inválido.' });
    }

    const { nombre, cedula = null, telefono = null, direccion = null } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
    }

    const existing = getClientByIdStmt.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }

    const info = updateClientStmt.run({
      id,
      nombre: nombre.trim(),
      cedula: cedula ? cedula.trim() : null,
      telefono: telefono ? telefono.trim() : null,
      direccion: direccion ? direccion.trim() : null,
    });

    if (info.changes === 0) {
      return res.status(400).json({ error: 'No se realizaron cambios en el cliente.' });
    }

    res.json({ message: 'Cliente actualizado con éxito.' });
  } catch (error) {
    console.error('Error updateClient:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ya existe un cliente con esa cédula.' });
    }
    res.status(500).json({ error: 'Error interno al actualizar cliente.' });
  }
}

// DELETE /api/clients/:id  (Soft delete)
function deleteClient(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ error: 'ID de cliente inválido.' });
    }

    const existing = getClientByIdStmt.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }

    const info = softDeleteClientStmt.run(id);
    if (info.changes === 0) {
      return res.status(400).json({ error: 'No se pudo eliminar el cliente.' });
    }

    res.json({ message: 'Cliente eliminado (inactivado) con éxito.' });
  } catch (error) {
    console.error('Error deleteClient:', error);
    res.status(500).json({ error: 'Error interno al eliminar cliente.' });
  }
}

// POST /api/clients/payment
// body: { cliente_id, venta_id, monto, metodo, tasa_usd }
function registerPayment(req, res) {
  try {
    const { cliente_id, venta_id, monto, metodo, tasa_usd } = req.body;

    const clienteId = parseInt(cliente_id, 10);
    const ventaId = parseInt(venta_id, 10);
    let amount = parseFloat(monto);
    let tasa = parseFloat(tasa_usd);

    if (!clienteId || !ventaId) {
      return res.status(400).json({ error: 'cliente_id y venta_id son obligatorios.' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
    }
    if (!metodo) {
      return res.status(400).json({ error: 'El método de pago es obligatorio.' });
    }

    if (!tasa || tasa <= 0) {
      tasa = getBcvRate();
    }

    const ventaRow = db.prepare(`
      SELECT id, cliente_id, total_usd_bcv
      FROM ventas
      WHERE id = ?
    `).get(ventaId);

    if (!ventaRow) {
      return res.status(404).json({ error: 'Venta no encontrada.' });
    }
    if (ventaRow.cliente_id !== clienteId) {
      return res.status(400).json({ error: 'La venta no pertenece a ese cliente.' });
    }

    const methodsEnBs = ['VES_EFECTIVO', 'PUNTO_VENTA', 'BIOPAGO', 'PAGOMOVIL', 'TARJETA'];
    let montoPagadoUsd = 0;
    let montoPagadoVes = 0;

    if (metodo === 'USD_EFECTIVO') {
      montoPagadoUsd = amount;
      montoPagadoVes = amount * tasa;
    } else if (methodsEnBs.includes(metodo)) {
      montoPagadoVes = amount;
      montoPagadoUsd = amount / tasa;
    } else {
      return res.status(400).json({ error: 'Método de pago inválido.' });
    }

    const tx = db.transaction(() => {
      // Insertar abono
      insertAbonoStmt.run({
        cliente_id: clienteId,
        venta_id: ventaId,
        monto_pagado_ves: montoPagadoVes,
        monto_pagado_usd: montoPagadoUsd,
        tasa_bcv_momento: tasa,
        metodo,
      });

      // Recalcular venta usando la misma lógica que detalles_venta
      const updatedSale = recalcSalePendingAndStatus(ventaId);
      if (!updatedSale) {
        throw new Error('No se pudo recalcular la deuda de la venta.');
      }

      // 🔴 FORCE SETTLE: Si el frontend determina que esto cierra la venta, forzamos el cierre
      if (req.body.force_settle) {
        const totalUsd = Number(ventaRow.total_usd_bcv) || 0;
        updateSaleStatusStmt.run('PAGADO', 0, totalUsd, ventaId);
        updatedSale.estado_pago = 'PAGADO';
        updatedSale.monto_pendiente_usd = 0;
      }

      return updatedSale;
    });

    const updatedSale = tx();

    // Verificar si se cierra el ciclo de deuda del cliente
    checkAndArchiveClientDebts(clienteId);

    const pendienteUsd = Number(updatedSale.monto_pendiente_usd) || 0;
    const bcv = getBcvRate();
    const pendienteVes = pendienteUsd * bcv;

    res.json({
      success: true,
      venta_id: ventaId,
      pendiente_usd: Number(pendienteUsd.toFixed(4)),
      pendiente_ves: Number(pendienteVes.toFixed(2)),
    });
  } catch (error) {
    console.error('Error registerPayment:', error);
    res.status(500).json({ error: 'Error interno al registrar el abono.' });
  }
}

// POST /api/clients/payment/bulk
// body: { cliente_id, monto, metodo, tasa_usd }
// Distribuye el pago automáticamente a las deudas más antiguas
function bulkRegisterPayment(req, res) {
  try {
    const { cliente_id, monto, metodo, tasa_usd } = req.body;

    const clienteId = parseInt(cliente_id, 10);
    let amountTotal = parseFloat(monto); // Monto total a abonar por el usuario
    let tasa = parseFloat(tasa_usd);

    if (!clienteId) {
      return res.status(400).json({ error: 'cliente_id es obligatorio.' });
    }
    if (!amountTotal || amountTotal <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
    }
    if (!metodo) {
      return res.status(400).json({ error: 'El método de pago es obligatorio.' });
    }

    if (!tasa || tasa <= 0) {
      tasa = getBcvRate();
    }

    // 1. Calcular cuánto es el abono total en USD (moneda base del sistema)
    const methodsEnBs = ['VES_EFECTIVO', 'PUNTO_VENTA', 'BIOPAGO', 'PAGOMOVIL', 'TARJETA'];
    let abonoDisponibleUsd = 0;

    if (metodo === 'USD_EFECTIVO') {
      abonoDisponibleUsd = amountTotal;
    } else if (methodsEnBs.includes(metodo)) {
      abonoDisponibleUsd = amountTotal / tasa;
    } else {
      return res.status(400).json({ error: 'Método de pago inválido.' });
    }

    // Redondeamos a 4 decimales para cálculos internos
    abonoDisponibleUsd = Math.round(abonoDisponibleUsd * 10000) / 10000;

    const tx = db.transaction(() => {
      // 2. Obtener todas las ventas pendientes del cliente (FIFO)
      // Reutilizamos la query pero asegurando orden por fecha
      const sales = getClientOpenSalesStmt.all(clienteId);

      const pagosRealizados = [];
      let remanenteUsd = abonoDisponibleUsd;

      for (const sale of sales) {
        if (remanenteUsd <= 0.0001) break; // Se acabó el dinero

        // Recalcular deuda actual real de esta venta
        const updatedSale = recalcSalePendingAndStatus(sale.id);
        if (!updatedSale) continue;

        let pendienteUsd = Number(updatedSale.monto_pendiente_usd) || 0;

        if (pendienteUsd <= 0.0001) continue; // Venta ya pagada, saltar

        // Determinar cuánto vamos a pagar a esta venta
        let pagoParaEstaVentaUsd = 0;
        if (remanenteUsd >= pendienteUsd) {
          // Alcanza para pagar toda esta venta
          pagoParaEstaVentaUsd = pendienteUsd;
        } else {
          // Solo alcanza para una parte
          pagoParaEstaVentaUsd = remanenteUsd;
        }

        // Calcular equivalentes para el registro
        let montoPagadoVes = 0;
        let montoPagadoUsd = 0;

        if (metodo === 'USD_EFECTIVO') {
          montoPagadoUsd = pagoParaEstaVentaUsd;
          montoPagadoVes = pagoParaEstaVentaUsd * tasa;
        } else {
          montoPagadoUsd = pagoParaEstaVentaUsd;
          montoPagadoVes = pagoParaEstaVentaUsd * tasa;
        }

        // Insertar abono para esta venta específica
        insertAbonoStmt.run({
          cliente_id: clienteId,
          venta_id: sale.id,
          monto_pagado_ves: montoPagadoVes,
          monto_pagado_usd: montoPagadoUsd,
          tasa_bcv_momento: tasa,
          metodo: metodo,
        });

        // Actualizar estado de la venta
        recalcSalePendingAndStatus(sale.id);

        pagosRealizados.push({
          venta_id: sale.id,
          monto_usd: montoPagadoUsd,
          monto_ves: montoPagadoVes
        });

        // Restar del disponible
        remanenteUsd -= pagoParaEstaVentaUsd;
      }

      return { pagosRealizados, remanenteUsd };
    });

    const result = tx();

    // Verificar si se cierra el ciclo de deuda del cliente
    checkAndArchiveClientDebts(clienteId);

    res.json({
      success: true,
      message: `Abono distribuido en ${result.pagosRealizados.length} ventas.${result.remanenteUsd > 0.01 ? ' Quedó un saldo a favor no procesado.' : ''}`,
      details: result
    });

  } catch (error) {
    console.error('Error bulkRegisterPayment:', error);
    res.status(500).json({ error: 'Error interno al registrar el abono masivo.' });
  }
}

// POST /api/clients/payment/:id/void
// body opcional: { motivo }
function voidPayment(req, res) {
  try {
    const abonoId = parseInt(req.params.id, 10);
    const { motivo = null } = req.body || {};

    if (!abonoId) {
      return res.status(400).json({ error: 'ID de abono inválido.' });
    }

    const abono = getAbonoByIdStmt.get(abonoId);
    if (!abono) {
      return res.status(404).json({ error: 'Abono no encontrado.' });
    }
    if (!abono.venta_id) {
      return res.status(400).json({ error: 'El abono no está asociado a una venta.' });
    }

    const ventaId = abono.venta_id;

    const tx = db.transaction(() => {
      // Eliminar abono
      deleteAbonoStmt.run(abonoId);

      // Des-archivar la venta para que vuelva a aparecer
      unarchiveSaleStmt.run(ventaId);

      // Recalcular venta con abonos restantes y pagos iniciales
      const updatedSale = recalcSalePendingAndStatus(ventaId);
      if (!updatedSale) {
        throw new Error('No se pudo recalcular la deuda de la venta.');
      }
      return updatedSale;
    });

    const updatedSale = tx();
    const pendienteUsd = Number(updatedSale.monto_pendiente_usd) || 0;
    const deudaOriginalUsd = Number(updatedSale.total_usd_bcv) || 0;
    const bcv = getBcvRate();
    const pendienteVes = pendienteUsd * bcv;

    res.json({
      success: true,
      venta_id: ventaId,
      pendiente_usd: Number(pendienteUsd.toFixed(2)),
      pendiente_ves: Number(pendienteVes.toFixed(2)),
      deuda_original_usd: Number(deudaOriginalUsd.toFixed(2)),
      message: motivo || 'Abono anulado y eliminado correctamente.',
    });
  } catch (error) {
    console.error('Error voidPayment:', error);
    res.status(500).json({ error: 'Error interno al anular el abono.' });
  }
}

module.exports = {
  getClients,
  getClientDebts,
  getClientDebtsWithProducts,
  createClient,
  updateClient,
  deleteClient,
  registerPayment,
  bulkRegisterPayment,
  voidPayment,
};
