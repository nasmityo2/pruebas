// public/js/reports.js
document.addEventListener('DOMContentLoaded', () => {
  const startDateInput = document.getElementById('report-start-date');
  const endDateInput = document.getElementById('report-end-date');
  const generateReportBtn = document.getElementById('btn-generate-report');
  const downloadPdfBtn = document.getElementById('btn-download-pdf');
  const summaryCards = document.getElementById('report-summary-cards');
  const downloadExcelBtn = document.getElementById('btn-download-excel');

  const totalSalesSpan = document.getElementById('summary-total-sales');
  const totalSalesSecSpan = document.getElementById('summary-total-sales-sec');
  const totalCostSpan = document.getElementById('summary-total-cost');
  const totalCostSecSpan = document.getElementById('summary-total-cost-sec');
  const totalProfitSpan = document.getElementById('summary-total-profit');
  const totalProfitSecSpan = document.getElementById('summary-total-profit-sec');
  const totalFiadoSpan = document.getElementById('summary-total-fiado');
  const totalFiadoSecSpan = document.getElementById('summary-total-fiado-sec');
  const totalIvaSpan = document.getElementById('summary-total-iva');
  const totalIvaSecSpan = document.getElementById('summary-total-iva-sec');

  const tableBody = document.getElementById('report-table-body');
  const currencyBtns = document.querySelectorAll('.btn-currency-toggle');
  const presetBtns = document.querySelectorAll('.btn-preset');
  const reportSearchInput = document.getElementById('report-search-input');

  let primaryCurrency = localStorage.getItem('reportPrimaryCurrency') || 'VES';
  let currentRates = {};
  let currentStartDate = '';
  let currentEndDate = '';
  let hasAdminAccess = false;
  let lastReportData = { sales: [], payments: [] };

  // Cache para búsqueda
  let originalSales = [];
  let originalPayments = [];
  let lastSalesById = {};

  // --- Helpers de Alerta ---
  async function showGlobalAlert(message, title) {
    const ctx = window.parent || window;
    if (typeof ctx.openSystemAlert === 'function') {
      await ctx.openSystemAlert(message, title);
    } else {
      console.log('ALERTA:', message);
    }
  }

  async function showGlobalConfirm(message, title) {
    const ctx = window.parent || window;
    if (typeof ctx.openSystemConfirm === 'function') {
      return await ctx.openSystemConfirm(message, title);
    } else {
      console.log('CONFIRM:', message);
      return true;
    }
  }

  // --- Lógica de UI ---
  function updateCurrencyUI() {
    currencyBtns.forEach(btn => {
      if (btn.dataset.currency === primaryCurrency) {
        btn.classList.add('bg-blue-600', 'text-white', 'shadow-md', 'active');
        btn.classList.remove('text-gray-500', 'dark:text-gray-400');
      } else {
        btn.classList.remove('bg-blue-600', 'text-white', 'shadow-md', 'active');
        btn.classList.add('text-gray-500', 'dark:text-gray-400');
      }
    });
  }

  function formatCurrency(amount, currency) {
    if (currency === 'VES') return `${amount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`;
    return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function renderPlaceholder(message, colorClass = 'text-gray-500') {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="px-6 py-4 text-center ${colorClass} opacity-70 italic font-medium">
          <div class="flex flex-col items-center py-10">
            <svg class="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-width="2"></path></svg>
            ${message}
          </div>
        </td>
      </tr>
    `;
  }

  // --- Lógica de Reporte ---
  async function loadRates() {
    try {
      const response = await fetch('/api/settings/rates');
      if (!response.ok) throw new Error('No se pudieron cargar las tasas');
      currentRates = await response.json();
    } catch (error) {
      console.error('Error cargando tasas:', error);
      renderPlaceholder('Error al cargar tasas. Totales en USD no disponibles.');
    }
  }

  function applyDatePreset(preset) {
    const today = new Date();
    let start = new Date();
    let end = new Date();

    switch(preset) {
      case 'yesterday':
        start.setDate(today.getDate() - 1);
        end.setDate(today.getDate() - 1);
        break;
      case 'week':
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -6 : 1);
        start = new Date(today.setDate(diff));
        end = new Date();
        break;
      case 'month':
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case 'last_month':
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case 'year':
        start = new Date(today.getFullYear(), 0, 1);
        break;
    }

    startDateInput.value = formatDate(start);
    endDateInput.value = formatDate(end);
    generateReport();
  }

  // --- Lógica de Filtros ---
  async function loadFiltersData() {
    try {
      const [productsRes, categoriesRes] = await Promise.all([
        fetch('/api/products?limit=100000'),
        fetch('/api/categories')
      ]);

      if (productsRes.ok) {
        const { products } = await productsRes.json();
        
        // Popular select de productos
        const filterProduct = document.getElementById('filter-product');
        if (filterProduct) {
          filterProduct.innerHTML = '<option value="">Todos los productos</option>';
          products.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.nombre} (${p.id})`;
            filterProduct.appendChild(opt);
          });
        }

        // Popular select de proveedores
        const filterProvider = document.getElementById('filter-provider');
        if (filterProvider) {
          filterProvider.innerHTML = '<option value="">Todos los proveedores</option>';
          const providers = [...new Set(products.map(p => p.proveedor).filter(Boolean))].sort();
          providers.forEach(prov => {
            const opt = document.createElement('option');
            opt.value = prov;
            opt.textContent = prov;
            filterProvider.appendChild(opt);
          });
        }
      }

      if (categoriesRes.ok) {
        const categories = await categoriesRes.json();
        const filterCategory = document.getElementById('filter-category');
        if (filterCategory) {
          filterCategory.innerHTML = '<option value="">Todas las categorías</option>';
          categories.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.nombre;
            opt.textContent = c.nombre;
            filterCategory.appendChild(opt);
          });
        }
      }
    } catch (error) {
      console.error('Error cargando datos de filtros:', error);
    }
  }

  async function generateReport() {
    if (!hasAdminAccess) {
      await showGlobalAlert('Acceso denegado. Se requiere contraseña de administrador.', 'Acceso restringido');
      return;
    }

    currentStartDate = startDateInput.value;
    currentEndDate = endDateInput.value;

    if (!currentStartDate || !currentEndDate) {
      await showGlobalAlert('Seleccione un rango de fechas.', 'Rango de fechas');
      return;
    }

    const prodVal = document.getElementById('filter-product')?.value || '';
    const provVal = document.getElementById('filter-provider')?.value || '';
    const catVal = document.getElementById('filter-category')?.value || '';

    summaryCards.classList.add('hidden');
    downloadPdfBtn.classList.add('hidden');
    if (downloadExcelBtn) downloadExcelBtn.classList.add('hidden');
    renderPlaceholder('Generando análisis estratégico...');

    try {
      let salesUrl = `/api/reports/range?startDate=${currentStartDate}&endDate=${currentEndDate}`;
      if (prodVal) salesUrl += `&productoId=${encodeURIComponent(prodVal)}`;
      if (provVal) salesUrl += `&proveedor=${encodeURIComponent(provVal)}`;
      if (catVal) salesUrl += `&categoria=${encodeURIComponent(catVal)}`;

      const salesRes = await fetch(salesUrl);
      const salesData = await salesRes.json();

      if (!salesRes.ok) throw new Error('Error al obtener datos del servidor');

      const sales = salesData.detailedSales || [];
      const payments = salesData.payments || [];
      
      lastReportData = { sales, payments, summary: salesData.summary };
      originalSales = [...sales];
      originalPayments = [...payments];

      lastSalesById = {};
      sales.forEach(s => { if (s.id) lastSalesById[String(s.id)] = s; });

      const summary = salesData.summary || computeRealizedSummary(sales);
      renderSummary(summary);
      renderCombinedTable(sales, payments);

      summaryCards.classList.remove('hidden');
      downloadPdfBtn.classList.remove('hidden');
      if (downloadExcelBtn) downloadExcelBtn.classList.remove('hidden');
    } catch (error) {
      console.error('Error:', error);
      renderPlaceholder(`Error: ${error.message}`, 'text-red-500');
    }
  }

  function computeRealizedSummary(sales) {
    return sales.reduce((acc, sale) => {
      const totalVes = Number(sale.total_ves) || 0;
      const costoVes = Number(sale.total_costo_ves) || 0;
      const pagadoVes = Math.max(0, Math.min(totalVes, (Number(sale.total_pagos_ves) || 0) + (Number(sale.total_abonos_ves) || 0)));
      
      if (sale.estado_pago === 'ANULADO') return acc;

      const pendienteVes = Math.max(0, totalVes - pagadoVes);
      acc.totalFiado += pendienteVes;

      const ingresoRealizado = pagadoVes;
      let costoRealizado = Math.min(ingresoRealizado, costoVes);
      let gananciaRealizada = Math.max(0, ingresoRealizado - costoVes);

      acc.totalIngresos += ingresoRealizado;
      acc.totalCosto += costoRealizado;
      acc.totalGanancia += gananciaRealizada;
      acc.totalIva += (Number(sale.impuesto_total) || 0);

      return acc;
    }, { totalIngresos: 0, totalCosto: 0, totalGanancia: 0, totalFiado: 0, totalIva: 0 });
  }

  function renderSummary(summary) {
    const bcvRate = parseFloat(currentRates.BCV) || 1;
    const isVes = (primaryCurrency === 'VES');

    const updateCard = (vesVal, spanMain, spanSec) => {
      if (!spanMain || !spanSec) return;
      const mainVal = isVes ? vesVal : vesVal / bcvRate;
      const secVal = isVes ? vesVal / bcvRate : vesVal;
      spanMain.textContent = formatCurrency(mainVal, primaryCurrency);
      spanSec.textContent = formatCurrency(secVal, isVes ? 'USD' : 'VES');
    };

    updateCard(summary.totalIngresos, totalSalesSpan, totalSalesSecSpan);
    updateCard(summary.totalCosto, totalCostSpan, totalCostSecSpan);
    updateCard(summary.totalGanancia, totalProfitSpan, totalProfitSecSpan);
    updateCard(summary.totalFiado, totalFiadoSpan, totalFiadoSecSpan);
    
    if (totalIvaSpan && totalIvaSecSpan) {
      updateCard(summary.totalIva || 0, totalIvaSpan, totalIvaSecSpan);
    }
  }

  function renderCombinedTable(sales, payments) {
    tableBody.innerHTML = '';
    const rows = [
      ...sales.map(s => ({ type: 'SALE', date: s.creado_en ? new Date(s.creado_en) : new Date(0), data: s })),
      ...payments.map(p => ({ type: 'ABONO', date: p.fecha ? new Date(p.fecha) : new Date(0), data: p }))
    ].sort((a, b) => a.date - b.date);

    if (!rows.length) {
      renderPlaceholder('Sin movimientos en este periodo.');
      return;
    }

    rows.forEach(row => {
      if (row.type === 'SALE') renderSaleRow(row.data);
      else renderAbonoRow(row.data);
    });
  }

  function renderSaleRow(sale) {
    const bcvRate = parseFloat(currentRates.BCV) || 1;
    const isVes = (primaryCurrency === 'VES');
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors';
    
    const date = new Date(sale.creado_en);
    const totalVes = Number(sale.total_ves) || 0;
    const costoVes = Number(sale.total_costo_ves) || 0;
    const profitVes = totalVes - costoVes;

    const productsHtml = (sale.products || []).map(p => 
      `<div class="text-xs text-gray-500"><span class="font-bold text-gray-700 dark:text-gray-200">${p.cantidad}</span> x ${p.producto_nombre}</div>`
    ).join('');

    let statusHtml = '';
    if (sale.estado_pago === 'PAGADO' || sale.estado_pago === 'FIADO' || sale.estado_pago === 'ABONADO') {
      const isCredit = sale.estado_pago !== 'PAGADO';
      let labelHtml = isCredit ? `<span class="px-3 py-1 text-[10px] font-black uppercase text-yellow-700 bg-yellow-100 rounded-full mr-2">${sale.estado_pago}</span>` : '';
      
      // NUEVO: Mostrar estado de Cashea si aplica
      if (sale.cashea_reconciliado !== null && sale.cashea_reconciliado !== undefined) {
        if (sale.cashea_reconciliado === 0) {
          labelHtml = `<span class="px-3 py-1 text-[10px] font-black uppercase text-blue-700 bg-blue-100 rounded-full mr-2">PENDIENTE CASHEA</span>`;
        } else {
          labelHtml = `<span class="px-3 py-1 text-[10px] font-black uppercase text-green-700 bg-green-100 rounded-full mr-2">CASHEA LIQUIDADO</span>`;
        }
      }

      statusHtml = `
        <div class="flex items-center">
          ${labelHtml}
          <button class="p-2 bg-red-100 text-red-600 rounded-xl hover:bg-red-200 btn-void-sale" data-sale-id="${sale.id}" title="Anular Venta">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" stroke-width="2"></path></svg>
          </button>
        </div>
      `;
    } else {
      statusHtml = `<span class="px-3 py-1 text-[10px] font-black uppercase text-red-700 bg-red-100 rounded-full">Anulado</span>`;
    }

    tr.innerHTML = `
      <td class="px-6 py-4 whitespace-nowrap">
        <div class="text-sm font-bold dark:text-white">${date.toLocaleDateString()}</div>
        <div class="text-[10px] text-gray-400 font-bold">${date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-blue-600 font-black cursor-pointer hover:underline" onclick="window.location.href='detalles_venta.html?id=${sale.id}'">#${sale.id}</td>
      <td class="px-6 py-4 text-sm">${productsHtml}</td>
      <td class="px-6 py-4 text-right font-black">${formatCurrency(isVes ? totalVes : totalVes/bcvRate, primaryCurrency)}</td>
      <td class="px-6 py-4 text-right text-gray-500">${formatCurrency(isVes ? costoVes : costoVes/bcvRate, primaryCurrency)}</td>
      <td class="px-6 py-4 text-right font-bold text-emerald-600">${formatCurrency(isVes ? profitVes : profitVes/bcvRate, primaryCurrency)}</td>
      <td class="px-6 py-4 text-right">
        <div class="flex items-center justify-end space-x-2">
          <button onclick="window.parent.directPrintSale(${sale.id})" class="p-1 px-2 text-blue-600 hover:bg-blue-100 rounded transition-colors" title="Imprimir Recibo">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
          </button>
          ${statusHtml}
        </div>
      </td>
    `;
    tableBody.appendChild(tr);
  }

  function renderAbonoRow(payment) {
    const bcvRate = parseFloat(currentRates.BCV) || 1;
    const isVes = (primaryCurrency === 'VES');
    const tr = document.createElement('tr');
    tr.className = 'bg-blue-50/20 hover:bg-blue-50/40 transition-colors';
    
    const date = new Date(payment.fecha);
    const montoVes = Number(payment.monto_pagado_ves || payment.monto_en_ves || 0);

    tr.innerHTML = `
      <td class="px-6 py-4 whitespace-nowrap">
        <div class="text-sm font-bold dark:text-white">${date.toLocaleDateString()}</div>
        <div class="text-[10px] text-gray-400 font-bold">${date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
      </td>
      <td class="px-6 py-4 text-sm text-indigo-600 font-black">A-${payment.id}</td>
      <td class="px-6 py-4">
        <div class="font-bold text-blue-700">Abono: ${payment.cliente_nombre || 'Cliente'}</div>
        <div class="text-[10px] text-gray-400 uppercase">${payment.venta_id ? `<span class="cursor-pointer hover:underline hover:text-blue-600" onclick="window.location.href='detalles_venta.html?id=${payment.venta_id}'">Venta #${payment.venta_id}</span>` : ''}</div>
      </td>
      <td class="px-6 py-4 text-right font-black text-indigo-700">${formatCurrency(isVes ? montoVes : montoVes/bcvRate, primaryCurrency)}</td>
      <td class="px-6 py-4 text-right text-gray-400 italic">N/A</td>
      <td class="px-6 py-4 text-right text-gray-400 italic">N/A</td>
      <td class="px-6 py-4 text-right"><span class="px-2 py-1 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-lg uppercase tracking-wider">Abono</span></td>
    `;
    tableBody.appendChild(tr);
  }

  async function handleVoidSale(saleId) {
    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    if (!await showGlobalConfirm(`¿Anular venta #${saleId}? Esta acción restaurará el stock y ELIMINARÁ todos los pagos y abonos asociados a esta venta.`, 'Confirmar Anulación')) return;

    try {
      const res = await fetch(`/api/reports/void/${saleId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al anular');
      
      const wantSendToPos = await showGlobalConfirm('Venta anulada. ¿Enviar productos de nuevo al POS?', 'Re-facturar');
      if (wantSendToPos) {
        const detRes = await fetch(`/api/sales/${saleId}/details`);
        const { sale, products } = await detRes.json();
        const ctx = window.parent || window;
        ctx.__POS_PENDING_SALE__ = {
          saleId,
          clienteId: sale.cliente_id,
          clienteNombre: sale.cliente_nombre,
          items: (products || []).map(p => ({ productId: p.producto_id, name: p.producto_nombre, quantity: p.cantidad, priceVes: p.precio_unitario_ves }))
        };
        const posTab = ctx.document.getElementById('tab-pos') || ctx.document.querySelector('[data-tab="pos"]');
        if (posTab) posTab.click();
      }
      generateReport();
    } catch (e) {
      await showGlobalAlert(e.message, 'Error');
    }
  }

  const handleGlobalSearch = debounce(async (e) => {
    const term = e.target.value.trim();
    if (!term) {
      renderSummary(computeRealizedSummary(originalSales));
      renderCombinedTable(originalSales, originalPayments);
      summaryCards.classList.remove('hidden');
      return;
    }
    if (term.length < 2) return;

    renderPlaceholder('Buscando estratégicamente...', 'text-blue-500');
    try {
      const res = await fetch(`/api/reports/search?q=${encodeURIComponent(term)}`);
      const { detailedSales } = await res.json();
      renderCombinedTable(detailedSales || [], []);
      summaryCards.classList.add('hidden');
    } catch (e) {
      renderPlaceholder('Error en búsqueda.');
    }
  }, 600);

  function debounce(func, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  // --- Inicialización ---
  async function initializeReports() {
    updateCurrencyUI();
    const ok = await window.parent.askForAdminPassword();
    if (!ok) {
      renderPlaceholder('Acceso Restringido.', 'text-red-500');
      generateReportBtn.disabled = true;
      return;
    }
    hasAdminAccess = true;
    await Promise.all([
      loadRates(),
      loadFiltersData()
    ]);
    const today = formatDate(new Date());
    startDateInput.value = today;
    endDateInput.value = today;
    generateReport();
  }

  // Event Listeners
  generateReportBtn.addEventListener('click', generateReport);
  
  downloadPdfBtn.addEventListener('click', () => {
    const prodVal = document.getElementById('filter-product')?.value || '';
    const provVal = document.getElementById('filter-provider')?.value || '';
    const catVal = document.getElementById('filter-category')?.value || '';

    let pdfUrl = `/api/reports/range/pdf?startDate=${startDateInput.value}&endDate=${endDateInput.value}`;
    if (prodVal) pdfUrl += `&productoId=${encodeURIComponent(prodVal)}`;
    if (provVal) pdfUrl += `&proveedor=${encodeURIComponent(provVal)}`;
    if (catVal) pdfUrl += `&categoria=${encodeURIComponent(catVal)}`;
    
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = `reporte-ventas-${startDateInput.value}-a-${endDateInput.value}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  if (downloadExcelBtn) {
    downloadExcelBtn.addEventListener('click', () => {
      const prodVal = document.getElementById('filter-product')?.value || '';
      const provVal = document.getElementById('filter-provider')?.value || '';
      const catVal = document.getElementById('filter-category')?.value || '';

      let excelUrl = `/api/reports/range/excel?startDate=${startDateInput.value}&endDate=${endDateInput.value}`;
      if (prodVal) excelUrl += `&productoId=${encodeURIComponent(prodVal)}`;
      if (provVal) excelUrl += `&proveedor=${encodeURIComponent(provVal)}`;
      if (catVal) excelUrl += `&categoria=${encodeURIComponent(catVal)}`;
      
      const a = document.createElement('a');
      a.href = excelUrl;
      a.download = `reporte-ventas-${startDateInput.value}-a-${endDateInput.value}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  tableBody.addEventListener('click', e => {
    const btn = e.target.closest('.btn-void-sale');
    if (btn) handleVoidSale(btn.dataset.saleId);
  });

  currencyBtns.forEach(btn => btn.addEventListener('click', () => {
    primaryCurrency = btn.dataset.currency;
    localStorage.setItem('reportPrimaryCurrency', primaryCurrency);
    updateCurrencyUI();
    if (lastReportData.sales.length) {
      renderSummary(lastReportData.summary || computeRealizedSummary(lastReportData.sales));
      renderCombinedTable(lastReportData.sales, lastReportData.payments);
    }
  }));

  presetBtns.forEach(btn => btn.addEventListener('click', () => {
    presetBtns.forEach(b => b.classList.remove('bg-blue-600', 'text-white'));
    btn.classList.add('bg-blue-600', 'text-white');
    
    const customDateContainer = document.getElementById('custom-date-container');
    if (btn.dataset.preset === 'custom') {
      customDateContainer?.classList.remove('hidden');
    } else {
      customDateContainer?.classList.add('hidden');
      applyDatePreset(btn.dataset.preset);
    }
  }));

  // Enlazar eventos de cambio a filtros dinámicos
  const filterProduct = document.getElementById('filter-product');
  const filterProvider = document.getElementById('filter-provider');
  const filterCategory = document.getElementById('filter-category');

  if (filterProduct) filterProduct.addEventListener('change', generateReport);
  if (filterProvider) filterProvider.addEventListener('change', generateReport);
  if (filterCategory) filterCategory.addEventListener('change', generateReport);

  if (reportSearchInput) reportSearchInput.addEventListener('input', handleGlobalSearch);

  initializeReports();
});
