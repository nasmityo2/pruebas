// controllers/admin.controller.js
// Gestión de usuarios internos (roles) y consulta de auditoría (Fase 4).
const audit = require('../src/utils/audit');
const { ensureUnlocked, operatorFromReq } = require('../src/utils/adminUnlock');

const getUsers = (req, res) => {
  try {
    res.json({ success: true, users: audit.listUsers(), roles: audit.ROLES });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const createUser = (req, res) => {
  if (!ensureUnlocked(req, res)) return;
  const { nombre, rol } = req.body || {};
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const user = audit.createUser(nombre, rol || 'cajero');
    audit.logAction({ usuario: operatorFromReq(req), rol: 'admin', accion: 'USER_CREATE', entidad: 'usuario', entidadId: user.id, detalle: { nombre, rol: user.rol }, ip: req.ip });
    res.json({ success: true, user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

const updateUser = (req, res) => {
  if (!ensureUnlocked(req, res)) return;
  try {
    const user = audit.updateUser(parseInt(req.params.id, 10), { rol: req.body.rol, activo: req.body.activo });
    audit.logAction({ usuario: operatorFromReq(req), rol: 'admin', accion: 'USER_UPDATE', entidad: 'usuario', entidadId: req.params.id, detalle: { rol: user.rol, activo: user.activo }, ip: req.ip });
    res.json({ success: true, user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

const deleteUser = (req, res) => {
  if (!ensureUnlocked(req, res)) return;
  try {
    audit.deleteUser(parseInt(req.params.id, 10));
    audit.logAction({ usuario: operatorFromReq(req), rol: 'admin', accion: 'USER_DELETE', entidad: 'usuario', entidadId: req.params.id, ip: req.ip });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

const getAudit = (req, res) => {
  if (!ensureUnlocked(req, res)) return;
  try {
    const { page, limit, accion, usuario } = req.query || {};
    res.json({ success: true, ...audit.listAudit({ page, limit, accion, usuario }) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

module.exports = { getUsers, createUser, updateUser, deleteUser, getAudit };
