const { db } = require('../src/database');

const getPaymentMethods = (req, res) => {
  try {
    const enableCasheaSetting = db.prepare("SELECT value FROM settings WHERE key = 'ENABLE_CASHEA'").get();
    const enableCashea = enableCasheaSetting && (enableCasheaSetting.value === 1 || enableCasheaSetting.value === '1' || enableCasheaSetting.value === 'true' || enableCasheaSetting.value === true);

    let methods;
    if (enableCashea) {
      methods = db.prepare('SELECT * FROM metodos_pago WHERE activo = 1 ORDER BY es_predeterminado DESC, id ASC').all();
    } else {
      methods = db.prepare("SELECT * FROM metodos_pago WHERE activo = 1 AND key != 'CASHEA' ORDER BY es_predeterminado DESC, id ASC").all();
    }
    res.json(methods);
  } catch (error) {
    console.error('Error getting payment methods:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createPaymentMethod = (req, res) => {
  const { nombre, moneda, tipo_tasa, tasa_valor, tasa_personalizada_key } = req.body;

  if (!nombre || !nombre.trim() || !moneda || !tipo_tasa) {
    return res.status(400).json({ error: 'Faltan campos obligatorios (nombre, moneda, tipo_tasa)' });
  }

  const cleanNombre = nombre.trim();
  const normalizedKey = 'CUSTOM_' + cleanNombre.toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9_]/g, '_');

  try {
    // Check if key already exists (active or inactive)
    const existing = db.prepare('SELECT id, activo FROM metodos_pago WHERE key = ?').get(normalizedKey);
    if (existing) {
      if (existing.activo === 1) {
        return res.status(409).json({ error: `Ya existe un método de pago con el nombre o clave '${cleanNombre}'.` });
      } else {
        // Reactivate and update it
        db.prepare(`
          UPDATE metodos_pago
          SET nombre = ?, moneda = ?, tipo_tasa = ?, tasa_valor = ?, tasa_personalizada_key = ?, activo = 1
          WHERE id = ?
        `).run(cleanNombre, moneda, tipo_tasa, tasa_valor || null, tasa_personalizada_key || null, existing.id);
        
        return res.status(200).json({ message: 'Método de pago reactivado con éxito.', key: normalizedKey });
      }
    }

    db.prepare(`
      INSERT INTO metodos_pago (key, nombre, moneda, tipo_tasa, tasa_valor, tasa_personalizada_key, es_predeterminado, activo)
      VALUES (?, ?, ?, ?, ?, ?, 0, 1)
    `).run(
      normalizedKey,
      cleanNombre,
      moneda,
      tipo_tasa,
      tasa_valor !== undefined ? parseFloat(tasa_valor) : null,
      tasa_personalizada_key || null
    );

    res.status(201).json({ message: 'Método de pago creado con éxito.', key: normalizedKey });
  } catch (error) {
    console.error('Error creating payment method:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deletePaymentMethod = (req, res) => {
  const { id } = req.params;

  try {
    const method = db.prepare('SELECT es_predeterminado FROM metodos_pago WHERE id = ?').get(id);
    if (!method) {
      return res.status(404).json({ error: 'Método de pago no encontrado.' });
    }

    if (method.es_predeterminado === 1) {
      return res.status(403).json({ error: 'No se pueden eliminar los métodos de pago predeterminados.' });
    }

    // Soft delete
    db.prepare('UPDATE metodos_pago SET activo = 0 WHERE id = ?').run(id);
    res.json({ message: 'Método de pago eliminado con éxito.' });
  } catch (error) {
    console.error('Error deleting payment method:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getPaymentMethods,
  createPaymentMethod,
  deletePaymentMethod
};
