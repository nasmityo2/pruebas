const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ROUTES_DIR = path.join(ROOT, 'routes');
const SERVER_SOURCE = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function routeFiles() {
  return fs.readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith('.routes.js'))
    .sort();
}

function registeredPrefixes() {
  const registrations = new Map();
  const expression = /registerExpressRouter\(\s*['"]([^'"]+)['"]\s*,\s*require\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)\s*\)/g;
  for (const match of SERVER_SOURCE.matchAll(expression)) {
    const file = match[2].endsWith('.js') ? match[2] : `${match[2]}.js`;
    registrations.set(file, match[1]);
  }
  return registrations;
}

function declarations(source) {
  return [...source.matchAll(/router\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g)]
    .map((match) => ({ method: match[1].toUpperCase(), routePath: match[2] }));
}

function controllerImports(source) {
  const imports = new Map();
  const expression = /const\s+([A-Za-z0-9_]+Controller)\s*=\s*require\(\s*['"](\.\.\/controllers\/[^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(expression)) imports.set(match[1], match[2]);
  return imports;
}

test('contrato estructural de todas las rutas y controladores', () => {
  require('../src/database').initializeDB();
  const files = routeFiles();
  const prefixes = registeredPrefixes();
  const endpoints = new Set();
  let routeCount = 0;
  let controllerReferenceCount = 0;

  assert.strictEqual(files.length, 16, 'deben existir los 16 routers esperados');

  for (const file of files) {
    const source = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const prefix = prefixes.get(file);
    assert.ok(prefix, `${file} debe registrarse en server.js`);

    const routes = declarations(source);
    assert.ok(routes.length > 0, `${file} debe declarar rutas`);
    for (const route of routes) {
      const fullPath = `${prefix}${route.routePath}`.replace(/\/+/g, '/');
      const key = `${route.method} ${fullPath}`;
      assert.ok(!endpoints.has(key), `endpoint duplicado: ${key}`);
      endpoints.add(key);
      routeCount += 1;
    }

    const imports = controllerImports(source);
    for (const [alias, modulePath] of imports) {
      const controller = require(path.resolve(ROUTES_DIR, modulePath));
      const references = [...source.matchAll(new RegExp(`${alias}\\.([A-Za-z0-9_]+)`, 'g'))]
        .map((match) => match[1]);
      assert.ok(references.length > 0, `${alias} debe usarse en ${file}`);
      for (const handlerName of references) {
        assert.strictEqual(
          typeof controller[handlerName],
          'function',
          `${file} referencia ${alias}.${handlerName} inexistente`,
        );
        controllerReferenceCount += 1;
      }
    }
  }

  assert.strictEqual(prefixes.size, files.length, 'no debe haber routers registrados sin archivo');
  assert.strictEqual(routeCount, 112, 'el contrato debe cubrir las 112 rutas adaptadas');
  assert.ok(controllerReferenceCount >= 80, 'debe validar las referencias de controladores');
  assert.match(SERVER_SOURCE, /fastify\.post\(['"]\/api\/print\/remote['"]/);
  assert.match(SERVER_SOURCE, /fastify\.get\(['"]\/['"]/);
});
