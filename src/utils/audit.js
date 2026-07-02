// src/utils/audit.js
// Auditoría de acciones sensibles y usuarios internos con roles (Fase 4).
// Tablas creadas de forma idempotente. NUNCA se registran contraseñas ni secretos.
const { db } = require('../database');

const ROLES = ['cajero', 'supervisor', 'admin'];

function ensureTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      rol TEXT NOT NULL DEFAULT 'cajero' CHECK(rol IN ('cajero','supervisor','admin')),
      activo INTEGER NOT NULL DEFAULT 1,
      creado_en DATETIME DEFAULT (datetime('now','localtime'))
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT,
      rol TEXT,
      accion TEXT NOT NULL,
      entidad TEXT,
      entidad_id TEXT,
      detalle TEXT,
      ip TEXT,
      fecha DATETIME DEFAULT (datetime('now','localtime'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria(fecha);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auditoria_accion ON auditoria(accion);`);
}

// Registrar una acción sensible. detail se serializa a JSON (sin secretos).
function logAction({ usuario, rol, accion, entidad, entidadId, detalle, ip }) {
  try {
    const stmt = db.prepare(`
      INSERT INTO auditoria (usuario, rol, accion, entidad, entidad_id, detalle, ip)
      VALUES (@usuario, @rol, @accion, @entidad, @entidadId, @detalle, @ip)
    `);
    stmt.run({
      usuario: usuario || 'sistema',
      rol: rol || null,
      accion,
      entidad: entidad || null,
      entidadId: entidadId != null ? String(entidadId) : null,
      detalle: detalle != null ? (typeof detalle === 'string' ? detalle : JSON.stringify(detalle)) : null,
      ip: ip || null,
    });
  } catch (e) {
    console.error('[AUDIT] No se pudo registrar la acción:', e.message);
  }
}

function listAudit({ page = 1, limit = 50, accion = '', usuario = '' } = {}) {
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  const where = [];
  const params = {};
  if (accion) { where.push('accion = @accion'); params.accion = accion; }
  if (usuario) { where.push('usuario LIKE @usuario'); params.usuario = `%${usuario}%`; }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS n FROM auditoria ${whereSql}`).get(params).n;
  const rows = db.prepare(`
    SELECT * FROM auditoria ${whereSql}
    ORDER BY id DESC LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: l, offset: (p - 1) * l });

  return { rows, total, page: p, pages: Math.ceil(total / l), limit: l };
}

// ---- Usuarios internos ----
function listUsers() {
  return db.prepare('SELECT id, nombre, rol, activo, creado_en FROM usuarios ORDER BY nombre').all();
}
function createUser(nombre, rol) {
  if (!ROLES.includes(rol)) throw new Error('Rol inválido');
  const stmt = db.prepare('INSERT INTO usuarios (nombre, rol) VALUES (?, ?)');
  const info = stmt.run(String(nombre).trim(), rol);
  return { id: info.lastInsertRowid, nombre, rol };
}
function updateUser(id, { rol, activo }) {
  if (rol !== undefined && !ROLES.includes(rol)) throw new Error('Rol inválido');
  const current = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!current) throw new Error('Usuario no encontrado');
  db.prepare('UPDATE usuarios SET rol = ?, activo = ? WHERE id = ?')
    .run(rol !== undefined ? rol : current.rol, activo !== undefined ? (activo ? 1 : 0) : current.activo, id);
  return db.prepare('SELECT id, nombre, rol, activo FROM usuarios WHERE id = ?').get(id);
}
function deleteUser(id) {
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
}

module.exports = {
  ROLES,
  ensureTables,
  logAction,
  listAudit,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
};
