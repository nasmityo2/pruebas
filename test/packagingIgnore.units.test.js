const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { shouldIgnore } = require('../scripts/packaging-ignore');

const root = path.resolve(__dirname, '..');

test('packaging ignore excluye servidor separado con ruta relativa de Forge', () => {
  assert.strictEqual(shouldIgnore('/stokko-license-server/server.js', root), true);
  assert.strictEqual(shouldIgnore('stokko-license-server/server.js', root), true);
});

test('packaging ignore excluye servidor separado con ruta absoluta', () => {
  assert.strictEqual(
    shouldIgnore(path.join(root, 'stokko-license-server', 'server.js'), root),
    true,
  );
});

test('packaging ignore conserva entradas de producción del cliente', () => {
  assert.strictEqual(shouldIgnore('/main.js', root), false);
  assert.strictEqual(shouldIgnore('/public/index.html', root), false);
});
