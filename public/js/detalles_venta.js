// public/js/detalles_venta.js
document.addEventListener('DOMContentLoaded', () => {

    const saleIdTitle = document.getElementById('sale-id-title');
    const loadingMessage = document.getElementById('loading-message');
    const errorMessage = document.getElementById('error-message');
    const saleDetailsContainer = document.getElementById('sale-details-container');

    const productsTableBody = document.getElementById('products-table-body');
    const paymentsTableBody = document.getElementById('payments-table-body');

    const summaryTotalVes = document.getElementById('summary-total-ves');
    const summaryTotalUsd = document.getElementById('summary-total-usd');
    const summaryTotalPagado = document.getElementById('summary-total-pagado');
    const summaryTotalPendienteVes = document.getElementById('summary-total-pendiente-ves');
    const summaryTotalPendienteUsd = document.getElementById('summary-total-pendiente-usd');
    const summaryEstado = document.getElementById('summary-estado');
    const summaryFecha = document.getElementById('summary-fecha');

    const clientInfoCard = document.getElementById('client-info-card');
    const clientNombre = document.getElementById('client-nombre');
    const clientCedula = document.getElementById('client-cedula');
    const clientTelefono = document.getElementById('client-telefono');
    const btnPrintReceipt = document.getElementById('btn-print-receipt');


    let currentBcvRate = 1;
    let currentSaleId = null;
    let currentSale = null;

    // ---------- Helpers numéricos ----------

    function safeNumber(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    // ---------- Helpers de modales globales (index.html / layout.js) ----------

    async function showGlobalAlert(message, title = 'Alerta del sistema') {
        const ctx = window.parent || window;
        if (typeof ctx.openSystemAlert === 'function') {
            await ctx.openSystemAlert(message, title);
        } else {
            console.log('ALERTA:', title, message);
        }
    }

    async function showGlobalConfirm(message, title = 'Confirmar acción') {
        const ctx = window.parent || window;
        if (typeof ctx.openSystemConfirm === 'function') {
            return await ctx.openSystemConfirm(message, title);
        } else {
            console.log('CONFIRM (sin modal disponible):', title, message);
            // En fallback NO usamos window.confirm para no bloquear Electron
            return true;
        }
    }


    function mapMetodoLabel(metodo) {
        switch (metodo) {
            case 'VES_EFECTIVO': return 'Efectivo Bs';
            case 'USD_EFECTIVO': return 'Efectivo $';
            case 'PUNTO_VENTA': return 'Punto de Venta';
            case 'BIOPAGO': return 'Biopago';
            case 'TARJETA': return 'Tarjeta';
            case 'PAGOMOVIL': return 'Pago Móvil';
            case 'CASHEA_LIQUIDACION': return 'Liquidación Cashea';
            default: return metodo || 'Otro';
        }
    }


    // ---------- Anular abono ----------

    async function handleVoidAbono(abonoId) {
        if (!abonoId) return;
        if (!currentSaleId) return;

        const confirmed = await showGlobalConfirm(
            '¿Seguro que deseas anular este abono? Esta acción no se puede deshacer.',
            'Anular abono'
        );
        if (!confirmed) return;

        try {
            const res = await fetch(`/api/clients/payment/${encodeURIComponent(abonoId)}/void`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    motivo: `Anulado desde la venta #${currentSaleId}`,
                }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'No se pudo anular el abono.');
            }

            await loadSaleDetails();
            await showGlobalAlert('El abono fue anulado correctamente.', 'Abono anulado');
        } catch (error) {
            console.error('Error al anular abono:', error);
            await showGlobalAlert(
                error.message || 'Error inesperado al anular el abono.',
                'Error al anular abono'
            );
        }
    }

    // ---------- Cargar detalles de la venta ----------

    async function loadSaleDetails() {
        try {
            const params = new URLSearchParams(window.location.search);
            const saleId = params.get('id');
            const autoPrint = params.get('print') === '1';

            if (!saleId) {
                throw new Error('No se ha especificado un ID de venta.');
            }

            currentSaleId = saleId;

            if (saleIdTitle) {
                saleIdTitle.textContent = `#${saleId}`;
            }

            // 1) Tasas
            const ratesResponse = await fetch('/api/settings/rates');
            if (!ratesResponse.ok) throw new Error('No se pudieron cargar las tasas de cambio.');
            const rates = await ratesResponse.json();
            currentBcvRate = parseFloat(rates.BCV) || 1;

            // 2) Detalles de la venta
            const response = await fetch(`/api/sales/${saleId}/details`);
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Error al cargar los detalles de la venta.');
            }

            const data = await response.json();
            renderDetails(data);

            if (loadingMessage) loadingMessage.classList.add('hidden');
            if (saleDetailsContainer) saleDetailsContainer.classList.remove('hidden');

            if (autoPrint) {
                if (window.parent && typeof window.parent.directPrintSale === 'function') {
                    window.parent.directPrintSale(saleId);
                }
            }

        } catch (error) {
            console.error('Error:', error);
            if (loadingMessage) loadingMessage.classList.add('hidden');
            if (errorMessage) {
                errorMessage.textContent = error.message;
                errorMessage.classList.remove('hidden');
            }
            // Opcional: también mostrar modal global
            await showGlobalAlert(error.message || 'Error al cargar la venta.', 'Error');
        }
    }

    function renderDetails(data) {
        if (!data) return;

        const {
            sale = {},
            cliente = null,
            products = [],
            payments = [],
            abonos = []
        } = data;

        currentSale = sale;

        renderSummary(sale, payments, abonos);
        renderClient(cliente);
        renderProducts(products);
        renderPayments(sale, payments, abonos);
    }

    // ---------- Resumen cabecera ----------

    function renderSummary(sale, payments = [], abonos = []) {
        if (!sale) return;

        // Fecha
        const creadoEn = sale.creado_en || sale.created_at || null;
        if (summaryFecha && creadoEn) {
            const formattedDate = new Date(creadoEn).toLocaleString('es-VE', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            summaryFecha.textContent = formattedDate;
        }

        // 1) Total original en USD (fijo, desde BD)
        const totalUsdOriginal = safeNumber(
            sale.total_usd_bcv ??
            sale.deuda_original_usd ??
            sale.total_usd,
            0
        );

        // 2) Total en Bs histórico de la venta
        const totalVesOriginal = safeNumber(sale.total_ves, 0);

        if (summaryTotalVes) {
            summaryTotalVes.textContent = `${totalVesOriginal.toFixed(2)} Bs`;
        }
        if (summaryTotalUsd) {
            summaryTotalUsd.textContent = `${totalUsdOriginal.toFixed(2)} $`;
        }

        // 3) Pendiente en USD
        let pendienteUsd = 0;

        const pendienteFromSaleField =
            sale.monto_pendiente_usd !== undefined && sale.monto_pendiente_usd !== null
                ? safeNumber(sale.monto_pendiente_usd, 0)
                : null;

        const pendienteLegacyField =
            sale.pendiente_usd !== undefined && sale.pendiente_usd !== null
                ? safeNumber(sale.pendiente_usd, 0)
                : null;

        // Calculado a partir de abonos en USD (si hiciera falta)
        let pendienteFromAbonos = null;
        if (Array.isArray(abonos) && abonos.length > 0 && totalUsdOriginal > 0) {
            let sumaAbonosUsd = 0;

            abonos.forEach(a => {
                let abonoUsd = 0;

                if (a.monto_pagado_usd !== undefined && a.monto_pagado_usd !== null) {
                    abonoUsd = safeNumber(a.monto_pagado_usd, 0);
                } else {
                    const montoVes = safeNumber(a.monto_pagado_ves, 0);
                    const tasaAbono = safeNumber(
                        a.tasa_usd ?? a.tasa ?? currentBcvRate,
                        currentBcvRate || 1
                    );
                    abonoUsd = tasaAbono ? (montoVes / tasaAbono) : 0;
                }

                sumaAbonosUsd += abonoUsd;
            });

            pendienteFromAbonos = totalUsdOriginal - sumaAbonosUsd;
        }

        if (pendienteFromSaleField !== null) {
            pendienteUsd = pendienteFromSaleField;
        } else if (pendienteLegacyField !== null) {
            pendienteUsd = pendienteLegacyField;
        } else if (pendienteFromAbonos !== null) {
            pendienteUsd = pendienteFromAbonos;
        } else if (totalUsdOriginal > 0) {
            // Último recurso: sumar pagos + abonos en USD
            let sumaPagosUsd = 0;

            payments.forEach(p => {
                const montoVes = safeNumber(p.monto_en_ves, 0);
                const montoRecibido = safeNumber(p.monto_recibido, 0);
                const tasaPago = safeNumber(
                    p.tasa_bcv_momento ?? p.tasa_usd ?? currentBcvRate,
                    currentBcvRate || 1
                );

                let pagoUsd = 0;

                if (p.metodo === 'USD_EFECTIVO') {
                    pagoUsd = montoRecibido !== 0
                        ? montoRecibido
                        : (tasaPago ? (montoVes / tasaPago) : 0);
                } else {
                    pagoUsd = tasaPago ? (montoVes / tasaPago) : 0;
                }

                sumaPagosUsd += pagoUsd;
            });

            abonos.forEach(a => {
                const montoVes = safeNumber(a.monto_pagado_ves, 0);
                let abonoUsd = 0;

                if (a.monto_pagado_usd !== undefined && a.monto_pagado_usd !== null) {
                    abonoUsd = safeNumber(a.monto_pagado_usd, 0);
                } else {
                    const tasaAbono = safeNumber(
                        a.tasa_usd ?? a.tasa ?? currentBcvRate,
                        currentBcvRate || 1
                    );
                    abonoUsd = tasaAbono ? (montoVes / tasaAbono) : 0;
                }

                sumaPagosUsd += abonoUsd;
            });

            pendienteUsd = totalUsdOriginal - sumaPagosUsd;
        } else {
            pendienteUsd = 0;
        }

        // Normalizar valores pequeños (tolerancia visual mínima para errores de float muy pequeños)
        if (Math.abs(pendienteUsd) < 0.005) {
            pendienteUsd = 0;
        }

        // Venta pagada o anulada → pendiente 0
        if (sale.estado_pago === 'PAGADO' || sale.estado_pago === 'ANULADO') {
            pendienteUsd = 0;
        }

        const pendienteVes = pendienteUsd * currentBcvRate;

        if (summaryTotalPendienteVes) {
            summaryTotalPendienteVes.textContent = `${pendienteVes.toFixed(2)} Bs`;
        }
        if (summaryTotalPendienteUsd) {
            summaryTotalPendienteUsd.textContent = `(${pendienteUsd.toFixed(2)} $)`;
        }

        // 4) Total pagado
        const totalPagadoUsd = Math.max(totalUsdOriginal - pendienteUsd, 0);
        const totalPagadoVes = totalPagadoUsd * currentBcvRate;

        if (summaryTotalPagado) {
            summaryTotalPagado.textContent = `${totalPagadoVes.toFixed(2)} Bs`;
        }

        // 5) Estado de la venta
        if (summaryEstado) {
            let estadoClass = '';
            switch (sale.estado_pago) {
                case 'PAGADO':
                    estadoClass = 'text-green-600';
                    break;
                case 'ABONADO':
                    estadoClass = 'text-yellow-600';
                    break;
                case 'FIADO':
                    estadoClass = 'text-red-600';
                    break;
                case 'ANULADO':
                    estadoClass = 'text-gray-500';
                    break;
                default:
                    estadoClass = 'text-gray-700';
            }
            summaryEstado.textContent = sale.estado_pago || 'DESCONOCIDO';
            summaryEstado.className = `font-semibold ${estadoClass}`;
        }
    }

    // ---------- Cliente ----------

    function renderClient(cliente) {
        if (!cliente || !clientInfoCard) return;

        if (clientNombre) clientNombre.textContent = cliente.nombre || 'Cliente';
        if (clientCedula) clientCedula.textContent = cliente.cedula || 'N/A';
        if (clientTelefono) clientTelefono.textContent = cliente.telefono || 'N/A';

        clientInfoCard.classList.remove('hidden');
    }

    // ---------- Productos ----------

    function renderProducts(products = []) {
        if (!productsTableBody) return;

        productsTableBody.innerHTML = '';

        if (!products.length) {
            productsTableBody.innerHTML = `
                <tr>
                    <td colspan="4" class="px-4 py-3 text-center text-gray-500">
                        No se encontraron productos para esta venta.
                    </td>
                </tr>`;
            return;
        }

        products.forEach(p => {
            const tr = document.createElement('tr');

            const nombreProducto =
                p.producto_nombre ||
                p.nombre_producto ||
                p.nombre ||
                '[Producto Eliminado]';

            const cantidad = safeNumber(p.cantidad, 0);
            const precioUnitario = safeNumber(p.precio_unitario_ves, 0);
            const totalItem = cantidad * precioUnitario;

            tr.innerHTML = `
                <td class="px-4 py-3 text-sm text-gray-900">${nombreProducto}</td>
                <td class="px-4 py-3 text-sm text-gray-600 text-right">${cantidad}</td>
                <td class="px-4 py-3 text-sm text-gray-600 text-right">${precioUnitario.toFixed(2)}</td>
                <td class="px-4 py-3 text-sm text-gray-900 font-medium text-right">${totalItem.toFixed(2)}</td>
            `;
            productsTableBody.appendChild(tr);
        });
    }

    // ---------- Pagos y abonos ----------

    function renderPayments(sale, payments = [], abonos = []) {
        if (!paymentsTableBody) return;

        paymentsTableBody.innerHTML = '';

        if (!payments.length && !abonos.length) {
            paymentsTableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-4 py-3 text-center text-gray-500">
                        No se registraron pagos para esta venta.
                    </td>
                </tr>`;
            return;
        }

        const saleIsClosed =
            sale &&
            (sale.estado_pago === 'ANULADO' || sale.estado_pago === 'PAGADO');

        // Pagos iniciales + movimientos (incluye vuelto como negativo)
        payments.forEach(p => {
            const tr = document.createElement('tr');

            const fechaBase = p.creado_en || p.fecha || sale?.creado_en || sale?.created_at;
            const fecha = fechaBase
                ? new Date(fechaBase).toLocaleDateString('es-VE')
                : '';

            const montoVes = safeNumber(p.monto_en_ves, 0);
            const tasa = safeNumber(
                p.tasa_bcv_momento ?? p.tasa_usd ?? currentBcvRate,
                currentBcvRate || 1
            );

            let montoUsd;
            if (p.metodo === 'USD_EFECTIVO') {
                if (typeof p.monto_recibido === 'number') {
                    montoUsd = safeNumber(p.monto_recibido, 0);
                } else {
                    montoUsd = tasa ? montoVes / tasa : 0;
                }
            } else {
                montoUsd = tasa ? montoVes / tasa : 0;
            }

            const isChange = montoVes < 0;
            const tipoMovimiento = isChange ? 'Vuelto' : 'Pago Inicial';

            tr.innerHTML = `
                <td class="px-4 py-3 text-sm text-gray-600">${fecha}</td>
                <td class="px-4 py-3 text-sm ${isChange ? 'text-red-700' : 'text-gray-900'} font-medium">
                    ${tipoMovimiento}
                </td>
                <td class="px-4 py-3 text-sm text-gray-600">${mapMetodoLabel(p.metodo)}</td>
                <td class="px-4 py-3 text-sm ${isChange ? 'text-red-700' : 'text-gray-900'} text-right">
                    ${montoVes.toFixed(2)}
                </td>
                <td class="px-4 py-3 text-sm ${isChange ? 'text-red-600' : 'text-gray-600'} text-right">
                    ${montoUsd.toFixed(2)}
                </td>
            `;
            paymentsTableBody.appendChild(tr);
        });

        // Abonos posteriores
        abonos.forEach(a => {
            const tr = document.createElement('tr');

            const fechaBase = a.fecha || a.creado_en || sale?.creado_en || sale?.created_at;
            const fecha = fechaBase
                ? new Date(fechaBase).toLocaleDateString('es-VE')
                : '';

            const montoVes = safeNumber(a.monto_pagado_ves, 0);

            let montoUsd;
            if (typeof a.monto_pagado_usd === 'number') {
                montoUsd = safeNumber(a.monto_pagado_usd, 0);
            } else {
                const tasa = safeNumber(a.tasa_usd ?? a.tasa ?? currentBcvRate, currentBcvRate || 1);
                montoUsd = tasa ? montoVes / tasa : 0;
            }

            let actionsHtml = '';
            if (!saleIsClosed && !a.anulado && a.id) {
                actionsHtml = `
                    <button
                        type="button"
                        class="text-red-600 hover:text-red-800 text-xs underline"
                        data-action="void-abono"
                        data-abono-id="${a.id}"
                    >
                        Anular
                    </button>
                `;
            }

            tr.innerHTML = `
                <td class="px-4 py-3 text-sm text-gray-600">${fecha}</td>
                <td class="px-4 py-3 text-sm">
                    <span class="text-green-700 font-medium mr-2">Abono</span>
                    ${actionsHtml}
                </td>
                <td class="px-4 py-3 text-sm text-gray-600">${mapMetodoLabel(a.metodo)}</td>
                <td class="px-4 py-3 text-sm text-green-700 text-right">${montoVes.toFixed(2)}</td>
                <td class="px-4 py-3 text-sm text-green-600 text-right">${montoUsd.toFixed(2)}</td>
            `;
            paymentsTableBody.appendChild(tr);
        });
    }

    // ---------- Eventos ----------


    if (paymentsTableBody) {
        paymentsTableBody.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-action="void-abono"]');
            if (!btn) return;
            const abonoId = btn.dataset.abonoId;
            handleVoidAbono(abonoId);
        });
    }

    if (btnPrintReceipt) {
        btnPrintReceipt.addEventListener('click', () => {
            if (currentSaleId && window.parent && typeof window.parent.directPrintSale === 'function') {
                window.parent.directPrintSale(currentSaleId);
            } else {
                console.error('No se puede imprimir: currentSaleId o directPrintSale no disponibles');
            }
        });
    }

    // ---------- Inicialización ----------
    loadSaleDetails();
});
