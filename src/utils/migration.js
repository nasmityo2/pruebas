const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getLegacyDataPaths, getStokkoDataPath } = require('./dataPaths');

const MARKER_NAME = '.stokko-migration.json';
const LOCK_NAME = '.stokko-migration.lock';
const LOCK_STALE_MS = 10 * 60 * 1000;

function timestamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

function listFiles(root) {
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        throw new Error(`La migración no admite enlaces simbólicos: ${entry.name}`);
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(path.relative(root, absolute).replace(/\\/g, '/'));
    }
  }
  walk(root);
  return files.sort();
}

function treeDigest(root, excluded = []) {
  const excludedSet = new Set(excluded);
  const hash = crypto.createHash('sha256');
  for (const relative of listFiles(root)) {
    if (excludedSet.has(relative)) continue;
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, relative)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function copyTree(source, destination, overwrite = true) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error(`La migración no admite enlaces simbólicos: ${entry.name}`);
    }
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to, overwrite);
    } else if (entry.isFile() && (overwrite || !fs.existsSync(to))) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

function assertSourceHealthy(source) {
  const databasePath = path.join(source, 'mi-tienda.db');
  if (!fs.existsSync(databasePath)) return;
  const descriptor = fs.openSync(databasePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const bytes = fs.readSync(descriptor, header, 0, header.length, 0);
    if (bytes !== 16 || header.toString('utf8') !== 'SQLite format 3\0') {
      throw new Error(`Base de datos legacy inválida en ${source}.`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function acquireLock(lockPath, nowMs = Date.now()) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const descriptor = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: new Date(nowMs).toISOString() }));
    fs.closeSync(descriptor);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const age = nowMs - fs.statSync(lockPath).mtimeMs;
    if (age <= LOCK_STALE_MS) throw new Error('Ya hay una migración Stokko en ejecución.');
    fs.rmSync(lockPath, { force: true });
    return acquireLock(lockPath, nowMs);
  }
  return () => fs.rmSync(lockPath, { force: true });
}

function readMarker(targetPath) {
  const markerPath = path.join(targetPath, MARKER_NAME);
  if (!fs.existsSync(markerPath)) return null;
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  return marker && marker.status === 'complete' ? marker : null;
}

function migrateToStokko(options = {}) {
  const targetPath = path.resolve(options.targetPath || getStokkoDataPath());
  const sourceCandidates = options.sourcePaths || getLegacyDataPaths();
  const sources = sourceCandidates
    .map((item) => path.resolve(item))
    .filter((item, index, all) => all.indexOf(item) === index)
    .filter((item) => fs.existsSync(item) && fs.statSync(item).isDirectory());
  const lockPath = options.lockPath || path.join(path.dirname(targetPath), LOCK_NAME);
  const releaseLock = acquireLock(lockPath, options.nowMs || Date.now());

  try {
    const existingMarker = readMarker(targetPath);
    if (existingMarker) return { status: 'already-migrated', marker: existingMarker };
    if (sources.length === 0) return { status: 'source-absent' };

    for (const source of sources) assertSourceHealthy(source);

    const stamp = timestamp(options.now ? new Date(options.now) : new Date());
    const backupRoot = path.resolve(
      options.backupRoot || path.join(path.dirname(targetPath), 'Stokko_Migration_Backups'),
    );
    fs.mkdirSync(backupRoot, { recursive: true });
    const backups = [];

    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const backupPath = path.join(backupRoot, `${stamp}-${index + 1}`);
      copyTree(source, backupPath, true);
      const sourceDigest = treeDigest(source);
      const backupDigest = treeDigest(backupPath);
      if (sourceDigest !== backupDigest) {
        throw new Error(`El checksum del backup no coincide para ${source}.`);
      }
      backups.push({ source, backupPath, sha256: backupDigest });
    }

    const stagePath = `${targetPath}.migrating-${process.pid}-${Date.now()}`;
    fs.rmSync(stagePath, { recursive: true, force: true });
    if (fs.existsSync(targetPath)) copyTree(targetPath, stagePath, true);

    // ProgramData se fusiona primero; el perfil AppData (primer candidato) prevalece.
    for (const source of [...sources].reverse()) copyTree(source, stagePath, true);

    const preexistingTarget = fs.existsSync(targetPath);
    const rollbackPath = preexistingTarget ? `${targetPath}.rollback-${stamp}` : null;
    const marker = {
      version: 1,
      status: 'complete',
      completedAt: new Date().toISOString(),
      sources,
      backups,
      rollbackPath,
      targetDigest: null,
    };
    fs.mkdirSync(stagePath, { recursive: true });
    fs.writeFileSync(path.join(stagePath, MARKER_NAME), JSON.stringify(marker, null, 2));
    marker.targetDigest = treeDigest(stagePath, [MARKER_NAME]);
    fs.writeFileSync(path.join(stagePath, MARKER_NAME), JSON.stringify(marker, null, 2));

    if (rollbackPath) {
      fs.rmSync(rollbackPath, { recursive: true, force: true });
      fs.renameSync(targetPath, rollbackPath);
    }
    try {
      fs.renameSync(stagePath, targetPath);
    } catch (error) {
      if (rollbackPath && fs.existsSync(rollbackPath) && !fs.existsSync(targetPath)) {
        fs.renameSync(rollbackPath, targetPath);
      }
      throw error;
    }

    return { status: 'migrated', marker: readMarker(targetPath) };
  } finally {
    releaseLock();
  }
}

function rollbackStokkoMigration(options = {}) {
  const targetPath = path.resolve(options.targetPath || getStokkoDataPath());
  const lockPath = options.lockPath || path.join(path.dirname(targetPath), LOCK_NAME);
  const releaseLock = acquireLock(lockPath, options.nowMs || Date.now());
  try {
    const marker = readMarker(targetPath);
    if (!marker) return { status: 'nothing-to-rollback' };
    const archivePath = `${targetPath}.rolled-back-${timestamp()}`;
    fs.renameSync(targetPath, archivePath);
    if (marker.rollbackPath && fs.existsSync(marker.rollbackPath)) {
      fs.renameSync(marker.rollbackPath, targetPath);
    }
    return { status: 'rolled-back', archivePath, restoredPath: marker.rollbackPath ? targetPath : null };
  } finally {
    releaseLock();
  }
}

module.exports = {
  MARKER_NAME,
  treeDigest,
  migrateToStokko,
  rollbackStokkoMigration,
};
