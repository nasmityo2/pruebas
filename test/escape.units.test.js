// Prueba unitaria del helper anti-XSS compartido (Fase 8).
const { test } = require('node:test');
const assert = require('node:assert');
const { escapeHtml } = require('../public/js/escape.js');

test('escapeHtml neutraliza etiquetas y atributos peligrosos', () => {
  assert.strictEqual(
    escapeHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;'
  );
  assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
  assert.strictEqual(escapeHtml('"a" & \'b\''), '&quot;a&quot; &amp; &#39;b&#39;');
});

test('escapeHtml maneja null/undefined/numeros', () => {
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
  assert.strictEqual(escapeHtml(0), '0');
  assert.strictEqual(escapeHtml(123.45), '123.45');
});

test('escapeHtml deja texto normal intacto', () => {
  assert.strictEqual(escapeHtml('Harina P.A.N. 1kg'), 'Harina P.A.N. 1kg');
});
