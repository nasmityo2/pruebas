document.addEventListener('DOMContentLoaded', () => {

    const loadingMessage = document.getElementById('dashboard-loading');
    const dashboardContent = document.getElementById('dashboard-content');

    const statProfitVes = document.getElementById('stat-profit-ves');
    const statProfitUsd = document.getElementById('stat-profit-usd');
    const statTotalFiadoVes = document.getElementById('stat-total-fiado-ves');
    const statTotalFiadoUsd = document.getElementById('stat-total-fiado-usd');
    const statRevenueVes = document.getElementById('stat-revenue-ves');

    const topProductsList = document.getElementById('top-products-list');
    const lowStockList = document.getElementById('low-stock-list');

    const statInvCostVes = document.getElementById('stat-inventory-cost-ves');
    const statInvCostUsd = document.getElementById('stat-inventory-cost-usd');
    const statInvSaleVes = document.getElementById('stat-inventory-sale-ves');
    const statInvSaleUsd = document.getElementById('stat-inventory-sale-usd');

    let currentBcvRate = 1;
    let currentRates = {
        BCV: 1,
        PARALELO: 0,
        COP: 0,
        CALC_METHOD: 1
    };

    // === Helpers para tasas / cálculo de precios (mismas reglas que en el backend) ===

    function normalizeRates(rates) {
        const out = {
            BCV: 0,
            PARALELO: 0,
            COP: 0,
            CALC_METHOD: 1
        };

        if (!rates || typeof rates !== 'object') return out;

        const bcv = parseFloat(rates.BCV);
        const paralelo = parseFloat(rates.PARALELO);
        const cop = parseFloat(rates.COP);
        const calc = parseInt(rates.CALC_METHOD, 10);

        out.BCV = Number.isFinite(bcv) && bcv > 0 ? bcv : 0;
        out.PARALELO = Number.isFinite(paralelo) && paralelo > 0 ? paralelo : 0;
        out.COP = Number.isFinite(cop) && cop > 0 ? cop : 0;
        out.CALC_METHOD = Number.isNaN(calc) ? 1 : calc;

        return out;
    }

    function calculateInternalCostVes(product, rates) {
        const r = rates || currentRates;
        const moneda = (product.moneda_costo || '').toUpperCase();
        const costo = parseFloat(product.costo) || 0;

        if (!costo || costo < 0) return 0;

        switch (moneda) {
            case 'VES':
                return costo;
            case 'BCV':
                return costo * (r.BCV || 0);
            case 'PARALELO':
                return costo * (r.PARALELO || 0);
            case 'COP':
                return costo * (r.COP || 0);
            default:
                console.warn('Moneda de costo desconocida en producto', product.id, moneda);
                return 0;
        }
    }

    function calculateSalePriceVes(product, rates) {
        const r = rates || currentRates;
        const costInVes = calculateInternalCostVes(product, r);
        const rawPercentage = parseFloat(product.porcentaje_ganancia);
        const percentage = Number.isFinite(rawPercentage) ? rawPercentage / 100 : 0;

        if (costInVes <= 0) return 0;

        const calcMethod = r.CALC_METHOD || 1;
        let finalPriceVes = 0;

        if (calcMethod === 2) {
            // Fiscal (Margen): Precio = Costo / (1 - %)
            if (percentage >= 1 || percentage < 0) {
                // Si está mal configurado, al menos no explotamos el precio
                finalPriceVes = costInVes;
            } else {
                finalPriceVes = costInVes / (1 - percentage);
            }
        } else {
            // Simple (Recargo): Precio = Costo * (1 + %)
            if (percentage < 0) {
                finalPriceVes = costInVes;
            } else {
                finalPriceVes = costInVes * (1 + percentage);
            }
        }

        // Si por cualquier cosa viene infinito o raro, lo limitamos
        if (!Number.isFinite(finalPriceVes) || finalPriceVes < 0) {
            finalPriceVes = 0;
        }

        return finalPriceVes;
    }

    // === MISMA LÓGICA DE computeRealizedSummary DEL REPORTE ===
    function computeRealizedSummary(sales) {
        return sales.reduce(
            (acc, sale) => {
                const totalVes = Number(sale.total_ves) || 0;
                const costoVes = Number(sale.total_costo_ves) || 0;

                const pagosIniciales = Number(sale.total_pagos_ves) || 0;   // venta_pagos
                const abonos = Number(sale.total_abonos_ves) || 0;          // abonos
                let pagadoVes = pagosIniciales + abonos;

                // Nunca más de lo que vale la venta
                if (pagadoVes > totalVes) pagadoVes = totalVes;

                // Si por algún motivo quedó en negativo, lo forzamos a 0
                if (pagadoVes < 0) pagadoVes = 0;

                // Deuda pendiente = total - pagado
                let pendienteVes = totalVes - pagadoVes;

                if (pendienteVes < 0) pendienteVes = 0;
                if (pendienteVes > totalVes) pendienteVes = totalVes;

                // Si la venta está anulada, no cuenta para nada
                if (sale.estado_pago === 'ANULADO') {
                    pendienteVes = 0;
                    pagadoVes = 0;
                }

                // TOTAL FIADO (del rango): solo lo que realmente falta por cobrar
                acc.totalFiado += pendienteVes;

                // INGRESO REALIZADO: solo lo que ya está pagado
                const ingresoRealizado = pagadoVes;

                // COSTO + GANANCIA: nunca negativos
                let costoRealizado;
                let gananciaRealizada;

                if (ingresoRealizado <= costoVes) {
                    // Todavía no se cubre el costo → todo se considera costo
                    costoRealizado = ingresoRealizado;
                    gananciaRealizada = 0;
                } else {
                    // Ya se cubrió costo → resto es ganancia
                    costoRealizado = costoVes;
                    gananciaRealizada = ingresoRealizado - costoVes;
                }

                acc.totalIngresos += ingresoRealizado;
                acc.totalCosto += costoRealizado;
                acc.totalGanancia += gananciaRealizada;

                return acc;
            },
            {
                totalIngresos: 0,  // lo realmente cobrado en Bs
                totalCosto: 0,     // costo asociado a lo cobrado
                totalGanancia: 0,  // solo la parte que ya es ganancia
                totalFiado: 0      // lo que falta por cobrar (sumando todas las ventas del rango)
            }
        );
    }

    // Total fiado global: suma de deuda_total_ves de todos los clientes, como en cobranza.js
    function computeGlobalDebt(clients) {
        return clients.reduce((acc, c) => {
            const deuda = Number(c.deuda_total_ves) || 0;
            return acc + deuda;
        }, 0);
    }

    // 🔴 NUEVO: fecha local YYYY-MM-DD (sin UTC)
    function formatLocalDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async function loadAllStats() {
        try {
            // --- Protección para askForAdminPassword ---
            let hasPermission = true;
            if (window.parent && typeof window.parent.askForAdminPassword === 'function') {
                hasPermission = await window.parent.askForAdminPassword();
            } else if (typeof window.askForAdminPassword === 'function') {
                hasPermission = await window.askForAdminPassword();
            } else {
                console.warn('askForAdminPassword no está definida; se omite verificación de admin.');
            }

            if (!hasPermission) {
                throw new Error('Acceso denegado. Se requiere contraseña de administrador.');
            }

            // Fecha de hoy en formato YYYY-MM-DD usando hora local
            const today = new Date();
            const todayStr = formatLocalDate(today);

            const [
                ratesRes,
                dashboardRes,
                topProductsRes,
                allProductsRes,
                salesRangeRes,
                clientsRes
            ] = await Promise.all([
                fetch('/api/settings/rates'),
                fetch('/api/reports/dashboard-stats'),
                fetch('/api/reports/top-products'),
                fetch('/api/products?limit=99999&page=1'),
                // Ventas del día para calcular ganancia neta realizada
                fetch(`/api/reports/range?startDate=${todayStr}&endDate=${todayStr}`),
                // Clientes con sus deudas, igual que en cobranza.js
                fetch('/api/clients?search=')
            ]);

            if (
                !ratesRes.ok ||
                !dashboardRes.ok ||
                !topProductsRes.ok ||
                !allProductsRes.ok ||
                !salesRangeRes.ok ||
                !clientsRes.ok
            ) {
                throw new Error('Error al cargar los datos del dashboard.');
            }

            const ratesRaw = await ratesRes.json();
            const dashboardStats = await dashboardRes.json();
            const topProducts = await topProductsRes.json();
            const allProductsData = await allProductsRes.json();
            const salesRangeData = await salesRangeRes.json();
            const clients = await clientsRes.json();

            // --- Tasa BCV saneada + tasas normalizadas ---
            currentRates = normalizeRates(ratesRaw);
            currentBcvRate = currentRates.BCV > 0 ? currentRates.BCV : 1;

            // Ventas del día (detalle) para usar computeRealizedSummary
            const sales = salesRangeData.detailedSales || [];
            const realizedSummary = computeRealizedSummary(sales);

            // Total fiado global (sumando deuda_total_ves de cada cliente)
            const totalFiadoGlobalVes = computeGlobalDebt(clients);

            renderDashboardStats(dashboardStats, realizedSummary, totalFiadoGlobalVes);
            renderTopProducts(topProducts);
            // 🔴 AQUÍ: ahora pasamos también las tasas para recalcular precios
            renderInventoryStats(allProductsData.products, currentRates);

            if (loadingMessage) {
                loadingMessage.classList.add('hidden');
            }
            if (dashboardContent) {
                dashboardContent.classList.remove('hidden');
            }

        } catch (error) {
            console.error('Error al cargar indicadores:', error);
            if (loadingMessage) {
                loadingMessage.textContent = `Error: ${error.message}`;
                loadingMessage.classList.add('text-red-500');
            }
        }
    }

    function renderDashboardStats(dashboardStats, realizedSummary, totalFiadoGlobalVes) {
        // === Ganancia neta del día (realizada) ===
        let profitVes = 0;
        if (realizedSummary && typeof realizedSummary.totalGanancia === 'number') {
            profitVes = realizedSummary.totalGanancia;
        } else if (dashboardStats && typeof dashboardStats.profit_ves === 'number') {
            // Fallback por si algo falla en el fetch de rango
            profitVes = dashboardStats.profit_ves;
        }

        const profitUsd = currentBcvRate ? (profitVes / currentBcvRate) : 0;

        if (statProfitVes) {
            statProfitVes.textContent = `${profitVes.toFixed(2)} Bs`;
        }
        if (statProfitUsd) {
            statProfitUsd.textContent = `(${profitUsd.toFixed(2)} $)`;
        }

        // === Total fiado global (desde /api/clients como en cobranza.js) ===
        const fiadoVes = totalFiadoGlobalVes || 0;
        const fiadoUsd = currentBcvRate ? (fiadoVes / currentBcvRate) : 0;

        // Ahora el valor grande es en USD y el pequeño en Bs (BCV)
        if (statTotalFiadoUsd) {
            statTotalFiadoUsd.textContent = `${fiadoUsd.toFixed(2)} $`;
        }
        if (statTotalFiadoVes) {
            statTotalFiadoVes.textContent = `${fiadoVes.toFixed(2)} Bs (BCV)`;
        }

        // === Ingresos cobrados hoy ===
        const revenueVes = (dashboardStats && typeof dashboardStats.total_cobrado_ves === 'number')
            ? dashboardStats.total_cobrado_ves
            : 0;

        if (statRevenueVes) {
            statRevenueVes.textContent = `${revenueVes.toFixed(2)} Bs`;
        }
    }

    function renderTopProducts(products) {
        if (!topProductsList) return;

        topProductsList.innerHTML = '';

        // Solo mostramos top 5 para ser coherentes con el título
        const list = (products || []).slice(0, 5);

        if (!list.length) {
            topProductsList.innerHTML = '<li class="text-gray-500 text-sm">No hay ventas registradas en los últimos 28 días.</li>';
            return;
        }

        list.forEach(prod => {
            const li = document.createElement('li');
            li.className = "text-gray-700";
            li.innerHTML = `${prod.nombre} <span class="font-semibold text-blue-600">(${prod.total_sold} vendidos)</span>`;
            topProductsList.appendChild(li);
        });
    }

    // 🔴 AQUÍ está el cambio importante: NO usamos p.costo_en_ves / p.precio_final_ves
    //     sino que recalcualmos desde costo + moneda + % ganancia.
    function renderInventoryStats(allProducts, rates) {
        let totalCostVes = 0;
        let totalSaleVes = 0;
        const lowStockProducts = [];

        (allProducts || []).forEach(p => {
            const stock = Number(p.stock) || 0;

            if (stock <= 0) return;

            const costoEnVes = calculateInternalCostVes(p, rates);
            const precioFinalVes = calculateSalePriceVes(p, rates);

            // Si algún valor se va al carajo por mala configuración, lo ignoramos
            if (!Number.isFinite(costoEnVes) || costoEnVes < 0) return;
            if (!Number.isFinite(precioFinalVes) || precioFinalVes < 0) return;

            totalCostVes += costoEnVes * stock;
            totalSaleVes += precioFinalVes * stock;

            // Menos de 3 unidades (1 o 2) y mayor que 0
            if (stock > 0 && stock < 3) {
                lowStockProducts.push(p);
            }
        });

        const totalCostUsd = currentBcvRate ? (totalCostVes / currentBcvRate) : 0;
        const totalSaleUsd = currentBcvRate ? (totalSaleVes / currentBcvRate) : 0;

        if (statInvCostVes) {
            statInvCostVes.textContent = `${totalCostVes.toFixed(2)} Bs`;
        }
        if (statInvCostUsd) {
            statInvCostUsd.textContent = `${totalCostUsd.toFixed(2)} $`;
        }
        if (statInvSaleVes) {
            statInvSaleVes.textContent = `${totalSaleVes.toFixed(2)} Bs`;
        }
        if (statInvSaleUsd) {
            statInvSaleUsd.textContent = `${totalSaleUsd.toFixed(2)} $`;
        }

        if (!lowStockList) return;

        lowStockList.innerHTML = '';
        if (lowStockProducts.length === 0) {
            lowStockList.innerHTML = '<li class="text-gray-500 text-sm">No hay productos con stock bajo.</li>';
            return;
        }

        lowStockProducts.forEach(prod => {
            const li = document.createElement('li');
            li.className = "text-gray-700";
            li.innerHTML = `${prod.nombre} <span class="font-semibold text-red-600">(Quedan: ${prod.stock})</span>`;
            lowStockList.appendChild(li);
        });
    }

    loadAllStats();

    // ================== LISTA DE REPOSICIÓN DEL DÍA ==================

    const btnVerReposicion = document.getElementById('btn-ver-reposicion');
    const btnRestockRefresh = document.getElementById('btn-restock-refresh');
    const restockPanel = document.getElementById('restock-panel');
    const restockLoading = document.getElementById('restock-loading');
    const restockTableWrap = document.getElementById('restock-table-wrap');
    const restockListBody = document.getElementById('restock-list-body');
    const restockEmpty = document.getElementById('restock-empty');
    const restockBadge = document.getElementById('restock-badge');
    const restockBtnText = document.getElementById('restock-btn-text');
    const restockFechaLabel = document.getElementById('restock-fecha-label');

    let restockPanelOpen = false;

    async function loadRestockList() {
        // Mostrar estado de carga
        restockTableWrap.classList.add('hidden');
        restockEmpty.classList.add('hidden');
        restockLoading.classList.remove('hidden');
        restockLoading.classList.add('flex');

        try {
            const res = await fetch('/api/reports/daily-restock');
            if (!res.ok) throw new Error('Error al obtener la lista de reposición.');
            const data = await res.json();

            restockLoading.classList.add('hidden');
            restockLoading.classList.remove('flex');

            const items = data.items || [];

            // Actualizar badge
            if (restockBadge) {
                restockBadge.textContent = `${items.length} ítem${items.length !== 1 ? 's' : ''}`;
                restockBadge.classList.remove('hidden');
            }

            // Actualizar fecha en el panel
            if (restockFechaLabel) {
                restockFechaLabel.textContent = `Ventas del periodo: ${data.fecha || ''}`;
            }

            if (items.length === 0) {
                restockEmpty.classList.remove('hidden');
                restockTableWrap.classList.remove('hidden');
                restockListBody.innerHTML = '';
                return;
            }

            // Agrupar por fecha
            const grouped = {};
            items.forEach(item => {
                const f = item.fecha_venta || 'Sin fecha';
                if (!grouped[f]) grouped[f] = [];
                grouped[f].push(item);
            });

            // Renderizar tabla agrupada
            restockListBody.innerHTML = '';

            // Ordenar fechas descendente
            const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

            sortedDates.forEach((fecha, dIdx) => {
                // Fila de cabecera de fecha
                const trFecha = document.createElement('tr');
                trFecha.className = 'bg-gray-100 dark:bg-gray-700/80 font-bold cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors group';

                // Formatear fecha para humanos (ej: Lunes, 02 de Marzo)
                let labelFecha = fecha;
                try {
                    const [y, m, d] = fecha.split('-');
                    const dateObj = new Date(y, m - 1, d);
                    labelFecha = dateObj.toLocaleDateString('es-VE', { weekday: 'long', day: '2-digit', month: 'long' });
                    labelFecha = labelFecha.charAt(0).toUpperCase() + labelFecha.slice(1);
                } catch (e) { }

                // El primer día (hoy) aparece expandido por defecto, los demás colapsados
                const isExpanded = dIdx === 0;

                trFecha.innerHTML = `
                    <td colspan="3" class="px-5 py-2 text-xs uppercase tracking-wider text-gray-600 dark:text-gray-300">
                        <div class="flex items-center justify-between w-full">
                            <span>${labelFecha}</span>
                            <svg class="w-4 h-4 transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    </td>
                `;
                restockListBody.appendChild(trFecha);

                // Crear un array para guardar las filas de este día y poder ocultarlas/mostrarlas
                const dayRows = [];

                grouped[fecha].forEach((item, idx) => {
                    const tr = document.createElement('tr');
                    tr.className = `hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${isExpanded ? '' : 'hidden'}`;
                    const cantidad = Number(item.cantidad_total) % 1 === 0
                        ? Number(item.cantidad_total)
                        : Number(item.cantidad_total).toFixed(2);
                    tr.innerHTML = `
                        <td class="px-5 py-3 text-sm text-gray-400 dark:text-gray-500 font-mono">${idx + 1}</td>
                        <td class="px-5 py-3 text-sm font-medium text-gray-800 dark:text-white">${item.nombre}</td>
                        <td class="px-5 py-3 text-sm text-right">
                            <span class="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 rounded-full text-xs font-bold bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                                ${cantidad}
                            </span>
                        </td>
                    `;
                    restockListBody.appendChild(tr);
                    dayRows.push(tr);
                });

                // Evento para colapsar/expandir
                trFecha.addEventListener('click', () => {
                    const icon = trFecha.querySelector('svg');
                    const currentlyHidden = dayRows[0]?.classList.contains('hidden');

                    dayRows.forEach(row => {
                        row.classList.toggle('hidden');
                    });

                    if (currentlyHidden) {
                        icon.classList.add('rotate-180');
                    } else {
                        icon.classList.remove('rotate-180');
                    }
                });
            });

            restockEmpty.classList.add('hidden');
            restockTableWrap.classList.remove('hidden');

        } catch (err) {
            console.error('Error cargando lista de reposición:', err);
            restockLoading.classList.add('hidden');
            restockLoading.classList.remove('flex');
            restockTableWrap.classList.remove('hidden');
            restockListBody.innerHTML = `
                <tr>
                    <td colspan="3" class="px-5 py-4 text-center text-sm text-red-500">
                        Error al cargar la lista. Intenta de nuevo.
                    </td>
                </tr>`;
        }
    }

    function toggleRestockPanel() {
        restockPanelOpen = !restockPanelOpen;

        if (restockPanelOpen) {
            restockPanel.classList.remove('hidden');
            if (restockBtnText) restockBtnText.textContent = 'Ocultar lista';
            loadRestockList();
        } else {
            restockPanel.classList.add('hidden');
            if (restockBtnText) restockBtnText.textContent = 'Ver artículos';
        }
    }

    if (btnVerReposicion) {
        btnVerReposicion.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleRestockPanel();
        });
    }

    if (btnRestockRefresh) {
        btnRestockRefresh.addEventListener('click', loadRestockList);
    }

    // ---- Impresión de la lista de reposición ----
    const btnRestockPrint = document.getElementById('btn-restock-print');

    async function printRestockList() {
        // Obtenemos todas las filas
        const rows = Array.from(restockListBody ? restockListBody.querySelectorAll('tr') : []);
        if (!rows.length) return;

        // Determinamos si imprimimos TODO o solo lo visible
        // Si hay al menos una fila oculta, preguntamos al usuario
        const hasHiddenRows = rows.some(r => r.classList.contains('hidden'));
        let onlyVisible = false;

        if (hasHiddenRows) {
            // Usar el helper global de confirmación del sistema (definido en layout.js)
            const confirmHelper = (window.parent && window.parent.openSystemConfirm) || window.openSystemConfirm;

            if (confirmHelper) {
                const wantsAll = await confirmHelper(
                    "¿Deseas imprimir la lista COMPLETA de los 5 días?\n\n- 'Aceptar' para imprimir todo.\n- 'Cancelar' para imprimir SOLAMENTE las fechas que tienes abiertas.",
                    "Opciones de Impresión"
                );
                onlyVisible = !wantsAll;
            } else {
                // Fallback si por alguna razón no está el helper
                const confirmAll = confirm("¿Deseas imprimir la lista COMPLETA de los 5 días?");
                onlyVisible = !confirmAll;
            }
        }

        const fechaRange = restockFechaLabel ? restockFechaLabel.textContent : '';

        // Construir filas HTML
        let rowsHtml = '';
        let currentDayHasContent = false;
        let tempDayHeader = '';

        rows.forEach((tr) => {
            const isHeader = tr.classList.contains('bg-gray-100'); // Fila de fecha

            if (isHeader) {
                const fechaLabel = tr.querySelector('td').textContent.trim();
                tempDayHeader = `
                    <tr>
                        <td colspan="3" style="padding:12px 12px 6px 12px; font-size:11px; font-weight:bold; color:#4b5563; background:#f3f4f6; text-transform:uppercase; border-top:1px solid #e5e7eb;">
                            ${fechaLabel}
                        </td>
                    </tr>`;
                currentDayHasContent = false;
            } else {
                // Si estamos en modo "Solo Visible" y la fila está oculta, la saltamos
                if (onlyVisible && tr.classList.contains('hidden')) return;

                // Si es la primera fila con contenido de este día, añadimos el encabezado
                if (!currentDayHasContent && tempDayHeader) {
                    rowsHtml += tempDayHeader;
                    tempDayHeader = '';
                    currentDayHasContent = true;
                }

                const tds = tr.querySelectorAll('td');
                if (tds.length < 3) return;
                const idx = tds[0].textContent.trim();
                const nombre = tds[1].textContent.trim();
                const cantidad = tds[1].nextElementSibling ? tds[2].textContent.trim() : '0';

                rowsHtml += `
                    <tr>
                        <td style="padding:8px 12px; color:#9ca3af; font-size:12px; border-bottom:1px solid #f3f4f6;">${idx}</td>
                        <td style="padding:8px 12px; font-size:14px; color:#111827; border-bottom:1px solid #f3f4f6;">${nombre}</td>
                        <td style="padding:8px 12px; font-size:14px; font-weight:700; color:#4f46e5; text-align:right; border-bottom:1px solid #f3f4f6;">${cantidad}</td>
                    </tr>`;
            }
        });

        if (!rowsHtml) {
            const alertHelper = (window.parent && window.parent.openSystemAlert) || window.openSystemAlert;
            if (alertHelper) {
                alertHelper("Nada que imprimir. Por favor despliega al menos un día.", "Aviso");
            } else {
                alert("Nada que imprimir. Por favor despliega al menos un día.");
            }
            return;
        }

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Lista de Reposición ${onlyVisible ? '(Selección)' : '(Completa)'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; color: #1f2937; }
    .header { border-bottom: 2px solid #4f46e5; padding-bottom: 10px; margin-bottom: 20px; }
    h1 { font-size: 20px; color: #111827; }
    .sub { font-size: 12px; color: #6b7280; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; color: #6b7280; padding: 10px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Lista de Reposición ${onlyVisible ? '(Días Seleccionados)' : '(5 Días)'}</h1>
    <p class="sub">${fechaRange}</p>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:40px">#</th>
        <th>Producto</th>
        <th style="text-align:right">Cant. Vendida</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <script>window.onload = function(){ window.print(); window.close(); }<\/script>
</body>
</html>`;

        const win = window.open('', '_blank', 'width=800,height=800');
        if (win) {
            win.document.write(html);
            win.document.close();
        } else {
            const alertHelper = (window.parent && window.parent.openSystemAlert) || window.openSystemAlert;
            const msg = "El navegador bloqueó la ventana emergente de impresión. Por favor, permite las ventanas emergentes para esta aplicación.";
            if (alertHelper) {
                alertHelper(msg, "Navegador Bloqueado");
            } else {
                alert(msg);
            }
        }
    }

    if (btnRestockPrint) {
        btnRestockPrint.addEventListener('click', printRestockList);
    }
});
