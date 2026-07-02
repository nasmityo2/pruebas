const { db } = require('../src/database');

const getCustomRates = (req, res) => {
  try {
    const rates = db.prepare('SELECT * FROM tasas_personalizadas WHERE activo = 1 ORDER BY id ASC').all();
    res.json(rates);
  } catch (error) {
    console.error('Error getting custom rates:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createCustomRate = (req, res) => {
  const { nombre, valor } = req.body;

  if (!nombre || !nombre.trim() || valor === undefined || isNaN(parseFloat(valor))) {
    return res.status(400).json({ error: 'Faltan campos obligatorios (nombre, valor numérico)' });
  }

  const cleanNombre = nombre.trim();
  const normalizedKey = 'RATE_' + cleanNombre.toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9_]/g, '_');

  try {
    const existing = db.prepare('SELECT id, activo FROM tasas_personalizadas WHERE key = ?').get(normalizedKey);
    if (existing) {
      if (existing.activo === 1) {
        return res.status(409).json({ error: `Ya existe una tasa con el nombre o clave '${cleanNombre}'.` });
      } else {
        // Reactivate and update value
        db.prepare('UPDATE tasas_personalizadas SET nombre = ?, valor = ?, activo = 1 WHERE id = ?')
          .run(cleanNombre, parseFloat(valor), existing.id);
        return res.status(200).json({ message: 'Tasa reactivada con éxito.', key: normalizedKey });
      }
    }

    db.prepare('INSERT INTO tasas_personalizadas (key, nombre, valor, activo) VALUES (?, ?, ?, 1)')
      .run(normalizedKey, cleanNombre, parseFloat(valor));

    res.status(201).json({ message: 'Tasa creada con éxito.', key: normalizedKey });
  } catch (error) {
    console.error('Error creating custom rate:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteCustomRate = (req, res) => {
  const { id } = req.params;

  try {
    const rate = db.prepare('SELECT key FROM tasas_personalizadas WHERE id = ?').get(id);
    if (!rate) {
      return res.status(404).json({ error: 'Tasa no encontrada.' });
    }

    // Soft delete
    db.prepare('UPDATE tasas_personalizadas SET activo = 0 WHERE id = ?').run(id);

    // Also update any payment methods configured to use this custom rate
    db.prepare("UPDATE metodos_pago SET tipo_tasa = 'FIJA', tasa_valor = 1.0, tasa_personalizada_key = NULL WHERE tasa_personalizada_key = ?")
      .run(rate.key);

    res.json({ message: 'Tasa eliminada con éxito.' });
  } catch (error) {
    console.error('Error deleting custom rate:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getCustomRates,
  createCustomRate,
  deleteCustomRate
};
