// public/js/escape.js
// Utilidad GLOBAL para escapar texto proveniente de la BD antes de insertarlo en el DOM
// con innerHTML (Fase 8, anti-XSS). Un nombre de producto/cliente como
// `<img src=x onerror=...>` dejaría de ejecutarse y se mostraría como texto.
//
// Uso en las vistas:  `<span>${escapeHtml(product.nombre)}</span>`
// Se expone en window para las páginas y se exporta para pruebas con node:test.
(function () {
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  if (typeof window !== 'undefined') {
    window.escapeHtml = escapeHtml;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml };
  }
})();
