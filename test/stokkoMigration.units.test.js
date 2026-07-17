const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  MARKER_NAME,
  treeDigest,
  migrateToStokko,
  rollbackStokkoMigration,
} = require('../src/utils/migration');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stokko-migration-test-'));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeLegacyData(source) {
  writeFile(path.join(source, 'mi-tienda.db'), Buffer.concat([
    Buffer.from('SQLite format 3\0', 'utf8'),
    Buffer.alloc(128),
  ]));
  writeFile(path.join(source, 'business-settings.json'), JSON.stringify({
    businessName: 'Negocio migrado',
    licenseKey: 'TEST-ONLY-LICENSE',
  }));
  writeFile(path.join(source, 'uploads', 'logo.png'), 'image-fixture');
  writeFile(path.join(source, 'backups', 'backup.enc'), 'backup-fixture');
}

test('migración Stokko copia datos, verifica backup, es idempotente y revierte', () => {
  const root = tempRoot();
  const source = path.join(root, 'legacy');
  const target = path.join(root, 'Stokko_Data');
  const backupRoot = path.join(root, 'migration-backups');
  const lockPath = path.join(root, 'migration.lock');
  try {
    writeLegacyData(source);
    writeFile(path.join(target, 'startup_error.log'), 'preexisting-target');

    const first = migrateToStokko({
      sourcePaths: [source],
      targetPath: target,
      backupRoot,
      lockPath,
      now: '2026-07-17T12:00:00.000Z',
    });
    assert.strictEqual(first.status, 'migrated');
    assert.strictEqual(fs.existsSync(path.join(target, 'mi-tienda.db')), true);
    assert.strictEqual(fs.existsSync(path.join(target, 'uploads', 'logo.png')), true);
    assert.strictEqual(fs.existsSync(path.join(target, 'backups', 'backup.enc')), true);
    assert.strictEqual(fs.existsSync(path.join(target, 'startup_error.log')), true);
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(target, 'business-settings.json'), 'utf8')).licenseKey,
      'TEST-ONLY-LICENSE',
    );
    assert.strictEqual(fs.existsSync(path.join(target, MARKER_NAME)), true);
    assert.strictEqual(first.marker.backups.length, 1);
    assert.strictEqual(treeDigest(source), first.marker.backups[0].sha256);
    assert.strictEqual(treeDigest(first.marker.backups[0].backupPath), first.marker.backups[0].sha256);

    const second = migrateToStokko({ sourcePaths: [source], targetPath: target, backupRoot, lockPath });
    assert.strictEqual(second.status, 'already-migrated');

    const rollback = rollbackStokkoMigration({ targetPath: target, lockPath });
    assert.strictEqual(rollback.status, 'rolled-back');
    assert.strictEqual(fs.readFileSync(path.join(target, 'startup_error.log'), 'utf8'), 'preexisting-target');
    assert.strictEqual(fs.existsSync(path.join(target, 'mi-tienda.db')), false);
    assert.strictEqual(fs.existsSync(path.join(source, 'mi-tienda.db')), true);
    assert.strictEqual(fs.existsSync(path.join(rollback.archivePath, 'mi-tienda.db')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migración Stokko no crea destino si no hay origen', () => {
  const root = tempRoot();
  const target = path.join(root, 'Stokko_Data');
  try {
    const result = migrateToStokko({
      sourcePaths: [path.join(root, 'missing')],
      targetPath: target,
      lockPath: path.join(root, 'migration.lock'),
    });
    assert.strictEqual(result.status, 'source-absent');
    assert.strictEqual(fs.existsSync(target), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migración Stokko rechaza origen corrupto sin alterar destino', () => {
  const root = tempRoot();
  const source = path.join(root, 'legacy');
  const target = path.join(root, 'Stokko_Data');
  try {
    writeFile(path.join(source, 'mi-tienda.db'), 'not-a-sqlite-database');
    writeFile(path.join(target, 'sentinel.txt'), 'intacto');
    assert.throws(
      () => migrateToStokko({
        sourcePaths: [source],
        targetPath: target,
        lockPath: path.join(root, 'migration.lock'),
      }),
      /inválida/,
    );
    assert.strictEqual(fs.readFileSync(path.join(target, 'sentinel.txt'), 'utf8'), 'intacto');
    assert.strictEqual(fs.existsSync(path.join(target, MARKER_NAME)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migración Stokko respeta lock activo', () => {
  const root = tempRoot();
  const source = path.join(root, 'legacy');
  const lockPath = path.join(root, 'migration.lock');
  try {
    writeLegacyData(source);
    writeFile(lockPath, JSON.stringify({ pid: 999, createdAt: new Date().toISOString() }));
    assert.throws(
      () => migrateToStokko({
        sourcePaths: [source],
        targetPath: path.join(root, 'Stokko_Data'),
        lockPath,
      }),
      /en ejecución/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
