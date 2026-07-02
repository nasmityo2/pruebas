document.addEventListener('DOMContentLoaded', () => {

  // =========================
  // HELPERS: GLOBAL MODAL (INDEX.HTML)
  // =========================
  function getParentDocument() {
    try {
      if (window.parent && window.parent !== window && window.parent.document) {
        return window.parent.document;
      }
    } catch (e) {
    }
    return document;
  }

  function showGlobalAlert(message, title = 'Alerta del Sistema') {
    return new Promise((resolve) => {
      const parentDoc = getParentDocument();
      const modal = parentDoc.getElementById('global-alert-modal');
      const titleEl = parentDoc.getElementById('global-alert-title');
      const msgEl = parentDoc.getElementById('global-alert-message');
      const btnOk = parentDoc.getElementById('btn-global-ok');
      const btnCancel = parentDoc.getElementById('btn-global-cancel');
      const btnClose = parentDoc.getElementById('btn-close-global-alert');

      if (!modal || !titleEl || !msgEl || !btnOk) {
        window.alert(message);
        resolve();
        return;
      }

      titleEl.textContent = title;
      msgEl.textContent = message;

      if (btnCancel) btnCancel.classList.add('hidden');

      const cleanup = () => {
        modal.classList.add('hidden');
        btnOk.removeEventListener('click', onOk);
        if (btnClose) btnClose.removeEventListener('click', onClose);
      };

      const onOk = () => {
        cleanup();
        resolve();
      };

      const onClose = () => {
        cleanup();
        resolve();
      };

      btnOk.addEventListener('click', onOk);
      if (btnClose) btnClose.addEventListener('click', onClose);

      modal.classList.remove('hidden');
    });
  }

  function showGlobalConfirm(message, title = 'Confirmación') {
    return new Promise((resolve) => {
      const parentDoc = getParentDocument();
      const modal = parentDoc.getElementById('global-alert-modal');
      const titleEl = parentDoc.getElementById('global-alert-title');
      const msgEl = parentDoc.getElementById('global-alert-message');
      const btnOk = parentDoc.getElementById('btn-global-ok');
      const btnCancel = parentDoc.getElementById('btn-global-cancel');
      const btnClose = parentDoc.getElementById('btn-close-global-alert');

      if (!modal || !titleEl || !msgEl || !btnOk || !btnCancel) {
        const result = window.confirm(message);
        resolve(result);
        return;
      }

      titleEl.textContent = title;
      msgEl.textContent = message;

      btnCancel.classList.remove('hidden');

      const cleanup = () => {
        modal.classList.add('hidden');
        btnOk.removeEventListener('click', onOk);
        btnCancel.removeEventListener('click', onCancel);
        if (btnClose) btnClose.removeEventListener('click', onClose);
      };

      const onOk = () => {
        cleanup();
        resolve(true);
      };

      const onCancel = () => {
        cleanup();
        resolve(false);
      };

      const onClose = () => {
        cleanup();
        resolve(false);
      };

      btnOk.addEventListener('click', onOk);
      btnCancel.addEventListener('click', onCancel);
      if (btnClose) btnClose.addEventListener('click', onClose);

      modal.classList.remove('hidden');
    });
  }

  // =========================
  // ESTADO Y VARIABLES GLOBALES POS
  // =========================

  // Variables de estado
  let cart = [];
  let currentClient = null;
  let currentRoundingMode = 'NONE'; // NONE, UP, DOWN
  const ROUNDING_STEP = 10;
  let currentSearchResults = [];
  let currentRates = {};
  let searchTimeoutPOS;
  let totalChangeDueVes = 0;
  let productForQuantityModal = null;
  let currentClientSearchTimeout;
  let currentClients = [];
  let selectedClientId = null;
  let barcodeScanTimeout;
  let barcodeBuffer = '';
  let manageClientSearchTimeout;
  let currentManageClients = [];
  let lastCompletedSaleId = null;
  let currentPriceEditItem = null;
  let priceModalCurrentCurrency = 'VES';

  // --- CASHEA STATE ---
  let casheaSelectedPercent = 40;
  let casheaSelectedLinea = 'principal';
  let currentCasheaData = null;

  const CART_STORAGE_KEY = 'pos_current_cart';
  const HELD_SALES_STORAGE_KEY = 'pos_held_sales'; // ventas en espera

  // NUEVO: venta en espera pendiente mientras se escribe el nombre
  let pendingHoldSale = null;

  // =========================
  // LOGICA MÓVIL (TABS/VISTAS)
  // =========================
  const posProductsCol = document.getElementById('pos-products-col');
  const posCartCol = document.getElementById('pos-cart-col');
  const mobileBottomBar = document.getElementById('mobile-bottom-bar');
  const btnMobileToggleView = document.getElementById('btn-mobile-toggle-view');
  const mobileTotalDisplay = document.getElementById('mobile-total-display');

  let isMobileCartVisible = false;

  function updateMobileToggleUI() {
    if (!posProductsCol || !posCartCol || !btnMobileToggleView) return;

    if (isMobileCartVisible) {
      // Mostrar Carrito, Ocultar Productos (Móvil)
      posProductsCol.classList.add('hidden');
      posCartCol.classList.remove('hidden');
      posCartCol.classList.add('flex');

      btnMobileToggleView.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" />
        </svg>
        <span>Productos</span>
      `;
    } else {
      // Mostrar Productos, Ocultar Carrito (Móvil)
      posProductsCol.classList.remove('hidden');
      posProductsCol.classList.add('flex');
      posCartCol.classList.add('hidden');

      btnMobileToggleView.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        <span>Carrito (${cart.length})</span>
      `;
    }
  }

  if (btnMobileToggleView) {
    btnMobileToggleView.addEventListener('click', () => {
      isMobileCartVisible = !isMobileCartVisible;
      updateMobileToggleUI();
    });
  }

  // NUEVO: configuración de impresión actual cargada desde el backend
  let currentPrintSettings = null;

  // ===== Helpers para líneas de carrito y stock =====

  function generateCartItemId() {
    return 'ci-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  }

  /**
   * Devuelve cuántas unidades base de un producto están ya "reservadas"
   * en el carrito (unidades sueltas + todas las presentaciones).
   * Puede excluir una línea concreta (para recalcular su propia cantidad).
   */
  function getProductBaseUsage(productId, excludeLineId = null) {
    return cart.reduce((sum, item) => {
      if (item.id !== productId) return sum;
      if (item.tipo_venta === 'PESO') return sum; // peso no se mezcla con presentaciones/unidades
      if (excludeLineId && item.lineId === excludeLineId) return sum;

      const unidadesBase = parseFloat(item.unidadesBase || 1) || 1;
      const qty = parseFloat(item.quantity || 0) || 0;
      return sum + (qty * unidadesBase);
    }, 0);
  }

  function saveCartToLocalStorage() {
    if (cart.length > 0) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } else {
      localStorage.removeItem(CART_STORAGE_KEY);
    }
  }

  function loadCartFromLocalStorage() {
    const storedCart = localStorage.getItem(CART_STORAGE_KEY);
    if (!storedCart) return;
    try {
      const parsed = JSON.parse(storedCart);
      if (!Array.isArray(parsed)) {
        cart = [];
        return;
      }
      cart = parsed.map(item => {
        const unidadesBase =
          typeof item.unidadesBase === 'number' && item.unidadesBase > 0
            ? item.unidadesBase
            : 1;

        let baseStock;
        if (item.tipo_venta === 'PESO') {
          baseStock =
            typeof item.baseStock === 'number' && item.baseStock > 0
              ? item.baseStock
              : (typeof item.stock === 'number' ? item.stock : 0);
        } else {
          baseStock =
            typeof item.baseStock === 'number' && item.baseStock > 0
              ? item.baseStock
              : Infinity; // si no sabemos, no limitamos
        }

        return {
          ...item,
          lineId: item.lineId || generateCartItemId(),
          presentationId: item.presentationId || null,
          unidadesBase,
          baseStock
        };
      });
    } catch (e) {
      cart = [];
    }
  }

  // NUEVO: helpers para ventas en espera
  function loadHeldSales() {
    try {
      const raw = localStorage.getItem(HELD_SALES_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('Error leyendo ventas en espera de localStorage:', e);
      return [];
    }
  }

  function saveHeldSales(list) {
    try {
      localStorage.setItem(HELD_SALES_STORAGE_KEY, JSON.stringify(list || []));
    } catch (e) {
      console.error('Error guardando ventas en espera en localStorage:', e);
    }
  }

  // =========================
  // ELEMENTOS DEL DOM (POS.HTML)
  // =========================

  const searchInputPOS = document.getElementById('pos-search-input');
  const searchResultsDiv = document.getElementById('pos-search-results');
  const searchPlaceholder = document.getElementById('search-placeholder');
  const cartItemsDiv = document.getElementById('pos-cart-items');
  const cartEmptyMessage = document.getElementById('cart-empty-message');
  const totalVesSpan = document.getElementById('pos-total-ves');
  const totalUsdSpan = document.getElementById('pos-total-usd');
  const btnCancelarVenta = document.getElementById('btn-cancelar-venta');
  const btnPagar = document.getElementById('btn-pagar');
  const btnDailyClose = document.getElementById('btn-daily-close');
  const btnPrintSettings = document.getElementById('btn-print-settings');

  const priceModal = document.getElementById('price-modal');
  const priceModalTitle = document.getElementById('price-modal-title');
  const priceModalInput = document.getElementById('price-modal-input');
  const priceModalStatus = document.getElementById('price-modal-status');
  const formPrice = document.getElementById('form-price');
  const btnCancelarPrecio = document.getElementById('btn-cancelar-precio');
  const priceModalCurrencySelect = document.getElementById('price-modal-moneda');

  const paymentModal = document.getElementById('payment-modal');
  const btnCancelarPago = document.getElementById('btn-cancelar-pago');
  const formPago = document.getElementById('form-pago');
  const modalTotalVesSpan = document.getElementById('modal-total-ves');
  const modalTotalUsdSpan = document.getElementById('modal-total-usd');
  const pagoVesEfectivoInput = document.getElementById('pago-ves-efectivo');
  const pagoUsdEfectivoInput = document.getElementById('pago-usd-efectivo');
  const pagoPuntoInput = document.getElementById('pago-punto');
  const pagoBiopagoInput = document.getElementById('pago-biopago');
  const pagoPagomovilInput = document.getElementById('pago-pagomovil');
  const saleNotaInput = document.getElementById('sale-nota');
  const faltanteContainer = document.getElementById('faltante-container');
  const modalFaltanteVesSpan = document.getElementById('modal-faltante-ves');
  const modalFaltanteUsdSpan = document.getElementById('modal-faltante-usd');
  const vueltoContainer = document.getElementById('vuelto-container');
  const modalVueltoVesSpan = document.getElementById('modal-vuelto-ves');
  const modalVueltoUsdSpan = document.getElementById('modal-vuelto-usd');
  const btnCompletarVenta = document.getElementById('btn-completar-venta');
  const btnGuardarFiado = document.getElementById('btn-guardar-fiado');
  const paymentInputs = document.querySelectorAll('.pago-input');

  const btnPagoTodoVes = document.getElementById('btn-pago-todo-ves');
  const btnPagoTodoUsd = document.getElementById('btn-pago-todo-usd');
  const btnPagoTodoPunto = document.getElementById('btn-pago-todo-punto');
  const btnPagoTodoBiopago = document.getElementById('btn-pago-todo-biopago');
  const btnPagoTodoPagomovil = document.getElementById('btn-pago-todo-pagomovil');

  const clientSearchInput = document.getElementById('client-search-payment');
  const clientSearchResultsDiv = document.getElementById('client-search-results-payment');
  const selectedClientDiv = document.getElementById('selected-client-payment');
  const selectedClientNameSpan = document.getElementById('selected-client-name');
  const selectedClientIdInput = document.getElementById('selected-client-id');
  const btnRemoveSelectedClient = document.getElementById('btn-remove-selected-client');
  const btnAddNewClientPOS = document.getElementById('btn-add-new-client-pos');

  const btnManageClientsPOS = document.getElementById('btn-manage-clients-pos');

  const changeModal = document.getElementById('change-modal');
  const changeModalTotalVesSpan = document.getElementById('change-modal-total-ves');
  const changeModalTotalUsdSpan = document.getElementById('change-modal-total-usd');
  const formChange = document.getElementById('form-change');
  const changeUsdEfectivoInput = document.getElementById('change-usd-efectivo');
  const changeVesEfectivoInput = document.getElementById('change-ves-efectivo');
  const changePagomovilInput = document.getElementById('change-pagomovil');
  const changeRemainingContainer = document.getElementById('change-remaining-container');
  const changeModalRemainingVesSpan = document.getElementById('change-modal-remaining-ves');
  const changeStatusP = document.getElementById('change-status');
  const btnConfirmarVuelto = document.getElementById('btn-confirmar-vuelto');
  const changeInputs = document.querySelectorAll('.change-input');

  const btnChangeTodoUsd = document.getElementById('btn-change-todo-usd');
  const btnChangeTodoVes = document.getElementById('btn-change-todo-ves');
  const btnChangeTodoPm = document.getElementById('btn-change-todo-pm');

  const quantityModal = document.getElementById('quantity-modal');
  const formQuantity = document.getElementById('form-quantity');
  const quantityModalTitle = document.getElementById('quantity-modal-title');
  const quantityModalInput = document.getElementById('quantity-modal-input');
  const quantityModalStatus = document.getElementById('quantity-modal-status');
  const btnCancelarCantidad = document.getElementById('btn-cancelar-cantidad');

  const clientModal = document.getElementById('client-modal');
  const clientModalTitle = document.getElementById('client-modal-title');
  const clientForm = document.getElementById('form-client');
  const clientIdInput = document.getElementById('client-id');
  const clientNombreInput = document.getElementById('client-nombre');
  const clientCedulaInput = document.getElementById('client-cedula');
  const clientTelefonoInput = document.getElementById('client-telefono');
  const clientDireccionInput = document.getElementById('client-direccion');
  const btnCancelClient = document.getElementById('btn-cancelar-client');
  const clientModalStatus = document.getElementById('client-modal-status');

  const clientManageModal = document.getElementById('client-manage-modal');
  const btnCloseClientManage = document.getElementById('btn-close-client-manage');
  const btnCancelClientManage = document.getElementById('btn-cancel-client-manage');
  const manageClientSearchInput = document.getElementById('manage-client-search');
  const manageClientResultsList = document.getElementById('manage-client-results');
  const manageClientIdInput = document.getElementById('manage-client-id');
  const manageClientNombreInput = document.getElementById('manage-client-nombre');
  const manageClientCedulaInput = document.getElementById('manage-client-cedula');
  const manageClientTelefonoInput = document.getElementById('manage-client-telefono');
  const manageClientDireccionInput = document.getElementById('manage-client-direccion');
  const clientManageStatus = document.getElementById('client-manage-status');
  const btnDeleteClient = document.getElementById('btn-delete-client');
  const btnUpdateClient = document.getElementById('btn-update-client');
  const clientManageForm = document.getElementById('form-client-manage');

  const cierreZModal = document.getElementById('cierre-z-modal');
  const btnCloseCierreZ = document.getElementById('btn-close-cierre-z');
  const cierreZSummaryBody = document.getElementById('cierre-z-summary-body');
  const cierreZNotas = document.getElementById('cierre-z-notas');
  const cierreZStatus = document.getElementById('cierre-z-status');
  const btnImprimirCierreZ = document.getElementById('btn-imprimir-cierre-z');

  // NUEVO: info visual de apertura de caja dentro del Cierre Z
  const cierreZOpeningResumen = document.getElementById('cierre-z-opening-resumen');

  // NUEVO: elementos del modal de Retiro de efectivo (Cierre Z)
  const btnOpenWithdrawalModal = document.getElementById('btn-open-withdrawal-modal');
  const withdrawalModal = document.getElementById('withdrawal-modal');
  const btnCloseWithdrawalModal = document.getElementById('btn-close-withdrawal-modal');
  const btnCancelWithdrawal = document.getElementById('btn-cancel-withdrawal');
  const withdrawalForm = document.getElementById('form-withdrawal');
  const withdrawalMethod = document.getElementById('withdrawal-method');
  const withdrawalAmount = document.getElementById('withdrawal-amount');
  const withdrawalDescription = document.getElementById('withdrawal-description');
  const withdrawalStatus = document.getElementById('withdrawal-status');

  // 🔹 NUEVO: elementos para APERTURA DE CAJA
  const btnOpenCashOpeningModal = document.getElementById('btn-open-cash-opening-modal');
  const cashOpeningModal = document.getElementById('cash-opening-modal');
  const btnCloseCashOpeningModal = document.getElementById('btn-close-cash-opening-modal');
  const btnCancelCashOpening = document.getElementById('btn-cancel-cash-opening');
  const formCashOpening = document.getElementById('form-cash-opening');
  const cashOpeningVesInput = document.getElementById('cash-opening-ves');
  const cashOpeningUsdInput = document.getElementById('cash-opening-usd');
  const cashOpeningNotesInput = document.getElementById('cash-opening-notes');
  const cashOpeningStatus = document.getElementById('cash-opening-status');

  const printSettingsModal = document.getElementById('print-settings-modal');
  const btnClosePrintSettings = document.getElementById('btn-close-print-settings');
  const btnCancelPrintSettings = document.getElementById('btn-cancel-print-settings');
  const formPrintSettings = document.getElementById('form-print-settings');
  const printSettingsStatus = document.getElementById('print-settings-status');

  // --- NUEVO: VISIBILIDAD DE FUNCIONES (CASHEA) ---
  async function applyFeatureVisibility() {
    try {
      const response = await fetch('/api/settings/rates');
      if (!response.ok) return;
      const settings = await response.json();

      const enableCashea = (settings.ENABLE_CASHEA === 1 || settings.ENABLE_CASHEA === '1' || settings.ENABLE_CASHEA === true);

      const btnCasheaReconciliation = document.getElementById('btn-cashea-reconciliation');
      const btnCasheaOpen = document.getElementById('btn-cashea-open');

      if (btnCasheaReconciliation) {
        btnCasheaReconciliation.style.display = enableCashea ? 'flex' : 'none';
      }
      if (btnCasheaOpen) {
        btnCasheaOpen.style.display = enableCashea ? 'flex' : 'none';
      }

      window.isCasheaEnabled = enableCashea;
    } catch (e) {
      console.error('Error al aplicar visibilidad de funciones:', e);
    }
  }

  applyFeatureVisibility(); // Ejecutar al cargar POS

  const parentDoc = getParentDocument();
  const saleCompleteModal = parentDoc.getElementById('sale-complete-modal');
  const saleCompleteMessage = parentDoc.getElementById('sale-complete-message');
  const btnCloseSaleComplete = parentDoc.getElementById('btn-close-sale-complete');

  // NUEVO: elementos para ventas en espera
  const btnHoldSale = document.getElementById('btn-hold-sale');
  const btnOpenHeldSales = document.getElementById('btn-held-sales');
  const holdSalesModal = document.getElementById('hold-sales-modal');
  const holdSalesList = document.getElementById('hold-sales-list');
  const holdSalesStatus = document.getElementById('hold-sales-status');
  const btnCloseHoldSales = document.getElementById('btn-close-hold-sales');

  // NUEVO: modal para nombre de venta en espera
  const holdSaleClientModal = document.getElementById('hold-sale-client-modal');
  const holdSaleClientNameInput = document.getElementById('hold-sale-client-name');
  const holdSaleClientStatus = document.getElementById('hold-sale-client-status');
  const btnCancelHoldSaleClient = document.getElementById('btn-cancel-hold-sale-client');
  const btnConfirmHoldSaleClient = document.getElementById('btn-confirm-hold-sale-client');

  // NUEVO: modal venta libre
  const ventaLibreModal = document.getElementById('venta-libre-modal');
  const btnCloseVentaLibre = document.getElementById('btn-close-venta-libre');
  const btnCancelVentaLibre = document.getElementById('btn-cancel-venta-libre');
  const formVentaLibre = document.getElementById('form-venta-libre');
  const vlNombre = document.getElementById('vl-nombre');
  const vlCostoUsd = document.getElementById('vl-costo-usd');
  const vlCostoVes = document.getElementById('vl-costo-ves');
  const vlPrecioUsd = document.getElementById('vl-precio-usd');
  const vlPrecioVes = document.getElementById('vl-precio-ves');
  const vlCantidad = document.getElementById('vl-cantidad');
  const vlExentoIva = document.getElementById('vl-exento-iva');

  // =========================
  // CARGA DE TASAS Y MÉTODOS DE PAGO
  // =========================

  window.activePaymentMethods = [];
  window.customRatesList = [];

  async function loadPaymentMethodsAndRates() {
    try {
      const pmRes = await fetch('/api/payment-methods');
      if (pmRes.ok) {
        window.activePaymentMethods = await pmRes.json();
      }
      
      const crRes = await fetch('/api/custom-rates');
      if (crRes.ok) {
        window.customRatesList = await crRes.json();
      }
    } catch (e) {
      console.error('Error loading payment methods or custom rates:', e);
    }
  }

  async function loadRates() {
    try {
      await loadPaymentMethodsAndRates();
      const response = await fetch('/api/settings/rates');
      if (!response.ok) throw new Error('No se pudieron cargar las tasas');
      currentRates = await response.json();
      console.log('Tasas cargadas:', currentRates);

      // Update POS Header Display
      const posBcvValue = document.getElementById('pos-bcv-value');
      const mobileBcvValue = document.getElementById('mobile-bcv-value');
      
      if (posBcvValue && currentRates && currentRates.BCV) {
        posBcvValue.textContent = currentRates.BCV.toFixed(2) + ' Bs';
        const posBcvDisplay = document.getElementById('pos-bcv-display');
        if (posBcvDisplay) posBcvDisplay.classList.remove('hidden');
      }

      if (mobileBcvValue && currentRates && currentRates.BCV) {
        mobileBcvValue.textContent = currentRates.BCV.toFixed(2) + ' Bs';
      }

      if (!currentRates || typeof currentRates.BCV !== 'number' || currentRates.BCV <= 0) {
        console.error("BCV rate is missing or invalid:", currentRates.BCV);
        await showGlobalAlert(
          "Error crítico: La tasa BCV no está configurada correctamente. No se pueden calcular los precios en USD ni el vuelto."
        );
      }
    } catch (error) {
      console.error('Error cargando tasas:', error);
      await showGlobalAlert('Error al cargar las tasas de cambio. Por favor, recarga la página.');
    }
  }

  // Helper para convertir precios entre VES y USD_BCV
  function convertPrice(value, fromCurrency, toCurrency) {
    const num = parseFloat(value);
    if (isNaN(num)) return 0;

    if (!currentRates || typeof currentRates.BCV !== 'number' || currentRates.BCV <= 0) {
      // Si no hay tasa válida, no intentamos convertir
      return num;
    }

    if (fromCurrency === toCurrency) return num;

    if (fromCurrency === 'VES' && toCurrency === 'USD_BCV') {
      return num / currentRates.BCV;
    }

    if (fromCurrency === 'USD_BCV' && toCurrency === 'VES') {
      return num * currentRates.BCV;
    }

    return num;
  }

  // =========================
  // BÚSQUEDA Y LISTADO DE PRODUCTOS
  // =========================

  async function loadProducts(searchTerm = '') {
    searchResultsDiv.innerHTML = '';
    if (searchTerm.trim()) {
      searchPlaceholder.textContent = 'Buscando...';
      searchPlaceholder.classList.remove('hidden');
    } else {
      currentSearchResults = [];
      renderSearchResults();
      return;
    }
    try {
      const limitSearch = 50;
      const params = new URLSearchParams();
      params.append('search', searchTerm);
      params.append('limit', limitSearch);
      params.append('page', 1);
      const response = await fetch(`/api/products?${params.toString()}`);
      if (!response.ok) throw new Error('No se pudieron cargar los productos');
      const data = await response.json();
      currentSearchResults = data.products || [];

      if (searchTerm.trim().toLowerCase() === 'venta libre' || searchTerm.trim().toLowerCase() === 'libre') {
        currentSearchResults.unshift({
          id: 'VENTA_LIBRE',
          nombre: 'VENTA LIBRE (Personalizada)',
          stock: 999999,
          tipo_venta: 'LIBRE',
          precio_final_ves: 0,
          precio_final_usd_bcv: 0
        });
      }

      renderSearchResults();
    } catch (error) {
      console.error('Error cargando productos:', error);
      searchPlaceholder.textContent = 'Error al cargar productos.';
      searchPlaceholder.classList.remove('hidden');
      currentSearchResults = [];
    }
  }

  // NUEVO: productos + presentaciones
  function renderSearchResults() {
    // Control de visibilidad para móvil (overlay)
    const hasQuery = searchInputPOS.value.trim().length > 0;
    const hasResults = currentSearchResults.length > 0;

    if (hasQuery || hasResults) {
      searchResultsDiv.classList.remove('hidden');
    } else {
      searchResultsDiv.classList.add('hidden');
    }

    searchResultsDiv.innerHTML = '';
    searchPlaceholder.classList.add('hidden');

    if (currentSearchResults.length === 0) {
      if (searchInputPOS.value.trim()) {
        searchPlaceholder.textContent = 'No se encontraron productos.';
      } else {
        searchPlaceholder.textContent = 'Escribe para buscar productos...';
      }
      searchPlaceholder.classList.remove('hidden');
      return;
    }

    currentSearchResults.forEach(product => {
      if (!product || product.stock <= 0) return;

      const unitSuffix = product.tipo_venta === 'PESO' ? '/Kg' : (product.tipo_venta === 'LITRO' ? '/Lt' : (product.tipo_venta === 'METRO' ? '/Mt' : ''));
      const stockUnit = product.tipo_venta === 'PESO' ? 'Kg' : (product.tipo_venta === 'LITRO' ? 'Lt' : (product.tipo_venta === 'METRO' ? 'Mt' : 'Unid'));

      const showImages = localStorage.getItem('inventarioShowImages') === 'true';

      // === PRODUCTO BASE ===
      const button = document.createElement('button');
      button.className =
        "w-full text-left p-3 rounded hover:bg-blue-100 focus:outline-none focus:bg-blue-100 flex justify-between items-center border-b last:border-b-0";
      button.dataset.productId = product.id;

      const pvpVes = parseFloat(product.precio_final_ves || 0).toFixed(2);
      const pvpUsd = parseFloat(product.precio_final_usd_bcv || 0).toFixed(2);

      const imgHtml = showImages && product.imagen
        ? `<img src="/uploads/${product.imagen}" onerror="this.style.display='none'" alt="" class="w-10 h-10 object-cover rounded-md border border-gray-200 shrink-0 mr-3">`
        : (showImages ? `<div class="w-10 h-10 bg-gray-100 rounded-md border border-gray-200 flex items-center justify-center shrink-0 mr-3"><svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg></div>` : '');

      button.innerHTML = `
        <div class="flex items-center">
          ${imgHtml}
          <div>
            <span class="font-medium text-gray-800">${product.nombre}</span>
            <span class="text-xs text-green-600 ml-2">(Stock: ${product.stock} ${stockUnit})</span>
          </div>
        </div>
        <div class="text-right">
            <span class="text-sm text-gray-700 font-semibold">
              ${pvpVes} Bs ${unitSuffix}
            </span>
            <br>
            <span class="text-xs text-gray-500">
              (${pvpUsd} $ ${unitSuffix})
            </span>
        </div>
      `;
      button.addEventListener('click', () => handleProductClick(product.id));
      searchResultsDiv.appendChild(button);

      // === PRESENTACIONES OPCIONALES ===
      const presList = Array.isArray(product.presentations)
        ? product.presentations
        : (Array.isArray(product.presentaciones) ? product.presentaciones : []);

      if (!presList || presList.length === 0) return;

      presList.forEach(pres => {
        if (!pres) return;

        const unitsPerPres = parseFloat(pres.unidades_base || pres.unidadesBase || 0);
        const baseStock = parseFloat(product.stock || 0);
        if (isNaN(unitsPerPres) || unitsPerPres <= 0 || isNaN(baseStock) || baseStock <= 0) return;

        const maxByStock = Math.floor(baseStock / unitsPerPres);
        if (maxByStock <= 0) return;

        const pButton = document.createElement('button');
        pButton.className =
          "w-full text-left pl-5 pr-3 py-2 rounded hover:bg-indigo-50 focus:outline-none focus:bg-indigo-50 flex justify-between items-center border-b last:border-b-0 text-sm";
        pButton.dataset.productId = product.id;
        pButton.dataset.presentationId = pres.id;

        const presPriceVes = parseFloat(pres.precio_ves || pres.precio_final_ves || 0).toFixed(2);
        const presPriceUsd = parseFloat(pres.precio_usd_bcv || pres.precio_final_usd_bcv || 0).toFixed(2);

        pButton.innerHTML = `
          <div>
            <span class="font-medium text-gray-700">${product.nombre}</span>
            <span class="text-xs text-gray-500 ml-1">- ${pres.nombre || 'Presentación'}</span>
            <span class="text-[11px] text-green-600 ml-2">
              (Stock aprox: ${maxByStock} ${pres.nombre || ''})
            </span>
          </div>
          <div class="text-right">
            <span class="text-xs text-gray-700 font-semibold">
              ${presPriceVes} Bs
            </span>
            <br>
            <span class="text-[11px] text-gray-500">
              (${presPriceUsd} $)
            </span>
          </div>
        `;
        pButton.addEventListener('click', () =>
          handleProductClick(product.id, pres.id)
        );
        searchResultsDiv.appendChild(pButton);
      });
    });
  }

  function handlePosSearchInput(event) {
    clearTimeout(searchTimeoutPOS);
    const searchTerm = event.target.value;

    clearTimeout(barcodeScanTimeout);
    barcodeBuffer = searchTerm;

    barcodeScanTimeout = setTimeout(() => {
      if (barcodeBuffer.length > 2 && barcodeBuffer.endsWith('\n')) {
        const scannedBarcode = barcodeBuffer.trim();
        console.log('Barcode scan detected:', scannedBarcode);
        searchInputPOS.value = scannedBarcode;
        handleBarcodeScan(scannedBarcode);
        barcodeBuffer = '';
      }
    }, 100);

    searchTimeoutPOS = setTimeout(() => {
      if (barcodeBuffer.endsWith('\n')) return;
      console.log('Manual search:', searchTerm);
      loadProducts(searchTerm);
    }, 300);
  }

  function handlePosSearchKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(searchTimeoutPOS);
      clearTimeout(barcodeScanTimeout);

      const searchTerm = searchInputPOS.value.trim();
      console.log('Search triggered by Enter/Scan:', searchTerm);

      const isNumeric = /^\d+$/.test(searchTerm);

      if (searchTerm.length > 2 && isNumeric) {
        handleBarcodeScan(searchTerm);
      } else {
        loadProducts(searchTerm);
      }

      barcodeBuffer = '';
    }
  }

  // NUEVO: primero intenta código de barras de presentación, luego producto
  async function handleBarcodeScan(barcode) {
    try {
      let handled = false;

      // 1) Intentar como presentación
      try {
        const presResponse = await fetch(`/api/presentations/barcode/${encodeURIComponent(barcode)}`);
        if (presResponse.ok) {
          const data = await presResponse.json();
          const product = data.product || data.producto;
          // Corregido: si data tiene id y no hay propiedad anidada, el objeto data es la presentación
          const presentation = data.presentation || data.presentacion || data.presentationData || (data.id ? data : null);
          if (product && presentation) {
            await addPresentationToCart(product, presentation);
            handled = true;
          }
        }
      } catch (innerError) {
        console.warn('No se pudo resolver el código como presentación:', innerError);
      }

      if (handled) return;

      // 2) Producto normal
      const response = await fetch(`/api/products/barcode/${encodeURIComponent(barcode)}`);
      const product = await response.json();

      if (!response.ok) {
        throw new Error(product.error || 'Producto no encontrado');
      }

      currentSearchResults = [product];
      handleProductClick(product.id);

    } catch (error) {
      console.error('Error en escaneo de barcode:', error);
      searchPlaceholder.textContent = `Error: ${error.message}`;
      searchPlaceholder.classList.remove('hidden');
      searchResultsDiv.innerHTML = '';
    }
  }

  // =========================
  // CARRITO
  // =========================

  // NUEVO: ahora soporta producto base o presentación
  async function handleProductClick(productId, presentationId = null) {
    const product = currentSearchResults.find(p => p.id === productId);
    if (!product) return;

    // Si viene una presentación, la manejamos como tal
    if (presentationId) {
      const list = Array.isArray(product.presentations)
        ? product.presentations
        : (Array.isArray(product.presentaciones) ? product.presentaciones : []);
      const pres = list.find(pr => pr.id === presentationId);
      if (!pres) return;
      await addPresentationToCart(product, pres);
      return;
    }

    // Producto normal
    if (product.id === 'VENTA_LIBRE' || product.tipo_venta === 'LIBRE') {
      openVentaLibreModal();
      return;
    }

    if (product.tipo_venta === 'PESO' || product.tipo_venta === 'LITRO' || product.tipo_venta === 'METRO') {
      openQuantityModal(product);
    } else {
      await addUnitProductToCart(product);
    }
  }

  // UNIDAD (sin presentación) PERMITIENDO mezclar con presentaciones
  async function addUnitProductToCart(product) {
    const baseStock = Number(product.stock) || 0;
    if (baseStock <= 0) {
      await showGlobalAlert(`No hay stock disponible para ${product.nombre}.`);
      return;
    }

    const usedBase = getProductBaseUsage(product.id);
    const remainingBase = baseStock - usedBase;

    if (remainingBase < 1) {
      await showGlobalAlert(`No hay más stock disponible para ${product.nombre}.`);
      return;
    }

    const cartItem = cart.find(
      item => item.id === product.id && !item.presentationId && item.tipo_venta === 'UNIDAD'
    );

    if (cartItem) {
      cartItem.quantity += 1;
    } else {
      cart.push({
        lineId: generateCartItemId(),
        id: product.id,
        name: product.nombre,
        quantity: 1, // unidades sueltas
        priceVes: product.precio_final_ves,
        priceUsd: product.precio_final_usd_bcv,
        stock: baseStock,        // referencia
        baseStock: baseStock,    // stock en unidades base
        tipo_venta: 'UNIDAD',
        presentationId: null,
        unidadesBase: 1,          // 1 unidad por venta
        exento_iva: product.exento_iva
      });
    }
    renderCart();
    resetSearch();
  }

  // NUEVO: añadir presentación (bulto, pack, etc.) PERMITIENDO mezclar
  async function addPresentationToCart(product, presentation) {
    const unitsPerPres = parseFloat(
      presentation.unidades_base || presentation.unidadesBase || 0
    );
    if (isNaN(unitsPerPres) || unitsPerPres <= 0) {
      await showGlobalAlert('La presentación seleccionada no tiene unidades base válidas.');
      return;
    }

    const baseStock = Number(product.stock) || 0;
    if (isNaN(baseStock) || baseStock <= 0) {
      await showGlobalAlert(`No hay stock disponible para ${product.nombre}.`);
      return;
    }

    const cartItem = cart.find(
      item => item.id === product.id && item.presentationId === presentation.id
    );

    const usedBaseExcludingThis = getProductBaseUsage(
      product.id,
      cartItem ? cartItem.lineId : null
    );
    const remainingBaseForThisLine = baseStock - usedBaseExcludingThis;
    const maxQuantityByStock = Math.floor(remainingBaseForThisLine / unitsPerPres);

    if (maxQuantityByStock <= 0) {
      await showGlobalAlert(
        `No hay stock suficiente para vender la presentación seleccionada de ${product.nombre}.`
      );
      return;
    }

    if (cartItem) {
      if (cartItem.quantity + 1 > maxQuantityByStock) {
        await showGlobalAlert(
          `No hay más stock disponible para ${product.nombre} - ${presentation.nombre || 'Presentación'}.`
        );
        return;
      }
      cartItem.quantity += 1;
      cartItem.stock = maxQuantityByStock;
    } else {
      const priceVes = parseFloat(
        presentation.precio_ves || presentation.precio_final_ves || 0
      );
      const priceUsd = parseFloat(
        presentation.precio_usd_bcv || presentation.precio_final_usd_bcv || 0
      );

      cart.push({
        lineId: generateCartItemId(),
        id: product.id,
        name: `${product.nombre} - ${presentation.nombre || 'Presentación'}`,
        quantity: 1,                     // cantidad de presentaciones
        priceVes: priceVes,              // precio POR PRESENTACIÓN en Bs
        priceUsd: priceUsd,              // precio POR PRESENTACIÓN en $
        stock: maxQuantityByStock,       // stock en número de presentaciones
        baseStock: baseStock,            // stock en unidades base
        tipo_venta: 'UNIDAD',
        presentationId: presentation.id, // distingue esta presentación
        presentationId: presentation.id, // distingue esta presentación
        unidadesBase: unitsPerPres,       // cuántas unidades base descuenta 1 presentación
        exento_iva: product.exento_iva
      });
    }

    renderCart();
    resetSearch();
  }

  async function addDecimalProductToCart(product, quantity) {
    const isDecimalType = product.tipo_venta === 'PESO' || product.tipo_venta === 'LITRO' || product.tipo_venta === 'METRO';
    if (!isDecimalType) return;

    const cartItem = cart.find(item => item.id === product.id && item.tipo_venta === product.tipo_venta);
    let newQuantity = quantity;

    if (cartItem) {
      newQuantity = cartItem.quantity + quantity;
    }

    if (newQuantity > product.stock) {
      const unit = product.tipo_venta === 'PESO' ? 'Kg' : (product.tipo_venta === 'LITRO' ? 'Lt' : 'Mt');
      await showGlobalAlert(`Stock insuficiente. Solo quedan ${product.stock} ${unit} de ${product.nombre}. Añadiendo stock máximo al carrito.`);
      newQuantity = product.stock;
    }

    if (cartItem) {
      cartItem.quantity = newQuantity;
    } else {
      cart.push({
        lineId: generateCartItemId(),
        id: product.id,
        name: product.nombre,
        quantity: newQuantity,
        priceVes: product.precio_final_ves,
        priceUsd: product.precio_final_usd_bcv,
        stock: product.stock,
        baseStock: Number(product.stock) || 0,
        tipo_venta: product.tipo_venta,
        presentationId: null,
        unidadesBase: 1,
        exento_iva: product.exento_iva
      });
    }

    renderCart();
    resetSearch();
  }

  function resetSearch() {
    searchInputPOS.value = '';
    currentSearchResults = [];
    renderSearchResults();
    searchInputPOS.focus();
  }

  async function updateCartItemQuantity(lineId, newQuantityStr) {
    const cartItem = cart.find(item => item.lineId === lineId);
    if (!cartItem) return;

    const quantity = parseFloat(newQuantityStr);
    const isDecimalType = cartItem.tipo_venta === 'PESO' || cartItem.tipo_venta === 'LITRO' || cartItem.tipo_venta === 'METRO';

    if (isNaN(quantity) || quantity <= 0) {
      removeProductFromCart(lineId);
      return;
    }

    if (!isDecimalType && quantity % 1 !== 0) {
      await showGlobalAlert("No se permiten decimales para productos vendidos por unidad.");
      cartItem.quantity = Math.floor(quantity);
      renderCart();
      return;
    }

    if (isDecimalType) {
      if (quantity > cartItem.stock) {
        cartItem.quantity = cartItem.stock;
        const unit = cartItem.tipo_venta === 'PESO' ? 'Kg' : (cartItem.tipo_venta === 'LITRO' ? 'Lt' : 'Mt');
        await showGlobalAlert(
          `Stock máximo para ${cartItem.name} es ${cartItem.stock} ${unit}.`
        );
      } else {
        cartItem.quantity = quantity;
      }
      renderCart();
      return;
    }

    const baseStock =
      typeof cartItem.baseStock === 'number'
        ? cartItem.baseStock
        : (Number(cartItem.stock) || Infinity);

    const unidadesBase = parseFloat(cartItem.unidadesBase || 1) || 1;
    const usedBaseOtherLines = getProductBaseUsage(cartItem.id, cartItem.lineId);
    const availableBase = baseStock === Infinity ? Infinity : (baseStock - usedBaseOtherLines);
    const maxQuantity =
      baseStock === Infinity
        ? quantity
        : Math.floor(availableBase / unidadesBase);

    let finalQuantity = quantity;

    if (baseStock !== Infinity && quantity * unidadesBase > availableBase) {
      if (maxQuantity <= 0) {
        await showGlobalAlert(`No hay stock suficiente para ${cartItem.name}.`);
        removeProductFromCart(lineId);
        return;
      }
      finalQuantity = maxQuantity;
      await showGlobalAlert(
        `Stock máximo para ${cartItem.name} es ${finalQuantity}.`
      );
    }

    cartItem.quantity = finalQuantity;
    renderCart();
  }

  function removeProductFromCart(lineId) {
    cart = cart.filter(item => item.lineId !== lineId);
    renderCart();
  }

  async function handleEditPrice(lineId) {
    const ctx = window.parent || window;
    let hasPermission = true;

    if (typeof ctx.askForAdminPassword === 'function') {
      hasPermission = await ctx.askForAdminPassword();
    }

    if (!hasPermission) return;

    const cartItem = cart.find(item => item.lineId === lineId);
    if (!cartItem) return;

    openPriceModal(cartItem);
  }

  // =========================
  // MODAL PVP (Editar Precio)
  // =========================

  function openPriceModal(cartItem) {
    currentPriceEditItem = cartItem;

    priceModalTitle.textContent = `Editar PVP - ${cartItem.name}`;

    const isDecimalType = cartItem.tipo_venta === 'PESO' || cartItem.tipo_venta === 'LITRO' || cartItem.tipo_venta === 'METRO';
    const quantity = parseFloat(cartItem.quantity || 1);
    const unitPriceVes = parseFloat(cartItem.priceVes || 0);
    let initialValueVes = 0;

    if (isDecimalType) {
      // Para productos por peso/litro/metro, mostramos el total de la línea (cantidad × precio unitario)
      const safeQuantity = quantity > 0 ? quantity : 1;
      initialValueVes = unitPriceVes * safeQuantity;
    } else {
      // Para productos por unidad o presentación, el precio es por unidad de venta (unidad o pack)
      initialValueVes = unitPriceVes;
    }

    priceModalCurrentCurrency = 'VES';
    if (priceModalCurrencySelect) {
      priceModalCurrencySelect.value = 'VES';
    }

    priceModalInput.value = initialValueVes > 0 ? initialValueVes.toFixed(2) : '';
    priceModalStatus.textContent = '';
    priceModalStatus.className = 'text-sm mt-2 text-center text-gray-600';

    priceModal.classList.remove('hidden');
    priceModalInput.focus();
    priceModalInput.select();
  }

  function closePriceModal() {
    priceModal.classList.add('hidden');
    currentPriceEditItem = null;
    priceModalInput.value = '';
    priceModalStatus.textContent = '';
  }

  function setPriceModalMessage(msg, type = 'info') {
    if (!priceModalStatus) return;
    priceModalStatus.textContent = msg;
    if (type === 'success') {
      priceModalStatus.className = 'text-sm mt-2 text-center text-green-600';
    } else if (type === 'error') {
      priceModalStatus.className = 'text-sm mt-2 text-center text-red-600';
    } else {
      priceModalStatus.className = 'text-sm mt-2 text-center text-gray-600';
    }
  }

  function handlePriceModalSubmit(e) {
    e.preventDefault();
    if (!currentPriceEditItem) {
      closePriceModal();
      return;
    }

    const rawValue = parseFloat(priceModalInput.value);
    if (isNaN(rawValue) || rawValue <= 0) {
      setPriceModalMessage('Por favor ingresa un precio válido mayor a 0.', 'error');
      return;
    }

    const selectedCurrency = priceModalCurrencySelect
      ? priceModalCurrencySelect.value
      : 'VES';

    const isPeso = currentPriceEditItem.tipo_venta === 'PESO';
    let valueInVes;

    if (selectedCurrency === 'USD_BCV') {
      if (!currentRates || typeof currentRates.BCV !== 'number' || currentRates.BCV <= 0) {
        setPriceModalMessage('No hay tasa BCV válida para convertir desde USD.', 'error');
        return;
      }
      valueInVes = rawValue * currentRates.BCV;
    } else {
      valueInVes = rawValue;
    }

    const bcv = (currentRates && currentRates.BCV > 0) ? currentRates.BCV : 0;

    if (isPeso) {
      // El usuario está editando el TOTAL de la línea (para X Kg)
      const quantity = parseFloat(currentPriceEditItem.quantity || 1);
      const safeQuantity = quantity > 0 ? quantity : 1;
      const newUnitPriceVes = valueInVes / safeQuantity;

      currentPriceEditItem.priceVes = newUnitPriceVes;
      currentPriceEditItem.priceUsd = bcv > 0 ? (newUnitPriceVes / bcv) : 0;
    } else {
      // UNIDAD o PRESENTACIÓN: el usuario edita el precio por unidad de venta
      currentPriceEditItem.priceVes = valueInVes;
      currentPriceEditItem.priceUsd = bcv > 0 ? (valueInVes / bcv) : 0;
    }

    setPriceModalMessage('Precio actualizado.', 'success');

    renderCart();

    setTimeout(() => {
      closePriceModal();
    }, 300);
  }

  // =========================
  // CÁLCULO TOTALES CARRITO
  // =========================

  function calculateCartTotals(items = cart) {
    let rawSum = 0;
    let totalTaxVes = 0;

    const ivaMode = (currentRates && currentRates.IVA_MODE === 'EXCLUDED') ? 'EXCLUDED' : 'INCLUDED';
    const ivaPercentage = (currentRates && currentRates.IVA_PERCENTAGE !== undefined) ? parseFloat(currentRates.IVA_PERCENTAGE) : 16.0;
    const ivaRate = ivaPercentage / 100;

    items.forEach(item => {
      const qty = parseFloat(item.quantity || 0);
      const price = parseFloat(item.priceVes || 0);
      const lineTotal = qty * price;
      rawSum += lineTotal;

      // Check exemption
      const isExempt = (item.exento_iva === 1 || item.exento_iva === true || item.exento_iva === '1');

      if (!isExempt) {
        if (ivaMode === 'EXCLUDED') {
          totalTaxVes += lineTotal * ivaRate;
        } else {
          const base = lineTotal / (1 + ivaRate);
          totalTaxVes += (lineTotal - base);
        }
      }
    });

    let totalVes = 0;
    let netSubtotalVes = 0;

    if (ivaMode === 'EXCLUDED') {
      totalVes = rawSum + totalTaxVes;
      netSubtotalVes = rawSum;
    } else {
      totalVes = rawSum;
      netSubtotalVes = rawSum - totalTaxVes;
    }

    return {
      netSubtotalVes,
      totalTaxVes,
      totalVes
    };
  }

  function calculateCartTotalVes() {
    return calculateCartTotals(cart).totalVes;
  }

  function calculateCartTotalFromItems(items) {
    if (!Array.isArray(items)) return 0;
    return calculateCartTotals(items).totalVes;
  }

  function calculateCartTotalUsd() {
    const bcvRate = (currentRates && currentRates.BCV > 0) ? currentRates.BCV : 1;
    const totalVes = calculateCartTotalVes();
    return totalVes / bcvRate;
  }

  function renderCart() {
    cartItemsDiv.innerHTML = '';
    let totalVes = 0;
    let totalUsd = 0;

    if (cart.length === 0) {
      cartEmptyMessage.classList.remove('hidden');
      btnCancelarVenta.disabled = true;
      btnPagar.disabled = true;
      if (btnHoldSale) btnHoldSale.disabled = true;
    } else {
      cartEmptyMessage.classList.add('hidden');
      btnCancelarVenta.disabled = false;
      btnPagar.disabled = false;
      if (btnHoldSale) btnHoldSale.disabled = false;

      cart.forEach(item => {
        const itemTotalVes = item.quantity * parseFloat(item.priceVes || 0);
        const itemTotalUsd = item.quantity * parseFloat(item.priceUsd || 0);
        totalVes += itemTotalVes;
        totalUsd += itemTotalUsd;

        const isPeso = item.tipo_venta === 'PESO';
        const isLitro = item.tipo_venta === 'LITRO';
        const isMetro = item.tipo_venta === 'METRO';
        const isDecimal = isPeso || isLitro || isMetro;

        const step = isDecimal ? '0.01' : '1';
        const min = isDecimal ? '0.01' : '1';
        const qtyDisplay = isDecimal ? Number(item.quantity).toFixed(3) : item.quantity;
        const maxAttr = isDecimal ? `max="${item.stock}"` : '';

        let unitLabel = '';
        if (isDecimal) {
          const suffix = isPeso ? 'Kg' : (isLitro ? 'Lt' : (isMetro ? 'Mt' : ''));
          unitLabel = ` (${qtyDisplay} ${suffix})`;
        }

        const div = document.createElement('div');
        div.className = "flex items-center space-x-2 border-b pb-2";
        div.innerHTML = `
        <span class="flex-1 font-medium text-gray-700 text-sm">
          ${item.name} ${unitLabel}
        </span>
        <input type="number"
               value="${item.quantity}"
               min="${min}"
               ${maxAttr}
               step="${step}"
               class="w-20 text-center border rounded quantity-input"
               data-line-id="${item.lineId}">
        <span class="w-28 text-right text-xs leading-tight">
            <span class="block font-semibold text-sm">${itemTotalVes.toFixed(2)} Bs</span>
            <span class="block text-gray-500">(${itemTotalUsd.toFixed(2)} $)</span>
          </span>
          <button class="text-xs text-blue-600 hover:underline edit-price-btn"
                   data-line-id="${item.lineId}">
            PVP
          </button>
          <button class="text-red-500 hover:text-red-700 remove-item-btn p-1"
                   data-line-id="${item.lineId}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        `;
        cartItemsDiv.appendChild(div);
      });
    }

    // Start of replacement
    // Overwrite totals with robust calculation
    const totals = calculateCartTotals(cart);
    totalVes = totals.totalVes;

    // Recalculate USD based on final VES total
    const bcvRate = (currentRates && currentRates.BCV > 0) ? currentRates.BCV : 1;
    totalUsd = totalVes / bcvRate;

    totalVesSpan.textContent = `${totalVes.toFixed(2)} Bs`;
    totalUsdSpan.textContent = `${totalUsd.toFixed(2)} $`;

    if (mobileTotalDisplay) {
      mobileTotalDisplay.textContent = `${totalUsd.toFixed(2)} $`;
    }

    // Update Subtotal/Tax visibility
    const subtotalContainer = document.getElementById('pos-subtotal-container');
    const subtotalVesSpan = document.getElementById('pos-subtotal-ves');
    const taxContainer = document.getElementById('pos-tax-container');
    const taxVesSpan = document.getElementById('pos-tax-ves');

    if (subtotalContainer && taxContainer && subtotalVesSpan && taxVesSpan) {
      if (totals.totalTaxVes > 0 && Math.abs(totals.totalTaxVes) > 0.001) {
        subtotalContainer.classList.remove('hidden');
        taxContainer.classList.remove('hidden');
        subtotalVesSpan.textContent = `${totals.netSubtotalVes.toFixed(2)} Bs`;
        taxVesSpan.textContent = `${totals.totalTaxVes.toFixed(2)} Bs`;
      } else {
        subtotalContainer.classList.add('hidden');
        taxContainer.classList.add('hidden');
      }
    }

    if (typeof updateMobileToggleUI === 'function') {
      updateMobileToggleUI();
    }

    addCartEventListeners();
  }

  function addCartEventListeners() {
    cartItemsDiv.querySelectorAll('.quantity-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const lineId = e.target.dataset.lineId;
        updateCartItemQuantity(lineId, e.target.value);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const lineId = e.target.dataset.lineId;
          updateCartItemQuantity(lineId, e.target.value);
        }
      });
    });

    cartItemsDiv.querySelectorAll('.remove-item-btn').forEach(button => {
      button.addEventListener('click', (e) => {
        const lineId = e.currentTarget.dataset.lineId;
        removeProductFromCart(lineId);
      });
    });

    cartItemsDiv.querySelectorAll('.edit-price-btn').forEach(button => {
      button.addEventListener('click', (e) => {
        const lineId = e.currentTarget.dataset.lineId;
        handleEditPrice(lineId);
      });
    });
  }

  async function cancelSale() {
    if (cart.length === 0) return;
    const confirmed = await showGlobalConfirm(
      '¿Estás seguro de que deseas cancelar esta venta y vaciar el carrito?',
      'Cancelar Venta'
    );
    if (!confirmed) return;

    cart = [];
    renderCart();
    searchInputPOS.value = '';
    currentSearchResults = [];
    renderSearchResults();
  }

  // =========================
  // VENTAS EN ESPERA
  // =========================

  // Nuevo flujo: primero se arma la venta pendiente y se abre el modal
  async function putSaleOnHold() {
    if (cart.length === 0) {
      await showGlobalAlert('No hay productos en el carrito para poner en espera.');
      return;
    }

    const totalVes = calculateCartTotalVes();
    const clienteId = selectedClientIdInput.value || null;
    const clienteNombreActual = selectedClientNameSpan.textContent || '';

    // Guardamos la venta pendiente
    pendingHoldSale = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      cart: cart.map(item => ({ ...item })),
      client: clienteId ? { id: parseInt(clienteId, 10), nombre: clienteNombreActual } : null,
      totalVes
    };

    // Si existe el modal de nombre, lo mostramos
    if (holdSaleClientModal && holdSaleClientNameInput) {
      const prefill = clienteNombreActual || '';
      holdSaleClientNameInput.value = prefill;
      if (holdSaleClientStatus) {
        holdSaleClientStatus.textContent = '';
        holdSaleClientStatus.className = 'text-sm mt-2 text-center text-gray-500';
      }
      holdSaleClientModal.classList.remove('hidden');
      holdSaleClientNameInput.focus();
    } else {
      // Fallback: si por alguna razón no existe el modal, se guarda directo como antes
      const heldSales = loadHeldSales();
      heldSales.push(pendingHoldSale);
      saveHeldSales(heldSales);

      await showGlobalAlert(
        'Venta puesta en espera. Puedes reanudarla desde "En Espera".',
        'Venta en espera'
      );

      pendingHoldSale = null;
      resetPOSState(false);
      resetClientSearch();
    }
  }

  function closeHoldSaleClientModal() {
    if (holdSaleClientModal) {
      holdSaleClientModal.classList.add('hidden');
    }
    if (holdSaleClientStatus) {
      holdSaleClientStatus.textContent = '';
      holdSaleClientStatus.className = 'text-sm mt-2 text-center text-gray-500';
    }
  }

  async function handleConfirmHoldSaleClient() {
    if (!pendingHoldSale) {
      closeHoldSaleClientModal();
      return;
    }

    let refName = '';
    if (holdSaleClientNameInput) {
      refName = holdSaleClientNameInput.value.trim();
    }

    if (!refName) {
      if (pendingHoldSale.client && pendingHoldSale.client.nombre) {
        refName = pendingHoldSale.client.nombre;
      } else {
        refName = 'Sin nombre';
      }
    }

    // Garantizamos que el objeto client exista y tenga nombre
    if (!pendingHoldSale.client) {
      pendingHoldSale.client = { id: null, nombre: refName };
    } else {
      pendingHoldSale.client.nombre = refName;
    }

    const heldSales = loadHeldSales();
    heldSales.push(pendingHoldSale);
    saveHeldSales(heldSales);

    pendingHoldSale = null;

    closeHoldSaleClientModal();

    await showGlobalAlert(
      'Venta puesta en espera. Puedes reanudarla desde "En Espera".',
      'Venta en espera'
    );

    resetPOSState(false);
    resetClientSearch();
  }

  function handleCancelHoldSaleClient() {
    pendingHoldSale = null;
    closeHoldSaleClientModal();
  }

  function openHeldSalesModal() {
    if (!holdSalesModal) return;
    const heldSales = loadHeldSales();
    renderHeldSalesList(heldSales);
    holdSalesStatus.textContent = heldSales.length === 0 ? 'No hay ventas en espera.' : '';
    holdSalesModal.classList.remove('hidden');
  }

  function closeHeldSalesModal() {
    if (!holdSalesModal) return;
    holdSalesModal.classList.add('hidden');
  }

  function renderHeldSalesList(heldSales) {
    if (!holdSalesList) return;
    holdSalesList.innerHTML = '';

    if (!heldSales || heldSales.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="4" class="px-4 py-3 text-center text-gray-500 text-sm">
          No hay ventas en espera.
        </td>
      `;
      holdSalesList.appendChild(tr);
      return;
    }

    heldSales
      .slice()
      .sort((a, b) => b.id - a.id)
      .forEach(sale => {
        const tr = document.createElement('tr');
        const d = sale.createdAt ? new Date(sale.createdAt) : new Date(sale.id);
        const fecha = isNaN(d.getTime())
          ? ''
          : d.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
        const cliente = sale.client && sale.client.nombre ? sale.client.nombre : 'Sin cliente';
        const total = typeof sale.totalVes === 'number'
          ? sale.totalVes
          : calculateCartTotalFromItems(sale.cart || []);

        tr.innerHTML = `
          <td class="px-4 py-2 text-sm text-gray-700 whitespace-nowrap">${fecha}</td>
          <td class="px-4 py-2 text-sm text-gray-700">${cliente}</td>
          <td class="px-4 py-2 text-sm text-gray-900 text-right whitespace-nowrap">${(total || 0).toFixed(2)} Bs</td>
          <td class="px-4 py-2 text-sm text-right whitespace-nowrap space-x-2">
            <button
              class="btn-resume-hold px-2 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700"
              data-hold-id="${sale.id}">
              Reanudar
            </button>
            <button
              class="btn-delete-hold px-2 py-1 text-xs bg-red-600 text-white rounded-md hover:bg-red-700"
              data-hold-id="${sale.id}">
              Eliminar
            </button>
          </td>
        `;
        holdSalesList.appendChild(tr);
      });
  }

  async function handleHoldSalesListClick(event) {
    const resumeBtn = event.target.closest('.btn-resume-hold');
    const deleteBtn = event.target.closest('.btn-delete-hold');

    if (resumeBtn) {
      const holdId = resumeBtn.dataset.holdId;
      await handleResumeHoldSale(holdId);
    } else if (deleteBtn) {
      const holdId = deleteBtn.dataset.holdId;
      await handleDeleteHoldSale(holdId);
    }
  }

  async function handleResumeHoldSale(holdId) {
    const heldSales = loadHeldSales();
    const idx = heldSales.findIndex(s => String(s.id) === String(holdId));
    if (idx === -1) return;

    if (cart.length > 0) {
      const confirmed = await showGlobalConfirm(
        'Actualmente tienes productos en el carrito. Si reanudas una venta en espera, se reemplazará el carrito actual. ¿Deseas continuar?',
        'Reanudar venta en espera'
      );
      if (!confirmed) return;
    }

    const hold = heldSales[idx];

    cart = (hold.cart || []).map(item => ({
      ...item,
      lineId: generateCartItemId(),
      presentationId: item.presentationId || null,
      unidadesBase: typeof item.unidadesBase === 'number' && item.unidadesBase > 0 ? item.unidadesBase : 1
    }));
    renderCart();

    if (hold.client && hold.client.id) {
      selectedClientIdInput.value = hold.client.id;
      selectedClientNameSpan.textContent = hold.client.nombre || 'Cliente';
      selectedClientDiv.classList.remove('hidden');
      clientSearchInput.classList.add('hidden');
    } else if (hold.client && hold.client.nombre) {
      // Si solo se guardó nombre manual, lo mostramos igual
      selectedClientIdInput.value = '';
      selectedClientNameSpan.textContent = hold.client.nombre;
      selectedClientDiv.classList.remove('hidden');
      clientSearchInput.classList.add('hidden');
    } else {
      resetClientSearch();
    }

    heldSales.splice(idx, 1);
    saveHeldSales(heldSales);
    renderHeldSalesList(heldSales);
    holdSalesStatus.textContent = heldSales.length === 0 ? 'No hay ventas en espera.' : '';

    closeHeldSalesModal();
    searchInputPOS.focus();
  }

  async function handleDeleteHoldSale(holdId) {
    const confirmed = await showGlobalConfirm(
      '¿Seguro que deseas eliminar esta venta en espera?',
      'Eliminar venta en espera'
    );
    if (!confirmed) return;

    const heldSales = loadHeldSales();
    const idx = heldSales.findIndex(s => String(s.id) === String(holdId));
    if (idx === -1) return;

    heldSales.splice(idx, 1);
    saveHeldSales(heldSales);
    renderHeldSalesList(heldSales);
    holdSalesStatus.textContent = heldSales.length === 0 ? 'No hay ventas en espera.' : '';
  }

  // =========================
  // PAGOS
  // =========================

  function resolveMethodRate(method) {
    if (method.moneda === 'VES') return 1.0;
    if (method.moneda === 'COP') {
      return (currentRates && currentRates.COP) ? parseFloat(currentRates.COP) : 1.0;
    }
    if (method.moneda === 'USD') {
      if (method.tipo_tasa === 'BCV') return currentRates.BCV || 1.0;
      if (method.tipo_tasa === 'PARALELO') return currentRates.PARALELO || 1.0;
      if (method.tipo_tasa === 'FIJA') return parseFloat(method.tasa_valor) || 1.0;
      if (method.tipo_tasa === 'PERSONALIZADA') {
        const customRate = window.customRatesList.find(r => r.key === method.tasa_personalizada_key);
        return customRate ? parseFloat(customRate.valor) : 1.0;
      }
    }
    return 1.0;
  }

  async function openPaymentModal() {
    if (cart.length === 0) return;
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert("Error: No se han cargado las tasas de cambio. Intenta recargar la página.");
      return;
    }
    const totalVes = calculateCartTotalVes();
    const totalUsd = calculateCartTotalUsd();
    modalTotalVesSpan.textContent = `${totalVes.toFixed(2)} Bs`;
    modalTotalUsdSpan.textContent = `(${totalUsd.toFixed(2)} $)`;
    
    // Renderizado dinámico de los campos de pago
    const container = document.getElementById('payment-methods-inputs-container');
    if (container) {
      container.innerHTML = '';
      window.activePaymentMethods.forEach(method => {
        const div = document.createElement('div');
        div.innerHTML = `
          <label for="pago-${method.key}" class="block text-sm font-medium text-gray-700">${method.nombre}</label>
          <div class="flex space-x-2">
            <input id="pago-${method.key}" type="number" step="0.01" data-key="${method.key}"
              class="pago-input mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 focus:ring-blue-500 focus:border-blue-500">
            <button type="button" class="btn-pago-todo mt-1 px-2 text-xs bg-gray-200 rounded hover:bg-gray-300" data-key="${method.key}">
              Todo
            </button>
          </div>
        `;
        container.appendChild(div);
      });

      // Bind input events to update summary
      const inputs = container.querySelectorAll('.pago-input');
      inputs.forEach(input => {
        input.addEventListener('input', updatePaymentSummary);
      });

      // Bind "Todo" buttons
      const todoBtns = container.querySelectorAll('.btn-pago-todo');
      todoBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const key = btn.dataset.key;
          setPagoTodoForMethod(key);
        });
      });
    }

    formPago.reset();

    // Reset rounding mode
    currentRoundingMode = 'NONE';
    setRoundingMode('NONE', true); // true = force update UI only

    updatePaymentSummary(); // Recalcula con el modo normal

    // Listeners para redondeo (si no se han agregado antes)
    const btnDown = document.getElementById('btn-round-down');
    const btnNone = document.getElementById('btn-round-none');
    const btnUp = document.getElementById('btn-round-up');

    // Remove old listeners to avoid duplicates
    const newBtnDown = btnDown.cloneNode(true);
    const newBtnNone = btnNone.cloneNode(true);
    const newBtnUp = btnUp.cloneNode(true);

    btnDown.parentNode.replaceChild(newBtnDown, btnDown);
    btnNone.parentNode.replaceChild(newBtnNone, btnNone);
    btnUp.parentNode.replaceChild(newBtnUp, btnUp);

    newBtnDown.addEventListener('click', () => setRoundingMode('DOWN'));
    newBtnNone.addEventListener('click', () => setRoundingMode('NONE'));
    newBtnUp.addEventListener('click', () => setRoundingMode('UP'));

    if (saleNotaInput) saleNotaInput.value = '';

    paymentModal.classList.remove('hidden');
    
    // Auto-focus en el primer campo de pago dinámico
    if (container) {
      const firstInput = container.querySelector('.pago-input');
      if (firstInput) {
        setTimeout(() => {
          firstInput.focus();
        }, 100);
      }
    }
  }

  function setRoundingMode(mode, skipUpdate = false) {
    currentRoundingMode = mode;

    const btnDown = document.getElementById('btn-round-down');
    const btnNone = document.getElementById('btn-round-none');
    const btnUp = document.getElementById('btn-round-up');

    // Reset styles
    if (btnDown) btnDown.className = "px-2 py-0.5 rounded text-xs font-bold text-gray-600 hover:bg-white hover:text-red-600 transition-colors";
    if (btnNone) btnNone.className = "px-2 py-0.5 rounded text-xs font-bold text-gray-600 hover:bg-white hover:text-blue-600 transition-colors";
    if (btnUp) btnUp.className = "px-2 py-0.5 rounded text-xs font-bold text-gray-600 hover:bg-white hover:text-green-600 transition-colors";

    // Set active style
    if (mode === 'DOWN' && btnDown) {
      btnDown.className = "px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 border border-red-300 shadow-inner";
    } else if (mode === 'NONE' && btnNone) {
      btnNone.className = "px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-700 border border-blue-300 shadow-inner";
    } else if (mode === 'UP' && btnUp) {
      btnUp.className = "px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700 border border-green-300 shadow-inner";
    }

    if (!skipUpdate) {
      updatePaymentSummary();
    }
  }

  function getRoundedTotal(amount) {
    if (currentRoundingMode === 'UP') {
      return Math.ceil(amount / ROUNDING_STEP) * ROUNDING_STEP;
    } else if (currentRoundingMode === 'DOWN') {
      return Math.floor(amount / ROUNDING_STEP) * ROUNDING_STEP;
    }
    return amount;
  }

  function getGoalTotalVes() {
    if (currentCasheaData) {
      const bcv = currentRates?.BCV || 1;
      return currentCasheaData.monto_inicial_usd * bcv;
    }
    const { totalVes } = calculateCartTotals();
    return getRoundedTotal(totalVes);
  }
  
  function closePaymentModal() {
    paymentModal.classList.add('hidden');
  }

  function updatePaymentSummary() {
    const banner = document.getElementById('cashea-active-banner');
    const initialAmtDisplay = document.getElementById('cashea-initial-amount-display');
    
    if (currentCasheaData) {
      if (banner) banner.classList.remove('hidden');
      if (initialAmtDisplay) initialAmtDisplay.textContent = currentCasheaData.monto_inicial_usd.toFixed(2);
    } else {
      if (banner) banner.classList.add('hidden');
    }

    if (!currentRates || typeof currentRates.BCV !== 'number' || currentRates.BCV <= 0) {
      console.error("updatePaymentSummary: BCV rate is invalid.");
      btnCompletarVenta.disabled = true;
      btnGuardarFiado.disabled = true;
      return;
    }

    // 1. Calcular total real y redondeado
    const totalAPagarVes = getGoalTotalVes();

    // Actualizar UI con el total exigible
    if (currentCasheaData) {
      modalTotalVesSpan.innerHTML = `${totalAPagarVes.toFixed(2)} Bs <span class="text-[10px] block text-blue-500 font-bold uppercase tracking-tighter">Plan Cashea Confirmado: Solo Inicial</span>`;
    } else {
      modalTotalVesSpan.textContent = `${totalAPagarVes.toFixed(2)} Bs`;
    }

    let totalPagadoVes = 0;
    const inputs = document.querySelectorAll('.pago-input');
    inputs.forEach(input => {
      const val = parseFloat(input.value) || 0;
      if (val > 0) {
        const key = input.dataset.key;
        const method = window.activePaymentMethods.find(m => m.key === key);
        if (method) {
          const rate = resolveMethodRate(method);
          totalPagadoVes += val * rate;
        }
      }
    });

    const diferencia = totalPagadoVes - totalAPagarVes;
    const usdDiferencia = diferencia / currentRates.BCV;
    const estaPagado = (diferencia >= -0.5) || (usdDiferencia >= -0.05);

    faltanteContainer.classList.add('hidden');
    vueltoContainer.classList.add('hidden');
    faltanteContainer.classList.remove('text-red-600', 'text-orange-600');
    vueltoContainer.classList.remove('text-green-600');

    const clienteSeleccionado = !!selectedClientIdInput.value;

    if (!estaPagado) {
      const faltanteVes = Math.abs(diferencia);
      const faltanteUsd = faltanteVes / currentRates.BCV;
      modalFaltanteVesSpan.textContent = `${faltanteVes.toFixed(2)} Bs`;
      modalFaltanteUsdSpan.textContent = `(${faltanteUsd.toFixed(2)} $)`;
      faltanteContainer.classList.remove('hidden');
      faltanteContainer.classList.add(totalPagadoVes > 0 ? 'text-orange-600' : 'text-red-600');

      btnCompletarVenta.disabled = true;
      btnGuardarFiado.disabled = !clienteSeleccionado;
      totalChangeDueVes = 0;
    } else {
      // Si la diferencia es positiva y supera los 0.5 Bs y además el equivalente a 0.05 USD, hay vuelto real
      const vueltoVes = (diferencia > 0.5 && usdDiferencia > 0.05) ? diferencia : 0;
      const roundedVueltoVes = vueltoVes;
      totalChangeDueVes = roundedVueltoVes; // 🔹 FIX: Update global variable
      const vueltoUsd = roundedVueltoVes / currentRates.BCV;

      if (roundedVueltoVes > 0) {
        modalVueltoVesSpan.textContent = `${roundedVueltoVes.toFixed(2)} Bs`;
        modalVueltoUsdSpan.textContent = `(${vueltoUsd.toFixed(2)} $)`;
        vueltoContainer.classList.remove('hidden');
        vueltoContainer.classList.add('text-green-600');
      } else {
        vueltoContainer.classList.add('hidden');
      }

      btnCompletarVenta.disabled = false;
      btnGuardarFiado.disabled = true; // No tiene sentido fiar si ya pagó
    }
  }

  function setPagoTodoForMethod(key) {
    const method = window.activePaymentMethods.find(m => m.key === key);
    if (!method) return;

    const goalTotalVes = getGoalTotalVes();
    let alreadyPaidVes = 0;
    const inputs = document.querySelectorAll('.pago-input');
    inputs.forEach(input => {
      const inputKey = input.dataset.key;
      if (inputKey !== key) {
        const val = parseFloat(input.value) || 0;
        if (val > 0) {
          const otherMethod = window.activePaymentMethods.find(m => m.key === inputKey);
          if (otherMethod) {
            alreadyPaidVes += val * resolveMethodRate(otherMethod);
          }
        }
      }
    });

    const restanteVes = Math.max(0, goalTotalVes - alreadyPaidVes);
    const rate = resolveMethodRate(method);
    const targetInput = document.getElementById(`pago-${key}`);
    if (targetInput) {
      targetInput.value = (restanteVes / rate).toFixed(2);
      updatePaymentSummary();
    }
  }

  /**
   * Codifica una cadena a bytes (solo caracteres de un byte para evitar errores de UTF-8 en impresoras)
   */
  function encodeToSingleByte(str) {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      // Mapa básico para caracteres comunes en español
      if (code < 128) bytes[i] = code;
      else if (code === 241) bytes[i] = 164; // ñ
      else if (code === 209) bytes[i] = 165; // Ñ
      else if (code === 225) bytes[i] = 160; // á
      else if (code === 233) bytes[i] = 130; // é
      else if (code === 237) bytes[i] = 161; // í
      else if (code === 243) bytes[i] = 162; // ó
      else if (code === 250) bytes[i] = 163; // ú
      else bytes[i] = 32; // Espacio para desconocidos
    }
    return bytes;
  }

  /**
   * Convierte una imagen a ESC/POS Raster Bit Image (GS v 0) con ancho fijo para evitar distorsión.
   * Usamos 384 puntos como estándar (48 bytes, coincide con los 48 caracteres del ticket).
   */
  async function logoToEscPos(url, fixedWidth = 384) {
    return new Promise((resolve) => {
      const img = new Image();
      if (!url.startsWith('data:')) {
        img.crossOrigin = 'Anonymous';
      }
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false; // Importante para que el QR sea nítido

        // Asegurar ancho múltiplo de 8 para evitar errores de alineación
        const w = Math.floor(fixedWidth / 8) * 8;
        const widthBytes = w / 8;

        // Calcular alto proporcional
        const scale = w / img.width;
        const h = Math.floor(img.height * scale);

        canvas.width = w;
        canvas.height = h;

        // Fondo blanco y dibujo centrado si fuera menor (en este caso lo escalamos)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        const bitMap = new Uint8Array(widthBytes * h);

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const alpha = data[idx + 3];

            // Si es transparente o casi blanco, lo ignoramos
            if (alpha < 10) continue;

            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

            // Umbral alto (230) para capturar el naranja y otros colores claros como negro
            if (luminance < 230) {
              const byteIdx = y * widthBytes + (x >> 3);
              const bit = 0x80 >> (x % 8);
              bitMap[byteIdx] |= bit;
            }
          }
        }

        // Construimos el comando GS v 0 m xL xH yL yH
        const xL = widthBytes & 0xFF;
        const xH = (widthBytes >> 8) & 0xFF;
        const yL = h & 0xFF;
        const yH = (h >> 8) & 0xFF;

        const centerCmd = [0x1B, 0x61, 0x01];
        const header = [0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH];
        const reset = [0x1B, 0x61, 0x00]; // Volver a izquierda únicamente

        const result = new Uint8Array(centerCmd.length + header.length + bitMap.length + reset.length);
        let offset = 0;
        [centerCmd, header, bitMap, reset].forEach(chunk => {
          result.set(chunk, offset);
          offset += chunk.length;
        });

        resolve(result);
      };
      img.onerror = (err) => {
        console.error('Error cargando logo para ESC/POS:', err);
        resolve(null);
      };
      img.src = url;
    });
  }

  // Helper para cortar o rellenar texto a un ancho fijo
  function trunc(text, width) {
    text = (text || '').toString();
    if (text.length > width) return text.slice(0, width);
    return text;
  }

  function formatLine(left, right, width) {
    left = (left || '').toString();
    right = (right || '').toString();
    const totalLen = left.length + right.length;
    if (totalLen >= width) {
      // Si se pasa, recortamos el lado izquierdo
      left = left.slice(0, Math.max(0, width - right.length - 1));
      return (left + ' ' + right).slice(0, width);
    }
    const spaces = width - totalLen;
    return left + ' '.repeat(spaces) + right;
  }

  // Ticket ESC/POS "bonito" pero genérico
  function formatPriceStr(num) {
    return num.toFixed(2).replace('.', ',');
  }

  // Ticket ESC/POS idéntico al solicitado
  function buildSimpleTextTicket({
    saleId,
    cart,
    totalVes,
    totalUsd,
    payments,
    header,
    footer,
    ticketSize,
    impuesto_total = 0,
    cliente = null,
    serverBizInfo = {}
  }) {
    const width = ticketSize === 58 ? 32 : 48; // Estándar ajustado a 48 para 7.2cm en 80mm
    const line = '-'.repeat(width);
    let text = '';

    const clientRif = (cliente && (cliente.rif || cliente.cedula)) ? (cliente.rif || cliente.cedula) : 'V-000000000';
    const clientName = (cliente && cliente.nombre) ? cliente.nombre.toUpperCase() : 'AL MAYOR / CONSUMIDOR FINAL';
    const clientDir = (cliente && cliente.direccion && cliente.direccion !== 'N/A') ? cliente.direccion.toUpperCase() : 'N/A';
    const clientPhone = (cliente && cliente.telefono && cliente.telefono !== 'N/A') ? cliente.telefono : 'N/A';

    const headerLines = (header || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const bsName = headerLines.length > 0 ? headerLines[0] : 'DISTRIBUIDORA FANTASY CEL';

    // 1. Mostrar texto del negocio configurado centrado
    if (headerLines.length > 0) {
      headerLines.forEach(l => {
        text += ' '.repeat(Math.max(0, Math.floor((width - l.length) / 2))) + l.toUpperCase() + '\n';
      });
    }

    // 1.2. Información del negocio extra (from server response or appSettings fallback)
    const appS = window.parent?.appSettings || window.appSettings || {};
    const bizRIF = serverBizInfo.businessRIF || appS.businessRIF || '';
    const bizAddr = serverBizInfo.businessAddress || appS.businessAddress || '';
    const bizPhone = serverBizInfo.businessPhone || appS.businessPhone || '';

    if (bizRIF) text += ' '.repeat(Math.max(0, Math.floor((width - bizRIF.length - 5) / 2))) + `RIF: ${bizRIF.toUpperCase()}\n`;
    if (bizAddr) {
      const addrLines = bizAddr.split('\n');
      addrLines.forEach(l => {
        text += ' '.repeat(Math.max(0, Math.floor((width - l.length) / 2))) + l.toUpperCase() + '\n';
      });
    }
    if (bizPhone) text += ' '.repeat(Math.max(0, Math.floor((width - bizPhone.length - 5) / 2))) + `TEL: ${bizPhone}\n`;

    if (headerLines.length === 0 && !bizRIF && !bizAddr && !bizPhone) {
      const hddef = 'SENIAT\nRIF J-000000000\nMI NEGOCIO CA\nCALLE PRINCIPAL S/N\nESTADO';
      hddef.split('\n').forEach(l => {
        text += ' '.repeat(Math.max(0, Math.floor((width - l.length) / 2))) + l + '\n';
      });
    }
    text += '\n';

    // 2. Información fija inferior (Cliente u genérico)
    text += `RIF/C.I.: ${clientRif}\n`;
    
    // Razón Social Multilínea
    const labelRS = "RAZON SOCIAL: ";
    let currentRS = clientName.toUpperCase();
    if (labelRS.length + currentRS.length > width) {
        text += labelRS + '\n';
        const wordsRS = currentRS.split(' ');
        let lineRS = '';
        wordsRS.forEach(w => {
            if ((lineRS + w).length < width) {
                lineRS += (lineRS ? ' ' : '') + w;
            } else {
                if (lineRS) text += lineRS + '\n';
                lineRS = w;
            }
        });
        if (lineRS) text += lineRS + '\n';
    } else {
        text += labelRS + currentRS + '\n';
    }

    // Dirección Multilínea
    const labelDir = "DIRECCION: ";
    let currentDir = clientDir.toUpperCase();
    if (labelDir.length + currentDir.length > width) {
        text += labelDir + '\n';
        const wordsDir = currentDir.split(' ');
        let lineDir = '';
        wordsDir.forEach(w => {
            if ((lineDir + w).length < width) {
                lineDir += (lineDir ? ' ' : '') + w;
            } else {
                if (lineDir) text += lineDir + '\n';
                lineDir = w;
            }
        });
        if (lineDir) text += lineDir + '\n';
    } else {
        text += labelDir + currentDir + '\n';
    }

    text += `TELEFONO: ${clientPhone}\n`;
    text += `Ref. Interna: ${String(saleId).padStart(10, '0')}\n`;
    text += `Vendedor: 01\n`;
    text += ' '.repeat(Math.max(0, Math.floor((width - 6) / 2))) + 'RECIBO\n\n';

    const now = new Date();
    const fStr = ('0' + now.getDate()).slice(-2) + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + now.getFullYear();
    const hStr = now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

    text += formatLine(`RECIBO:`, String(saleId).padStart(8, '0'), width) + '\n';
    text += formatLine(`FECHA: ${fStr}`, `HORA: ${hStr}`, width) + '\n';
    text += line + '\n';

    let subtotal = 0;
    cart.forEach(item => {
      const isExempt = (item.exento_iva === 1 || item.exento_iva === true || item.exento_iva === '1');
      const indicator = isExempt ? '(E)' : '(G)';
      const name = (item.nombre || item.name || `Prod ${item.id}`).toUpperCase() + ` ${indicator}`;
      
      // Multi-line name support (identificamos palabras y distribuimos en lineas segun el ancho)
      const words = name.split(' ');
      let currentNameLine = '';
      words.forEach(word => {
        if ((currentNameLine + word).length < width) {
          currentNameLine += (currentNameLine ? ' ' : '') + word;
        } else {
          if (currentNameLine) text += currentNameLine + '\n';
          currentNameLine = word;
        }
      });
      if (currentNameLine) text += currentNameLine + '\n';

      const qty = Number(item.quantity || 0);
      const priceVes = Number(item.priceVes || 0);
      const totalItem = qty * priceVes;
      subtotal += totalItem;

      const qtyStr = Number(item.quantity || 0).toFixed(2).replace('.', ',');
      const priceStr = formatPriceStr(priceVes);
      
      const bcv = currentRates && currentRates.BCV ? currentRates.BCV : 1;
      const totalItemUsd = totalItem / bcv;

      const leftPart = `${qtyStr} x ${priceStr}`;
      const rightPart = `Bs ${formatPriceStr(totalItem)} ($ ${totalItemUsd.toFixed(2)})`;
      text += formatLine(leftPart, rightPart, width) + '\n';
    });

    text += line + '\n';
    text += formatLine('SUBTTL', `Bs ${formatPriceStr(subtotal)}`, width) + '\n';
    text += formatLine('SUBTTL ($)', `$ ${Number(subtotal / (currentRates.BCV || 1)).toFixed(2)}`, width) + '\n';
    text += line + '\n';

    if (impuesto_total > 0) {
      const base = Math.max(0, subtotal - impuesto_total);
      const lBase = `BI G16,00%`;
      const valBase = `Bs ${formatPriceStr(base)}`;
      const lIva = `IVA G16,00%`;
      const valIva = `Bs ${formatPriceStr(impuesto_total)}`;

      if (width >= 48) {
        const p1 = lBase + ' '.repeat(Math.max(1, 16 - lBase.length)) + valBase.padStart(10);
        const p2 = lIva + ' '.repeat(Math.max(1, 14 - lIva.length)) + valIva.padStart(9);
        text += (p1 + '  ' + p2).slice(0, width) + '\n';
      } else {
        text += formatLine(lBase, valBase, width) + '\n';
        text += formatLine(lIva, valIva, width) + '\n';
      }
      text += line + '\n';
    }

    payments.forEach(p => {
      let m = p.method === 'VES_EFECTIVO' ? 'EFECTIVO' :
        p.method === 'USD_EFECTIVO' ? 'EFE DIVISA' :
          p.method === 'PUNTO_VENTA' ? 'PUNTO' :
            p.method === 'BIOPAGO' ? 'BIOPAGO' :
              p.method === 'TARJETA' ? 'TARJETA' :
                p.method === 'PAGOMOVIL' ? 'PAGOMOVIL' : p.method;
      text += formatLine(m, `Bs ${formatPriceStr(Number(p.amountInVes))}`, width) + '\n';
    });

    text += line + '\n';
    text += formatLine('TOTAL', `Bs ${formatPriceStr(totalVes)}`, width) + '\n';
    text += formatLine('TOTAL ($)', `$ ${Number(totalUsd).toFixed(2)}`, width) + '\n';

    const hash = 'Z' + Math.random().toString(36).substring(2, 6).toUpperCase() + String(saleId).padStart(4, '0');
    text += hash.padStart(width, ' ') + '\n';

    const GS = '\x1D';
    // MODO FEED AND CUT (65): Avanza el papel la distancia exacta hasta la cuchilla y corta.
    // Esto evita dejar papel en blanco para la siguiente factura (que causaba el "padding gigante" arriba)
    const CUT_FEED = GS + 'V' + '\x41' + '\x00';

    let finalOutput = text;

    finalOutput += '{{QR_CODE}}';

    const footerLines = (footer || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
    footerLines.forEach(l => {
      finalOutput += ' '.repeat(Math.max(0, Math.floor((width - l.length) / 2))) + l + '\n';
    });
    finalOutput += '\n' + ' '.repeat(Math.max(0, Math.floor((width - 19) / 2))) + 'DOCUMENTO NO FISCAL\n';

    // Usamos el corte con avance dinámico
    finalOutput += CUT_FEED;
    return finalOutput;
  }


  async function completeSale(isCreditSale = false) {
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert("Error: Las tasas de cambio no están cargadas. No se puede completar la venta.");
      return;
    }

    updatePaymentSummary();

    // 1. Calcular totales reales y redondeados
    const rawTotalVes = calculateCartTotalVes();
    const totalAPagarVes = getRoundedTotal(rawTotalVes); // Total exigible

    // Diferencia por redondeo: 
    // Si < 0: Redondeo abajo (Descuento implícito)
    // Si > 0: Redondeo arriba (Cargo extra implícito)
    const roundingAdjustment = totalAPagarVes - rawTotalVes;

    let totalPagadoVes = 0;
    const payments = [];
    const tasaBcvMomento = currentRates.BCV;

    const inputs = document.querySelectorAll('.pago-input');
    inputs.forEach(input => {
      const val = parseFloat(input.value) || 0;
      if (val > 0) {
        const key = input.dataset.key;
        const method = window.activePaymentMethods.find(m => m.key === key);
        if (method) {
          const rate = resolveMethodRate(method);
          payments.push({
            method: key,
            amountReceived: val,
            amountInVes: val * rate
          });
          totalPagadoVes += val * rate;
        }
      }
    });

    // --- NUEVO: SOPORTE CASHEA ---
    if (currentCasheaData) {
      const bcv = currentRates.BCV || 1;
      // El monto que cubre Cashea es el total financiado (Total - Inicial)
      const financedAmountVes = (currentCasheaData.monto_total_usd - currentCasheaData.monto_inicial_usd) * bcv;
      
      payments.push({
        method: 'CASHEA',
        amountReceived: financedAmountVes,
        amountInVes: financedAmountVes
      });
      totalPagadoVes += financedAmountVes;
    }

    console.log(`[DEBUG] completSale START. isCreditSale=${isCreditSale}`);
    // Calcular pendiente usando el total exigible (redondeado)
    const montoPendienteVes = Math.max(0, totalAPagarVes - totalPagadoVes);
    const clienteId = selectedClientIdInput.value || null;

    if (isCreditSale && !clienteId) {
      await showGlobalAlert("Error: Debe seleccionar un cliente para guardar una venta a crédito.");
      return;
    }

    const usdPendiente = montoPendienteVes / currentRates.BCV;
    const estaPendienteCubierto = (montoPendienteVes <= 0.50) || (usdPendiente <= 0.05);

    // Permitimos tolerancia de 0.50 Bs o 0.05 USD por el redondeo
    if (!isCreditSale && !estaPendienteCubierto) {
      await showGlobalAlert(`Error: El monto pagado no cubre el total de la venta. Faltan ${montoPendienteVes.toFixed(2)} Bs.`);
      updatePaymentSummary();
      return;
    }

    btnCompletarVenta.disabled = true;
    btnGuardarFiado.disabled = true;
    // mostrarMensajeModal('Procesando venta...', 'info'); // Removed to prevent error if undefined

    // OJO: calculamos el USD basado en el total ya redondeado a pagar,
    // de lo contrario la leve diferencia de redondeo lo tratará como venta incompleta (fiado)
    const bcvRate = (currentRates && currentRates.BCV > 0) ? currentRates.BCV : 1;
    const totalUsd = totalAPagarVes / bcvRate;

    const saleData = {
      cart: cart.map(item => {
        const unidadesBase = parseFloat(item.unidadesBase || 1) || 1;

        if (item.tipo_venta === 'PESO' || item.tipo_venta === 'LITRO' || item.tipo_venta === 'METRO') {
          return {
            id: item.id,
            quantity: item.quantity,
            priceVes: item.priceVes,
            name: item.name,
            exento_iva: item.exento_iva,
            costVes: item.costVes
          };
        }

        // Si NO es una presentación, enviamos la cantidad neta (1 unidad = 1 unidad)
        if (!item.presentationId) {
          return {
            id: item.id,
            quantity: item.quantity,
            priceVes: item.priceVes,
            name: item.name,
            exento_iva: item.exento_iva,
            costVes: item.costVes
          };
        }

        // Si es una presentación, calculamos la cantidad base (ej. 2 cajas de 12 = 24 unidades base)
        // Esto ahora funciona correctamente incluso para presentaciones de menos de 1 unidad base (ej. 0.5)
        const baseQuantity = item.quantity * unidadesBase;
        const unitPriceVes = item.priceVes / unidadesBase;

        return {
          id: item.id,
          quantity: baseQuantity,
          priceVes: unitPriceVes,
          name: item.name,
          exento_iva: item.exento_iva,
          costVes: (item.costVes || 0) / unidadesBase
        };
      }),
      payments,
      totalVes: totalAPagarVes, // Enviamos el total redondeado como el "total esperado"
      rawTotalVes: rawTotalVes, // Enviamos el total original por si acaso
      roundingAdjustment: roundingAdjustment, // Enviamos el ajuste explícitamente
      totalUsd: totalUsd,
      cliente_id: clienteId ? parseInt(clienteId, 10) : null,
      nota: saleNotaInput ? saleNotaInput.value.trim() : null
    };

    try {
      const response = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saleData),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error desconocido al completar la venta');

      lastCompletedSaleId = result.saleId;

      // --- NUEVO: REGISTRAR PLAN CASHEA EN DB ---
      if (currentCasheaData) {
        try {
          await fetch('/api/cashea', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              venta_id: result.saleId,
              ...currentCasheaData
            })
          });
          // Limpiar estado cashea
          currentCasheaData = null;
          if (document.getElementById('cashea-active-banner')) {
            document.getElementById('cashea-active-banner').classList.add('hidden');
          }
        } catch (err) {
          console.error('Error al registrar plan Cashea:', err);
          showGlobalAlert('La venta se guardó, pero hubo un error al registrar las cuotas de Cashea. Por favor verifique manualmente.');
        }
      }

      const {
        printTicket = false,
        printerName = '',
        printCopies = 1,
        ticketSize = 80,
        printHeader = '',
        printFooter = '',
        printMode = 'direct'
      } = result;

      // Usamos el contexto padre si existe (iframe) o el actual si no
      const ctx = (window.parent && window.parent !== window) ? window.parent : window;

      if (printTicket && printMode === 'preview' && typeof ctx.showTicketPreview === 'function') {
        ctx.showTicketPreview(result.saleId);
      }

      // mostrarMensajeModal(`¡Venta #${result.saleId} completada!`, 'success'); // Handled by modals

      closePaymentModal();

      let directOk = null; // null => no aplica, true => ok, false => fallo

      if (printTicket && printMode === 'direct') {
        const ep = ctx.electronPrinter;

        // --- PUENTE DE IMPRESIÓN UNIVERSAL (Local o Remota) ---
        const universalPrinter = {
          printTextTicket: async (opts) => {
            if (ep && typeof ep.printTextTicket === 'function') {
              return await ep.printTextTicket(opts);
            } else {
              // Fallback a API Remota (Celulares)
              console.log('[REMOTE] Intentando impresión remota...');
              try {
                const resp = await fetch('/api/print/remote', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ type: 'text', options: opts })
                });
                return await resp.json();
              } catch (err) {
                return { ok: false, error: 'No se pudo conectar con la impresora remota: ' + err.message };
              }
            }
          }
        };

        try {
          const textTicket = buildSimpleTextTicket({
            saleId: result.saleId,
            cart,
            totalVes: totalAPagarVes,
            totalUsd,
            payments,
            header: printHeader,
            footer: printFooter,
            ticketSize,
            impuesto_total: result.impuesto_total || 0,
            cliente: result.cliente || currentClient,
            serverBizInfo: {
              businessRIF: result.businessRIF || '',
              businessAddress: result.businessAddress || '',
              businessPhone: result.businessPhone || ''
            }
          });

          // Use server-returned settings (authoritative) with fallback to appSettings cache
          const appS = (window.parent && window.parent.appSettings) ? window.parent.appSettings : (window.appSettings || {});
          const logoPath = result.logoPath || appS.logoPath || '';
          const shouldPrintLogo = result.printLogo !== undefined ? result.printLogo : (appS.printLogo !== false);
          const shouldPrintQr = result.printQr !== undefined ? result.printQr : (appS.printQr !== false);
          const qrContent = result.printQrContent || appS.printQrContent || 'https://bodegapp.com.ve';

          let logoBytes = new Uint8Array(0);
          let qrBytes = new Uint8Array(0);

          if (shouldPrintLogo && logoPath) {
            try {
              // Reducimos el logo a la mitad (192 puntos = 24mm)
              const lb = await logoToEscPos(logoPath, 192);
              if (lb) logoBytes = lb;
            } catch (e) { console.warn('Logo error:', e); }
          }
          if (shouldPrintQr) {
            // Generar comandos nativos ESC/POS para el QR (GS ( k)
            // Model 2, Size 6, Error Correction L
            const qrText = qrContent;
            const qrLen = qrText.length + 3;
            const pL = qrLen & 0xFF;
            const pH = (qrLen >> 8) & 0xFF;

            const qrCmds = new Uint8Array([
              0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // Modelo 2
              0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06,       // Tamaño 6
              0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30,       // Error Correction L
              0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30            // Store data (30)
            ]);

            const qrData = encodeToSingleByte(qrText);
            const qrPrint = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]); // Print data (51)

            qrBytes = new Uint8Array(qrCmds.length + qrData.length + qrPrint.length + 4); // +4 para saltos de línea extra alrededor del QR
            let qOffset = 0;
            qrBytes.set([0x0A], qOffset++); // Salto antes
            qrBytes.set(qrCmds, qOffset); qOffset += qrCmds.length;
            qrBytes.set(qrData, qOffset); qOffset += qrData.length;
            qrBytes.set(qrPrint, qOffset); qOffset += qrPrint.length;
            qrBytes.set([0x0A, 0x0A, 0x0A], qOffset); // Saltos después
          }

          const textParts = textTicket.split('{{QR_CODE}}');
          const part1 = textParts[0] || '';
          const part2 = textParts[1] || '';

          const part1Bytes = encodeToSingleByte(part1);
          const part2Bytes = encodeToSingleByte(part2);

          const INIT = new Uint8Array([0x1B, 0x40]);
          const CENTER = new Uint8Array([0x1B, 0x61, 0x01]);
          const LEFT = new Uint8Array([0x1B, 0x61, 0x00]);

          const totalSize = INIT.length +
            (logoBytes.length ? (CENTER.length + logoBytes.length + LEFT.length) : 0) +
            part1Bytes.length +
            (qrBytes.length ? (CENTER.length + qrBytes.length + LEFT.length) : 0) +
            part2Bytes.length;

          const combined = new Uint8Array(totalSize);
          let offset = 0;

          combined.set(INIT, offset); offset += INIT.length;

          // 1. Logo
          if (logoBytes.length) {
            combined.set(CENTER, offset); offset += CENTER.length;
            combined.set(logoBytes, offset); offset += logoBytes.length;
            combined.set(LEFT, offset); offset += LEFT.length;
          }

          // 2. Texto Parte 1
          combined.set(part1Bytes, offset); offset += part1Bytes.length;

          // 3. QR
          if (qrBytes.length) {
            combined.set(CENTER, offset); offset += CENTER.length;
            combined.set(qrBytes, offset); offset += qrBytes.length;
            combined.set(LEFT, offset); offset += LEFT.length;
          }

          // 4. Texto Parte 2
          combined.set(part2Bytes, offset); offset += part2Bytes.length;

          console.log('Enviando buffer total:', combined.length, 'bytes');
          const printResp = await universalPrinter.printTextTicket({
            printerName: printerName || undefined,
            type: 'RAW',
            binary: Array.from(combined),
            text: '' // Avoid "No hay contenido" error
          });
          directOk = !!(printResp && printResp.ok);

          if (!directOk) {
            console.error('Error impresión:', printResp && printResp.error);
            await showGlobalAlert('Error al imprimir el ticket: ' + (printResp ? printResp.error : 'Fallo desconocido'));
          }
        } catch (e) {
          console.error('Excepción impresión:', e);
          directOk = false;
          await showGlobalAlert('Ocurrió un error al enviar el ticket a la impresora.');
        }
      }


      console.log(`[DEBUG] Sale ID ${result.saleId} created. Checking change modal condition.`);
      console.log(`[DEBUG] totalChangeDueVes=${totalChangeDueVes}, isCreditSale=${isCreditSale}`);

      if (totalChangeDueVes > 0.005 || isCreditSale) {
        console.log(`[DEBUG] Condition met. Opening Change Modal...`);
        openChangeModal(totalChangeDueVes);
      } else if (printTicket && printMode === 'preview' && typeof ctx.showTicketPreview === 'function') {
        console.log(`[DEBUG] Preview triggered, skipping complete modal.`);
        resetPOSState(true);
      } else {
        console.log(`[DEBUG] Condition failed. Showing standard completion.`);
        showSaleCompleteModal(result.saleId, {
          printTicket,
          printMode,
          directOk
        });
        resetPOSState(true);
      }

    } catch (error) {
      console.error('Error completando venta:', error);
      await showGlobalAlert(`Error: ${error.message}`);
      btnCompletarVenta.disabled = false;
      btnGuardarFiado.disabled = false;
      updatePaymentSummary();
    }
  }


  // =========================
  // MODAL CANTIDAD (PESO)
  // =========================

  function openQuantityModal(product) {
    productForQuantityModal = product;
    const unitLabel = product.tipo_venta === 'LITRO' ? 'Lt' : (product.tipo_venta === 'METRO' ? 'Mt' : 'Kg');
    quantityModalTitle.textContent = `Ingresar Cantidad (${unitLabel}) - ${product.nombre || product.name || ''}`;
    quantityModalInput.value = '';
    quantityModalStatus.textContent = `Stock disponible: ${product.stock} ${unitLabel}`;
    quantityModalStatus.className = 'text-sm text-gray-500 mt-2 text-center';
    quantityModal.classList.remove('hidden');
    quantityModalInput.focus();
  }

  function closeQuantityModal() {
    quantityModal.classList.add('hidden');
    productForQuantityModal = null;
    quantityModalInput.value = '';
    quantityModalStatus.textContent = '';
  }

  async function handleQuantitySubmit(event) {
    event.preventDefault();
    const product = productForQuantityModal;
    if (!product) return;

    const quantity = parseFloat(quantityModalInput.value);

    if (isNaN(quantity) || quantity <= 0) {
      quantityModalStatus.textContent = 'Por favor, ingresa una cantidad válida.';
      quantityModalStatus.className = 'text-sm text-red-600 mt-2 text-center';
      return;
    }

    if (quantity > product.stock) {
      const unit = product.tipo_venta === 'PESO' ? 'Kg' : (product.tipo_venta === 'LITRO' ? 'Lt' : 'Mt');
      quantityModalStatus.textContent = `Cantidad excede el stock. Disponible: ${product.stock} ${unit}`;
      quantityModalStatus.className = 'text-sm text-red-600 mt-2 text-center';
      return;
    }

    await addDecimalProductToCart(product, quantity);
    closeQuantityModal();
  }

  // =========================
  // MODAL VUELTO
  // =========================

  function openChangeModal(vueltoTotalVes) {
    console.log('[DEBUG] openChangeModal called with', vueltoTotalVes);
    totalChangeDueVes = vueltoTotalVes;

    const bcv = (currentRates && currentRates.BCV > 0) ? currentRates.BCV : 1;
    const vueltoTotalUsd = vueltoTotalVes / bcv;

    if (changeModalTotalVesSpan) changeModalTotalVesSpan.textContent = `${vueltoTotalVes.toFixed(2)} Bs`;
    if (changeModalTotalUsdSpan) changeModalTotalUsdSpan.textContent = `(${vueltoTotalUsd.toFixed(2)} $)`;

    // Force remove hidden and show flex
    changeModal.style.setProperty('display', 'flex', 'important');
    changeModal.classList.remove('hidden');
    console.log(`[DEBUG] changeModal classes:`, changeModal.classList.toString());

    formChange.reset();
    updateChangeSummary();

    setTimeout(() => {
      if (changeUsdEfectivoInput) changeUsdEfectivoInput.focus();
    }, 100);
  }

  function updateChangeSummary() {
    if (!currentRates || typeof currentRates.BCV !== 'number' || currentRates.BCV <= 0) {
      console.error("updateChangeSummary: BCV rate is invalid.");
      return;
    }
    let vueltoEntregadoVes = 0;
    const bcv = (currentRates && currentRates.BCV > 0) ? currentRates.BCV : 1;

    const changeUsd = parseFloat(changeUsdEfectivoInput.value) || 0;
    vueltoEntregadoVes += changeUsd * bcv;
    const changeVes = parseFloat(changeVesEfectivoInput.value) || 0;
    vueltoEntregadoVes += changeVes;
    const changePM = parseFloat(changePagomovilInput.value) || 0;
    vueltoEntregadoVes += changePM;

    // Optional COP handling
    if (typeof changeCopEfectivoInput !== 'undefined' && changeCopEfectivoInput) {
      const cop = (currentRates && currentRates.COP > 0) ? currentRates.COP : 0;
      if (cop > 0) {
        const changeCop = parseFloat(changeCopEfectivoInput.value) || 0;
        vueltoEntregadoVes += (changeCop / cop) * bcv;
      }
    }
    const restanteVes = totalChangeDueVes - vueltoEntregadoVes;
    const margenError = 0.01; // Ajustado a 0.01 Bs para precisión
    if (restanteVes > margenError) {
      changeModalRemainingVesSpan.textContent = `${restanteVes.toFixed(2)} Bs`;
      changeRemainingContainer.classList.remove('hidden');
      btnConfirmarVuelto.disabled = true;
      mostrarMensajeChange('', 'info');
    } else {
      changeRemainingContainer.classList.add('hidden');
      btnConfirmarVuelto.disabled = false;
      if (restanteVes < -margenError) {
        mostrarMensajeChange(`Se entregó ${Math.abs(restanteVes).toFixed(2)} Bs de más.`, 'warning');
      } else {
        mostrarMensajeChange('Vuelto completo.', 'success');
      }
    }
  }

  async function handleChangeTodoUsd() {
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert('No hay tasa BCV cargada.');
      return;
    }
    const changeVes = parseFloat(changeVesEfectivoInput.value) || 0;
    const changePM = parseFloat(changePagomovilInput.value) || 0;
    const entregadoOtrosBs = changeVes + changePM;
    const restanteBs = totalChangeDueVes - entregadoOtrosBs;
    const montoUsd = Math.max(0, restanteBs / currentRates.BCV);
    changeUsdEfectivoInput.value = montoUsd.toFixed(2);
    updateChangeSummary();
  }

  async function handleChangeTodoVes() {
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert('No hay tasa BCV cargada.');
      return;
    }
    const changeUsd = parseFloat(changeUsdEfectivoInput.value) || 0;
    const changePM = parseFloat(changePagomovilInput.value) || 0;
    const entregadoOtrosBs = (changeUsd * currentRates.BCV) + changePM;
    const restanteBs = totalChangeDueVes - entregadoOtrosBs;
    const montoBs = Math.max(0, restanteBs);
    changeVesEfectivoInput.value = montoBs.toFixed(2);
    updateChangeSummary();
  }

  async function handleChangeTodoPm() {
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert('No hay tasa BCV cargada.');
      return;
    }
    const changeUsd = parseFloat(changeUsdEfectivoInput.value) || 0;
    const changeVes = parseFloat(changeVesEfectivoInput.value) || 0;
    const entregadoOtrosBs = (changeUsd * currentRates.BCV) + changeVes;
    const restanteBs = totalChangeDueVes - entregadoOtrosBs;
    const montoBs = Math.max(0, restanteBs);
    changePagomovilInput.value = montoBs.toFixed(2);
    updateChangeSummary();
  }

  async function confirmChangeAndClose() {
    const changeUsd = parseFloat(document.getElementById('change-usd-efectivo').value) || 0;
    const changeVes = parseFloat(document.getElementById('change-ves-efectivo').value) || 0;
    const changePm = parseFloat(document.getElementById('change-pagomovil').value) || 0;

    const changePayments = [];

    if (changeUsd > 0) {
      changePayments.push({ method: 'USD_EFECTIVO', amount: changeUsd });
    }
    if (changeVes > 0) {
      changePayments.push({ method: 'VES_EFECTIVO', amount: changeVes });
    }
    if (changePm > 0) {
      changePayments.push({ method: 'PAGOMOVIL', amount: changePm });
    }

    if (changePayments.length > 0 && lastCompletedSaleId) {
      const btn = document.getElementById('btn-confirmar-vuelto');
      const originalText = btn.textContent;
      btn.textContent = 'Registrando...';
      btn.disabled = true;

      try {
        await fetch(`/api/sales/${lastCompletedSaleId}/change`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ changePayments })
        });
      } catch (error) {
        console.error("Error enviando vuelto al servidor:", error);
        alert("Error: El vuelto no se pudo registrar en el reporte Z. (Ver consola)");
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }

    closeChangeModal(true);
  }

  function closeChangeModal(skipAutoRegister = false) {
    if (!skipAutoRegister && totalChangeDueVes > 0 && lastCompletedSaleId) {
      const bcv = (currentRates && currentRates.BCV > 0) ? currentRates.BCV : 1;
      const changeUsd = totalChangeDueVes / bcv;
      const changePayments = [];
      if (changeUsd >= 0.01) {
        changePayments.push({ method: 'USD_EFECTIVO', amount: changeUsd });
      } else {
        changePayments.push({ method: 'VES_EFECTIVO', amount: totalChangeDueVes });
      }
      
      const saleId = lastCompletedSaleId;
      fetch(`/api/sales/${saleId}/change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changePayments })
      }).catch(err => console.error("Error auto-registrando vuelto al cerrar:", err));
    }

    lastCompletedSaleId = null;
    const modal = document.getElementById('change-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.removeProperty('display');
    }
    resetPOSState(true);
  }

  function resetPOSState(reloadProductsAfter = false) {
    cart = [];
    currentCasheaData = null;
    renderCart();
    localStorage.removeItem(CART_STORAGE_KEY);
    searchInputPOS.value = '';
    currentSearchResults = [];
    renderSearchResults();
    totalChangeDueVes = 0;
    resetClientSearch(); // Limpiar el cliente seleccionado al completar venta o anular
    if (reloadProductsAfter) {
      loadProducts();
    }
  }

  // =========================
  // HELPER TOAST GLOBAL
  // =========================
  function showToast(message, type = 'info') {
    // Se suprimen las notificaciones flotantes (Toast) en el POS por solicitud del usuario,
    // ya que el módulo tiene su propia retroalimentación visual.
    // if (window.parent && window.parent.Toast) {
    //   window.parent.Toast.show(message, type);
    // }
    console.log('[POS Notification]', type, message);
  }

  function mostrarMensaje(elemento, mensaje, tipo = 'info') {
    // 1. Show Toast for important feedback -> DESACTIVADO
    /*
    if (tipo === 'success' || tipo === 'error' || !elemento) {
      const toastType = tipo === 'error' ? 'error' : (tipo === 'success' ? 'success' : 'info');
      showToast(mensaje, toastType);
    }
    */

    if (!elemento) return;
    elemento.textContent = mensaje;
    elemento.className = 'text-sm mt-3 text-center';
    if (tipo === 'success') {
      elemento.classList.add('text-green-600');
    } else if (tipo === 'error') {
      elemento.classList.add('text-red-600');
    } else {
      elemento.classList.add('text-gray-600');
    }
  }

  function mostrarMensajeModal(mensaje, tipo = 'info') {
    // Para errores críticos en modales sin campo de estado, usamos alerta global
    if (tipo === 'error') {
      showGlobalAlert(mensaje, 'Error');
    } else {
      // Mensajes de éxito (como "Venta completada") se ignoran porque ya hay modal de éxito
      showToast(mensaje, tipo === 'error' ? 'error' : 'success');
    }
  }

  function mostrarMensajeChange(mensaje, tipo = 'info') {
    // Show toast for change errors too
    if (tipo === 'error' || tipo === 'success') {
      showToast(mensaje, tipo === 'error' ? 'error' : 'success');
    }

    if (!changeStatusP) return;
    changeStatusP.textContent = mensaje;
    if (tipo === 'success') {
      changeStatusP.className = 'text-green-600 text-sm mt-2 text-center';
    } else if (tipo === 'error') {
      changeStatusP.className = 'text-red-600 text-sm mt-2 text-center';
    } else if (tipo === 'warning') {
      changeStatusP.className = 'text-orange-600 text-sm mt-2 text-center';
    } else {
      changeStatusP.className = 'text-gray-600 text-sm mt-2 text-center';
    }
  }

  // =========================
  // CIERRE Z + RESUMEN
  // =========================

  async function reloadCierreZSummary() {
    if (!cierreZSummaryBody) return;

    cierreZSummaryBody.innerHTML = `<tr><td colspan="4" class="px-4 py-3 text-center text-gray-500">Cargando resumen de pagos...</td></tr>`;

    try {
      const response = await fetch('/api/reports/summary');
      if (!response.ok) throw new Error('No se pudo cargar el resumen de pagos');
      const summary = await response.json();
      renderCierreZSummary(summary);
    } catch (error) {
      console.error("Error al cargar resumen Cierre Z:", error);
      cierreZSummaryBody.innerHTML = `<tr><td colspan="4" class="px-4 py-3 text-center text-red-500">${error.message}</td></tr>`;
    }
  }

  // Opcional: exposición global (por si quieres llamarlo desde fuera)
  window.reloadCierreZSummary = reloadCierreZSummary;

  // 🔹 NUEVO: cargar APERTURA DE CAJA de hoy (totales) y mostrarla en el modal
  async function loadTodayCashOpening() {
    if (!cierreZOpeningResumen) return;

    cierreZOpeningResumen.textContent = 'Cargando aperturas de caja...';

    try {
      const response = await fetch('/api/reports/cash-opening/today');

      if (!response.ok) {
        if (response.status === 404) {
          cierreZOpeningResumen.textContent = 'No se ha registrado apertura de caja para hoy.';
          return;
        }
        throw new Error('No se pudieron cargar las aperturas de caja.');
      }

      const data = await response.json();
      const totals = data.totals || {};
      const openings = Array.isArray(data.openings) ? data.openings : [];

      const openingVes = Number(totals.total_opening_ves || 0);
      const openingUsd = Number(totals.total_opening_usd || 0);

      if (openingVes <= 0 && openingUsd <= 0) {
        cierreZOpeningResumen.textContent = 'No se ha registrado apertura de caja para hoy.';
        return;
      }

      const partes = [];
      if (openingVes > 0) partes.push(`${openingVes.toFixed(2)} Bs`);
      if (openingUsd > 0) partes.push(`${openingUsd.toFixed(2)} $`);

      const label =
        openings.length > 1 ? 'Aperturas de caja hoy' : 'Apertura de caja hoy';

      cierreZOpeningResumen.textContent = `${label}: ${partes.join(' | ')}`;
    } catch (error) {
      console.error('Error al cargar aperturas de caja:', error);
      cierreZOpeningResumen.textContent = 'Error al cargar las aperturas de caja.';
    }
  }

  async function openCierreZModal() {
    const ctx = window.parent || window;
    let hasPermission = true;

    if (typeof ctx.askForAdminPassword === 'function') {
      hasPermission = await ctx.askForAdminPassword();
    }

    if (!hasPermission) return;

    cierreZModal.classList.remove('hidden');
    await reloadCierreZSummary();
    await loadTodayCashOpening();
  }

  function renderCierreZSummary(summary) {
    cierreZSummaryBody.innerHTML = '';
    const metodos = {};
    if (window.activePaymentMethods && window.activePaymentMethods.length > 0) {
      window.activePaymentMethods.forEach(m => {
        let name = m.nombre;
        if (m.key === 'VES_EFECTIVO') name = 'Bolívares (Efectivo)';
        else if (m.key === 'USD_EFECTIVO') name = 'Dólares (Efectivo)';
        else {
          if (m.moneda === 'VES') name += ' (Bs.)';
          else if (m.moneda === 'USD') name += ' ($)';
          else if (m.moneda === 'COP') name += ' (COP)';
        }
        metodos[m.key] = {
          name: name,
          isUsd: m.moneda === 'USD'
        };
      });
    } else {
      metodos['VES_EFECTIVO'] = { name: 'Bolívares (Efectivo)', isUsd: false };
      metodos['PUNTO_VENTA'] = { name: 'Punto de Venta (Bs.)', isUsd: false };
      metodos['BIOPAGO'] = { name: 'Biopago (Bs.)', isUsd: false };
      metodos['PAGOMOVIL'] = { name: 'Pago Móvil (Bs.)', isUsd: false };
      if (window.isCasheaEnabled) {
        metodos['CASHEA'] = { name: 'Cashea (Bs.)', isUsd: false };
      }
      metodos['USD_EFECTIVO'] = { name: 'Dólares (Efectivo)', isUsd: true };
    }

    let totalSistemaVes = 0;
    let totalSistemaUsd = 0;

    for (const [key, info] of Object.entries(metodos)) {
      const item = summary.find(s => s.metodo === key);
      const totalVes = item ? item.total_ves : 0;
      const totalUsd = item ? item.total_usd : 0;

      let sistemaDisplay, manualInput, difId;

      if (info.isUsd) {
        totalSistemaUsd += totalUsd;
        sistemaDisplay = `${totalUsd.toFixed(2)} $`;
        manualInput = `<input type="number" step="any" class="input-text w-32 text-right cierre-z-manual-usd" data-sistema="${totalUsd}">`;
        difId = `diferencia-${key}`;
      } else {
        totalSistemaVes += totalVes;
        sistemaDisplay = `${totalVes.toFixed(2)} Bs`;
        manualInput = `<input type="number" step="any" class="input-text w-32 text-right cierre-z-manual-ves" data-sistema="${totalVes}">`;
        difId = `diferencia-${key}`;
      }

      const tr = document.createElement('tr');
      tr.dataset.metodo = key;
      tr.dataset.isUsd = info.isUsd;
      tr.innerHTML = `
              <td class="px-4 py-3 text-sm font-medium text-gray-900">${info.name}</td>
              <td class="px-4 py-3 text-sm text-gray-800 text-right">${sistemaDisplay}</td>
              <td class="px-4 py-3 text-right">${manualInput}</td>
              <td class="px-4 py-3 text-sm text-right font-medium" id="${difId}">-</td>
          `;
      cierreZSummaryBody.appendChild(tr);
    }

    const trTotalVes = document.createElement('tr');
    trTotalVes.className = "bg-gray-50 font-bold";
    trTotalVes.innerHTML = `
          <td class="px-4 py-3 text-sm font-bold text-gray-900">Total (VES)</td>
          <td class="px-4 py-3 text-sm text-gray-900 text-right">${totalSistemaVes.toFixed(2)}</td>
          <td class="px-4 py-3 text-sm text-gray-900 text-right" id="cierre-z-total-manual-ves">0.00</td>
          <td class="px-4 py-3 text-sm text-gray-900 text-right" id="cierre-z-total-diferencia-ves">0.00</td>
      `;
    cierreZSummaryBody.appendChild(trTotalVes);

    const trTotalUsd = document.createElement('tr');
    trTotalUsd.className = "bg-gray-50 font-bold";
    trTotalUsd.innerHTML = `
          <td class="px-4 py-3 text-sm font-bold text-gray-900">Total (USD)</td>
          <td class="px-4 py-3 text-sm text-gray-900 text-right">${totalSistemaUsd.toFixed(2)}</td>
          <td class="px-4 py-3 text-sm text-gray-900 text-right" id="cierre-z-total-manual-usd">0.00</td>
          <td class="px-4 py-3 text-sm text-gray-900 text-right" id="cierre-z-total-diferencia-usd">0.00</td>
      `;
    cierreZSummaryBody.appendChild(trTotalUsd);
  }

  function calculateCierreZDiferencia() {
    let totalManualVes = 0;
    let totalDiferenciaVes = 0;
    let totalManualUsd = 0;
    let totalDiferenciaUsd = 0;

    cierreZSummaryBody.querySelectorAll('tr[data-metodo]').forEach(tr => {
      const metodo = tr.dataset.metodo;
      const isUsd = tr.dataset.isUsd === 'true';
      const input = tr.querySelector('input');
      const sistema = parseFloat(input.dataset.sistema);
      const manual = parseFloat(input.value) || 0;
      const diferencia = manual - sistema;

      const difElement = document.getElementById(`diferencia-${metodo}`);
      difElement.textContent = diferencia.toFixed(2);

      if (diferencia < 0) {
        difElement.className = 'px-4 py-3 text-sm text-right font-medium text-red-600';
      } else if (diferencia > 0) {
        difElement.className = 'px-4 py-3 text-sm text-right font-medium text-green-600';
      } else {
        difElement.className = 'px-4 py-3 text-sm text-right font-medium text-gray-700';
      }

      if (isUsd) {
        totalManualUsd += manual;
        totalDiferenciaUsd += diferencia;
      } else {
        totalManualVes += manual;
        totalDiferenciaVes += diferencia;
      }
    });

    document.getElementById('cierre-z-total-manual-ves').textContent = totalManualVes.toFixed(2);
    document.getElementById('cierre-z-total-manual-usd').textContent = totalManualUsd.toFixed(2);

    const totalDifVesEl = document.getElementById('cierre-z-total-diferencia-ves');
    totalDifVesEl.textContent = totalDiferenciaVes.toFixed(2);
    totalDifVesEl.className = `px-4 py-3 text-sm text-right font-bold ${totalDiferenciaVes < 0 ? 'text-red-600' : (totalDiferenciaVes > 0 ? 'text-green-600' : 'text-gray-900')}`;

    const totalDifUsdEl = document.getElementById('cierre-z-total-diferencia-usd');
    totalDifUsdEl.textContent = totalDiferenciaUsd.toFixed(2);
    totalDifUsdEl.className = `px-4 py-3 text-sm text-right font-bold ${totalDiferenciaUsd < 0 ? 'text-red-600' : (totalDiferenciaUsd > 0 ? 'text-green-600' : 'text-gray-900')}`;
  }

  function closeCierreZModal() {
    cierreZModal.classList.add('hidden');
    cierreZNotas.value = '';
    cierreZStatus.textContent = '';
    if (cierreZOpeningResumen) cierreZOpeningResumen.textContent = '';
  }

  // =========================
  // RETIRO DE EFECTIVO (Cierre Z)
  // =========================

  function openWithdrawalModal() {
    if (!withdrawalModal) return;

    if (withdrawalStatus) {
      withdrawalStatus.textContent = '';
      withdrawalStatus.className = 'text-sm mt-3 text-center text-gray-600';
    }

    if (withdrawalMethod) withdrawalMethod.value = 'VES_EFECTIVO';
    if (withdrawalAmount) withdrawalAmount.value = '';
    if (withdrawalDescription) withdrawalDescription.value = '';

    withdrawalModal.classList.remove('hidden');
    if (withdrawalAmount) withdrawalAmount.focus();
  }

  function closeWithdrawalModal() {
    if (!withdrawalModal) return;
    withdrawalModal.classList.add('hidden');
  }

  async function handleWithdrawalSubmit(e) {
    e.preventDefault();

    if (!withdrawalMethod || !withdrawalAmount) return;

    const metodo = withdrawalMethod.value;
    const monto = parseFloat(withdrawalAmount.value);
    const descripcion = withdrawalDescription ? withdrawalDescription.value.trim() : '';

    if (!metodo) {
      mostrarMensaje(withdrawalStatus, 'Selecciona el método de retiro.', 'error');
      return;
    }

    if (!monto || monto <= 0) {
      mostrarMensaje(withdrawalStatus, 'El monto debe ser mayor a 0.', 'error');
      return;
    }

    try {
      mostrarMensaje(withdrawalStatus, 'Guardando retiro...', 'info');

      const response = await fetch('/api/reports/cash-withdrawal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metodo,
          monto,
          descripcion
        })
      });

      const result = await response.json();

      if (!response.ok || result.success === false) {
        throw new Error(result.error || result.message || 'No se pudo registrar el retiro.');
      }

      mostrarMensaje(withdrawalStatus, 'Retiro registrado correctamente.', 'success');

      // Recargar el resumen del Cierre Z para que el retiro se refleje en los totales
      await reloadCierreZSummary();

      setTimeout(() => {
        closeWithdrawalModal();
        if (withdrawalStatus) withdrawalStatus.textContent = '';
      }, 700);
    } catch (error) {
      console.error('Error registrando retiro:', error);
      mostrarMensaje(withdrawalStatus, error.message || 'Error al registrar el retiro.', 'error');
    }
  }

  // =========================
  // 🔹 APERTURA DE CAJA
  // =========================

  function openCashOpeningModal() {
    if (!cashOpeningModal) return;

    if (cashOpeningStatus) {
      cashOpeningStatus.textContent = '';
      cashOpeningStatus.className = 'text-sm mt-3 text-center text-gray-600';
    }

    if (cashOpeningVesInput) cashOpeningVesInput.value = '';
    if (cashOpeningUsdInput) cashOpeningUsdInput.value = '';
    if (cashOpeningNotesInput) cashOpeningNotesInput.value = '';

    cashOpeningModal.classList.remove('hidden');
    if (cashOpeningVesInput) cashOpeningVesInput.focus();
  }

  function closeCashOpeningModal() {
    if (!cashOpeningModal) return;
    cashOpeningModal.classList.add('hidden');
  }

  async function handleCashOpeningSubmit(e) {
    e.preventDefault();

    if (!cashOpeningVesInput || !cashOpeningUsdInput) return;

    const openingVes = parseFloat(cashOpeningVesInput.value) || 0;
    const openingUsd = parseFloat(cashOpeningUsdInput.value) || 0;
    const notes = cashOpeningNotesInput ? cashOpeningNotesInput.value.trim() : '';

    if (openingVes <= 0 && openingUsd <= 0) {
      mostrarMensaje(
        cashOpeningStatus,
        'Ingresa al menos un monto distinto de 0.',
        'error'
      );
      return;
    }

    try {
      mostrarMensaje(cashOpeningStatus, 'Guardando apertura de caja...', 'info');

      const response = await fetch('/api/reports/cash-opening', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opening_ves: openingVes,
          opening_usd: openingUsd,
          notes
        })
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) {
        throw new Error(result.error || result.message || 'No se pudo registrar la apertura.');
      }

      mostrarMensaje(
        cashOpeningStatus,
        'Apertura de caja registrada correctamente.',
        'success'
      );

      // Actualizar texto en Cierre Z
      await loadTodayCashOpening();

      setTimeout(() => {
        closeCashOpeningModal();
        if (cashOpeningStatus) cashOpeningStatus.textContent = '';
      }, 800);
    } catch (error) {
      console.error('Error registrando apertura de caja:', error);
      mostrarMensaje(
        cashOpeningStatus,
        error.message || 'Error al registrar la apertura de caja.',
        'error'
      );
    }
  }

  async function handleImprimirCierreZ() {
    mostrarMensaje(cierreZStatus, 'Verificando...', 'info');

    const ctx = window.parent || window;
    let hasPermission = true;

    if (typeof ctx.askForAdminPassword === 'function') {
      hasPermission = await ctx.askForAdminPassword();
    }

    if (!hasPermission) {
      mostrarMensaje(cierreZStatus, 'Verificación fallida.', 'error');
      return;
    }

    mostrarMensaje(cierreZStatus, 'Generando PDF...', 'info');

    const summaryData = [];
    const totals = {};

    cierreZSummaryBody.querySelectorAll('tr[data-metodo]').forEach(tr => {
      const input = tr.querySelector('input');
      const metodo = tr.dataset.metodo;
      const difElement = document.getElementById(`diferencia-${metodo}`);

      const sistemaRaw = tr.querySelector('td:nth-child(2)').textContent || '';
      const sistemaNum = parseFloat(sistemaRaw) || 0;
      const manualNum = input ? (parseFloat(input.value) || 0) : 0;
      const diffNum = manualNum - sistemaNum;

      summaryData.push({
        metodo: tr.querySelector('td:first-child').textContent,
        sistema: sistemaNum.toFixed(2),
        manual: manualNum.toFixed(2),
        diferencia: diffNum.toFixed(2)
      });

      if (difElement) {
        difElement.textContent = diffNum.toFixed(2);
      }
    });

    // Recalcular totales numéricos
    calculateCierreZDiferencia();

    totals.sistemaVes = parseFloat(
      document.getElementById('cierre-z-total-manual-ves').previousElementSibling.textContent
    ) || 0;
    totals.manualVes = parseFloat(
      document.getElementById('cierre-z-total-manual-ves').textContent
    ) || 0;
    totals.diferenciaVes = parseFloat(
      document.getElementById('cierre-z-total-diferencia-ves').textContent
    ) || 0;

    totals.sistemaUsd = parseFloat(
      document.getElementById('cierre-z-total-manual-usd').previousElementSibling.textContent
    ) || 0;
    totals.manualUsd = parseFloat(
      document.getElementById('cierre-z-total-manual-usd').textContent
    ) || 0;
    totals.diferenciaUsd = parseFloat(
      document.getElementById('cierre-z-total-diferencia-usd').textContent
    ) || 0;

    // Texto de apertura de caja (si existe en el DOM)
    let aperturaTexto = '';
    if (cierreZOpeningResumen && cierreZOpeningResumen.textContent) {
      aperturaTexto = cierreZOpeningResumen.textContent;
    }

    try {
      const response = await fetch('/api/reports/print-cierre-z', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summaryData: summaryData,
          totals: totals,
          notes: cierreZNotas.value,
          cashOpeningText: aperturaTexto   // 🔹 Se envía al backend (opcional)
        })
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Error al generar el PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `cierre-z-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      mostrarMensaje(cierreZStatus, 'Reporte generado.', 'success');
      setTimeout(closeCierreZModal, 1000);

    } catch (error) {
      console.error('Error al imprimir Cierre Z:', error);
      mostrarMensaje(cierreZStatus, error.message, 'error');
    }
  }

  function showSaleCompleteModal(saleId, printConfig) {
    const parentDoc = getParentDocument();
    const saleCompleteModal = parentDoc.getElementById('sale-complete-modal');
    const saleCompleteMessage = parentDoc.getElementById('sale-complete-message');
    const btnCloseSaleComplete = parentDoc.getElementById('btn-close-sale-complete');

    if (!saleCompleteModal || !saleCompleteMessage || !btnCloseSaleComplete) return;

    // Soportar ambos formatos:
    // - antiguo: printConfig = true/false
    // - nuevo:   printConfig = { printTicket, printMode, directOk }
    let printTicket = false;
    let printMode = 'direct';
    let directOk = null;

    if (typeof printConfig === 'object' && printConfig !== null) {
      printTicket = !!printConfig.printTicket;
      printMode = 'direct';
      if ('directOk' in printConfig) {
        directOk = printConfig.directOk;
      }
    } else {
      // boolean directo
      printTicket = !!printConfig;
    }

    saleCompleteMessage.textContent = `¡Venta #${saleId} completada!`;
    const subtext = saleCompleteModal.querySelector('p');

    if (subtext) {
      if (!printTicket) {
        subtext.textContent = 'La venta se ha guardado exitosamente.';
      } else if (printMode === 'direct') {
        if (directOk === false) {
          subtext.textContent = 'No se pudo imprimir el ticket automáticamente. Revisa la impresora o la configuración.';
        } else {
          subtext.textContent = 'Ticket enviado a la impresora.';
        }
      } else {
        // Fallback (antes preview)
        subtext.textContent = 'Ticket procesado.';
      }
    }

    saleCompleteModal.classList.remove('hidden');

    btnCloseSaleComplete.onclick = () => {
      saleCompleteModal.classList.add('hidden');
      if (searchInputPOS) {
        setTimeout(() => searchInputPOS.focus(), 100);
      }
    };
  }

  function mostrarMensaje(elemento, mensaje, tipo = 'info') {
    if (!elemento) return;
    elemento.textContent = mensaje;
    elemento.className = 'text-sm mt-3 text-center';
    if (tipo === 'success') {
      elemento.classList.add('text-green-600');
    } else if (tipo === 'error') {
      elemento.classList.add('text-red-600');
    } else {
      elemento.classList.add('text-gray-600');
    }
  }

  // =========================
  // CLIENTES (POS)
  // =========================

  async function searchClients(searchTerm) {
    if (searchTerm.length < 2) {
      clientSearchResultsDiv.innerHTML = '';
      return;
    }
    try {
      const response = await fetch(`/api/clients?search=${encodeURIComponent(searchTerm)}`);
      if (!response.ok) throw new Error('Error buscando clientes');
      currentClients = await response.json();
      renderClientSearchResults();
    } catch (error) {
      console.error(error);
      clientSearchResultsDiv.innerHTML = '<div class="absolute w-full bg-white border border-gray-300 rounded-md shadow-lg z-10 p-2 text-red-500">Error al buscar</div>';
    }
  }

  function renderClientSearchResults() {
    clientSearchResultsDiv.innerHTML = '';
    if (currentClients.length === 0) {
      clientSearchResultsDiv.innerHTML = '<div class="absolute w-full bg-white border border-gray-300 rounded-md shadow-lg z-10 p-2 text-gray-500">No se encontraron clientes.</div>';
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'absolute w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto z-10';
    currentClients.forEach(client => {
      const li = document.createElement('li');
      li.className = 'p-2 hover:bg-blue-100 cursor-pointer';
      li.textContent = `${client.nombre} (${client.cedula || 'N/A'})`;
      li.dataset.clientId = client.id;
      li.dataset.clientName = client.nombre;
      li.addEventListener('click', () => selectClient(client));
      ul.appendChild(li);
    });
    clientSearchResultsDiv.appendChild(ul);
  }

  function selectClient(client) {
    selectedClientIdInput.value = client.id;
    selectedClientNameSpan.textContent = client.nombre;
    selectedClientDiv.classList.remove('hidden');
    clientSearchInput.classList.add('hidden');
    clientSearchResultsDiv.innerHTML = '';
    currentClients = [];
    updatePaymentSummary();
  }

  function resetClientSearch() {
    selectedClientIdInput.value = '';
    selectedClientNameSpan.textContent = '';
    selectedClientDiv.classList.add('hidden');
    clientSearchInput.classList.remove('hidden');
    clientSearchInput.value = '';
    clientSearchResultsDiv.innerHTML = '';
    currentClients = [];
    updatePaymentSummary();
  }

  function openClientModalPOS() {
    clientForm.reset();
    clientIdInput.value = '';
    clientModalTitle.textContent = 'Añadir Nuevo Cliente (POS)';
    clientModalStatus.textContent = '';
    clientModal.classList.remove('hidden');
  }

  function closeClientModalPOS() {
    clientModal.classList.add('hidden');
    clientForm.reset();
    clientModalStatus.textContent = '';
  }

  async function handleClientSubmitPOS(e) {
    e.preventDefault();
    const data = {
      nombre: clientNombreInput.value,
      cedula: clientCedulaInput.value,
      telefono: clientTelefonoInput.value,
      direccion: clientDireccionInput.value,
    };

    if (!data.nombre) {
      mostrarMensaje(clientModalStatus, 'El nombre es obligatorio.', 'error');
      return;
    }

    mostrarMensaje(clientModalStatus, 'Guardando cliente...', 'info');

    try {
      const response = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error desconocido');

      mostrarMensaje(clientModalStatus, '¡Cliente creado!', 'success');
      setTimeout(() => {
        closeClientModalPOS();
        selectClient({ id: result.id, nombre: data.nombre });
      }, 1000);
    } catch (error) {
      console.error('Error guardando cliente:', error);
      mostrarMensaje(clientModalStatus, error.message, 'error');
    }
  }

  // =========================
  // MODAL GESTIÓN DE CLIENTES (EDITAR / ELIMINAR)
  // =========================

  function openClientManageModal() {
    if (!clientManageModal) return;
    clientManageModal.classList.remove('hidden');
    clientManageStatus.textContent = '';
    manageClientSearchInput.value = '';
    manageClientResultsList.innerHTML = '';
    manageClientIdInput.value = '';
    manageClientNombreInput.value = '';
    manageClientCedulaInput.value = '';
    manageClientTelefonoInput.value = '';
    manageClientDireccionInput.value = '';
    if (manageClientSearchInput) {
      manageClientSearchInput.focus();
    }
  }

  function closeClientManageModal() {
    if (!clientManageModal) return;
    clientManageModal.classList.add('hidden');
  }

  async function searchClientsForManage(term) {
    if (term.length < 2) {
      manageClientResultsList.innerHTML = '';
      return;
    }
    try {
      const response = await fetch(`/api/clients?search=${encodeURIComponent(term)}`);
      if (!response.ok) throw new Error('Error buscando clientes');
      currentManageClients = await response.json();
      renderManageClientResults();
    } catch (error) {
      console.error('Error buscando clientes (gestión):', error);
      manageClientResultsList.innerHTML = `
        <li class="p-2 text-red-600 text-sm">Error al buscar clientes.</li>
      `;
    }
  }

  function renderManageClientResults() {
    manageClientResultsList.innerHTML = '';
    if (!currentManageClients || currentManageClients.length === 0) {
      manageClientResultsList.innerHTML = `
        <li class="p-2 text-gray-500 text-sm">No se encontraron clientes.</li>
      `;
      return;
    }

    currentManageClients.forEach(client => {
      const li = document.createElement('li');
      li.className = 'p-2 hover:bg-blue-50 cursor-pointer text-sm';
      li.textContent = `${client.nombre} (${client.cedula || 'N/A'})`;
      li.addEventListener('click', () => selectManageClient(client));
      manageClientResultsList.appendChild(li);
    });
  }

  function selectManageClient(client) {
    manageClientIdInput.value = client.id;
    manageClientNombreInput.value = client.nombre || '';
    manageClientCedulaInput.value = client.cedula || '';
    manageClientTelefonoInput.value = client.telefono || '';
    manageClientDireccionInput.value = client.direccion || '';
    mostrarMensaje(clientManageStatus, 'Cliente cargado. Modifica y guarda o elimina.', 'info');
  }

  async function handleManageClientSubmit(e) {
    e.preventDefault();
    const id = manageClientIdInput.value;
    if (!id) {
      mostrarMensaje(clientManageStatus, 'Primero selecciona un cliente de la lista.', 'error');
      return;
    }

    const data = {
      nombre: manageClientNombreInput.value,
      cedula: manageClientCedulaInput.value,
      telefono: manageClientTelefonoInput.value,
      direccion: manageClientDireccionInput.value,
    };

    if (!data.nombre) {
      mostrarMensaje(clientManageStatus, 'El nombre es obligatorio.', 'error');
      return;
    }

    mostrarMensaje(clientManageStatus, 'Guardando cambios...', 'info');

    try {
      const response = await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error al actualizar cliente');

      mostrarMensaje(clientManageStatus, 'Cambios guardados.', 'success');

      if (manageClientSearchInput.value.trim().length >= 2) {
        searchClientsForManage(manageClientSearchInput.value.trim());
      }
    } catch (error) {
      console.error('Error actualizando cliente:', error);
      mostrarMensaje(clientManageStatus, error.message, 'error');
    }
  }

  async function handleDeleteClient() {
    const id = manageClientIdInput.value;
    if (!id) {
      mostrarMensaje(clientManageStatus, 'Selecciona un cliente primero.', 'error');
      return;
    }

    const confirmed = await showGlobalConfirm(
      '¿Seguro que deseas eliminar este cliente? Esta acción no se puede deshacer.',
      'Eliminar Cliente'
    );
    if (!confirmed) return;

    mostrarMensaje(clientManageStatus, 'Eliminando cliente...', 'info');

    try {
      const response = await fetch(`/api/clients/${id}`, {
        method: 'DELETE'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Error al eliminar cliente');

      mostrarMensaje(clientManageStatus, 'Cliente eliminado.', 'success');

      manageClientIdInput.value = '';
      manageClientNombreInput.value = '';
      manageClientCedulaInput.value = '';
      manageClientTelefonoInput.value = '';
      manageClientDireccionInput.value = '';

      if (manageClientSearchInput.value.trim().length >= 2) {
        searchClientsForManage(manageClientSearchInput.value.trim());
      } else {
        manageClientResultsList.innerHTML = '';
      }
    } catch (error) {
      console.error('Error eliminando cliente:', error);
      mostrarMensaje(clientManageStatus, error.message, 'error');
    }
  }

  // =========================
  // CONFIGURACIÓN DE IMPRESIÓN
  // =========================

  async function openPrintSettingsModal() {
    if (!printSettingsModal) return;

    mostrarMensaje(printSettingsStatus, 'Cargando configuración...', 'info');
    printSettingsModal.classList.remove('hidden');

    try {
      const res = await fetch('/api/print-settings');
      if (!res.ok) {
        throw new Error('No se pudo cargar la configuración');
      }

      const settings = await res.json();

      // Modo de impresión (Select)
      const printModeSelect = document.getElementById('printMode');
      if (printModeSelect) {
        printModeSelect.value = settings.printMode === 'direct' ? 'direct' : 'preview';
      }

      // Checkbox imprimir ticket
      const printTicketCheckbox = document.getElementById('printTicketCheckbox');
      if (printTicketCheckbox) {
        printTicketCheckbox.checked = !!settings.printTicket;
      }

      // Checkboxes QR y Logo
      const printLogoCheckbox = document.getElementById('printLogoCheckbox');
      const printQrCheckbox = document.getElementById('printQrCheckbox');
      if (printLogoCheckbox) {
        printLogoCheckbox.checked = settings.printLogo !== false;
      }
      if (printQrCheckbox) {
        printQrCheckbox.checked = settings.printQr !== false;

        // Mostrar/ocultar input de contenido QR
        const qrContentContainer = document.getElementById('qrContentContainer');
        const printQrContentInput = document.getElementById('printQrContent');
        if (qrContentContainer) {
          if (printQrCheckbox.checked) qrContentContainer.classList.remove('hidden');
          else qrContentContainer.classList.add('hidden');
        }
        if (printQrContentInput) {
          printQrContentInput.value = settings.printQrContent || 'https://bodegapp.com.ve';
        }

        // Listener para cambio en vivo
        printQrCheckbox.removeEventListener('change', toggleQrContent);
        printQrCheckbox.addEventListener('change', toggleQrContent);
      }

      function toggleQrContent() {
        const qrContentContainer = document.getElementById('qrContentContainer');
        if (qrContentContainer) {
          if (this.checked) qrContentContainer.classList.remove('hidden');
          else qrContentContainer.classList.add('hidden');
        }
      }

      // Impresora
      const printerSelect = document.getElementById('printerSelect');
      if (printerSelect) {
        printerSelect.innerHTML = '<option value="">Usar impresora predeterminada del sistema</option>';
        const ctx = (window.parent && window.parent !== window) ? window.parent : window;
        if (ctx.electronPrinter && ctx.electronPrinter.getPrinters) {
          try {
            const pResp = await ctx.electronPrinter.getPrinters();
            if (pResp.ok && Array.isArray(pResp.printers)) {
              pResp.printers.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.name;
                opt.textContent = p.name + (p.isDefault ? ' (Predeterminada)' : '');
                printerSelect.appendChild(opt);
              });
            }
          } catch (e) {
            console.warn('No se pudieron cargar impresoras en pos.js:', e);
          }
        }
        if (settings.printerName) {
          printerSelect.value = settings.printerName;
        }
      }

      // Copias
      const copiesInput = document.querySelector('input[name="print-copies"]');
      if (copiesInput) {
        copiesInput.value = settings.printCopies || 1;
      }

      // Ancho de papel
      const paperWidthSelect = document.querySelector('select[name="print-paper-width"]');
      if (paperWidthSelect) {
        paperWidthSelect.value = String(settings.ticketSize || 80);
      }

      // Encabezado / pie
      const headerTextarea = document.querySelector('textarea[name="print-header"]');
      const footerTextarea = document.querySelector('textarea[name="print-footer"]');
      if (headerTextarea) headerTextarea.value = settings.printHeader || '';
      if (footerTextarea) footerTextarea.value = settings.printFooter || '';

      // Nuevos campos de negocio
      const businessRIFInput = document.querySelector('input[name="business-rif"]');
      const businessAddressInput = document.querySelector('textarea[name="business-address"]');
      const businessPhoneInput = document.querySelector('input[name="business-phone"]');
      if (businessRIFInput) businessRIFInput.value = settings.businessRIF || '';
      if (businessAddressInput) businessAddressInput.value = settings.businessAddress || '';
      if (businessPhoneInput) businessPhoneInput.value = settings.businessPhone || '';

      mostrarMensaje(printSettingsStatus, '', 'info');
    } catch (error) {
      console.error('Error cargando configuración de impresión:', error);
      mostrarMensaje(
        printSettingsStatus,
        'No se pudo cargar la configuración. Se usarán valores por defecto.',
        'error'
      );
    }
  }

  function closePrintSettingsModal() {
    if (!printSettingsModal) return;
    printSettingsModal.classList.add('hidden');
    mostrarMensaje(printSettingsStatus, '', 'info');
  }

  async function handleSavePrintSettings(event) {
    event.preventDefault();
    if (!printSettingsModal) return;

    mostrarMensaje(printSettingsStatus, 'Guardando...', 'info');

    try {
      const printModeSelect = document.getElementById('printMode');
      const mode = printModeSelect ? printModeSelect.value : 'preview';

      const printTicketCheckbox = document.getElementById('printTicketCheckbox');
      const printerSelect = document.getElementById('printerSelect');
      const copiesInput = document.querySelector('input[name="print-copies"]');
      const paperWidthSelect = document.querySelector('select[name="print-paper-width"]');
      const headerTextarea = document.querySelector('textarea[name="print-header"]');
      const footerTextarea = document.querySelector('textarea[name="print-footer"]');
      const printLogoCheckbox = document.getElementById('printLogoCheckbox');
      const printQrCheckbox = document.getElementById('printQrCheckbox');
      const printQrContentInput = document.getElementById('printQrContent');

      const body = {
        printMode: mode,
        printTicket: !!(printTicketCheckbox && printTicketCheckbox.checked),
        printerName: printerSelect ? printerSelect.value : '',
        printCopies: copiesInput ? Number(copiesInput.value) || 1 : 1,
        ticketSize: paperWidthSelect ? Number(paperWidthSelect.value) : 80,
        printHeader: headerTextarea ? headerTextarea.value : '',
        printFooter: footerTextarea ? footerTextarea.value : '',
        businessRIF: document.querySelector('input[name="business-rif"]') ? document.querySelector('input[name="business-rif"]').value : '',
        businessAddress: document.querySelector('textarea[name="business-address"]') ? document.querySelector('textarea[name="business-address"]').value : '',
        businessPhone: document.querySelector('input[name="business-phone"]') ? document.querySelector('input[name="business-phone"]').value : '',
        printLogo: !!(printLogoCheckbox && printLogoCheckbox.checked),
        printQr: !!(printQrCheckbox && printQrCheckbox.checked),
        printQrContent: printQrContentInput ? printQrContentInput.value : 'https://bodegapp.com.ve'
      };


      const res = await fetch('/api/print-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await res.json().catch(() => ({}));

      if (!res.ok || result.success === false) {
        throw new Error(result.error || 'Error al guardar configuración');
      }

      // Actualizar la configuración en la sesión actual para usarla inmediatamente
      if (window.parent) {
        window.parent.appSettings = window.parent.appSettings || {};
        Object.assign(window.parent.appSettings, body);
      }

      mostrarMensaje(printSettingsStatus, '¡Configuración guardada!', 'success');
      setTimeout(closePrintSettingsModal, 1000);
    } catch (error) {
      console.error('Error guardando configuración de impresión:', error);
      mostrarMensaje(printSettingsStatus, error.message || 'Error al guardar configuración.', 'error');
    }
  }

  // =========================
  // RECIBIR VENTA DESDE REPORTES (REABRIR EN POS)
  // =========================

  async function applySalePayloadToCart(payload) {
    console.log('[POS] Aplicando venta recibida desde reports:', payload);

    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      console.warn('[POS] Payload sin items válidos:', payload);
      return;
    }

    // 0) Asegurar que tenemos BCV válida
    if (
      !currentRates ||
      isNaN(parseFloat(currentRates.BCV)) ||
      parseFloat(currentRates.BCV) <= 0
    ) {
      console.warn('[POS] BCV vacía/incorrecta al reabrir venta. Recargando tasas...');
      try {
        await loadRates();
      } catch (e) {
        console.error('[POS] Error recargando tasas en applySalePayloadToCart:', e);
      }
    }

    const bcv = parseFloat(currentRates.BCV);
    if (!bcv || bcv <= 0) {
      console.error('[POS] BCV sigue siendo inválida. Usando 1 para evitar NaN.');
    }
    const safeBcv = bcv && bcv > 0 ? bcv : 1;

    // 1) Limpiar carrito y cliente actuales
    resetPOSState(false);   // vacía carrito pero NO recarga listado de productos
    resetClientSearch();    // limpia cliente seleccionado

    // 2) Cargar cliente si viene en el payload
    if (payload.clienteId) {
      try {
        selectClient({
          id: payload.clienteId,
          nombre: payload.clienteNombre || 'Cliente'
        });
      } catch (e) {
        // Fallback por si el código de selectClient cambia
        selectedClientIdInput.value = payload.clienteId;
        selectedClientNameSpan.textContent = payload.clienteNombre || 'Cliente';
        selectedClientDiv.classList.remove('hidden');
        clientSearchInput.classList.add('hidden');
      }
    } else if (payload.clienteNombre) {
      // Solo nombre manual
      selectedClientIdInput.value = '';
      selectedClientNameSpan.textContent = payload.clienteNombre;
      selectedClientDiv.classList.remove('hidden');
      clientSearchInput.classList.add('hidden');
    }

    // 3) Cargar items en el carrito
    payload.items.forEach((it) => {
      if (!it) return;

      const qty = Number(it.quantity || it.cantidad || 0);
      if (!qty || qty <= 0) return;

      // Precio unitario en Bs de la venta original
      const priceVes = Number(
        it.priceVes ??
        it.precio_unitario_ves ??
        it.precio_ves ??
        0
      ) || 0;

      // Convertir a USD con la BCV actual
      const priceUsd = Number((priceVes / safeBcv).toFixed(2));

      cart.push({
        lineId: generateCartItemId(),
        id: it.productId || it.producto_id || (it.nombre ? 'vl-' + it.id : it.id),
        name: it.name || it.producto_nombre || it.nombre || `Prod ${it.productId || it.producto_id || it.id || ''}`,
        quantity: qty,
        priceVes,
        priceUsd,
        stock: Infinity,
        baseStock: Infinity,
        tipo_venta: it.tipo_venta || 'UNIDAD',
        presentationId: it.presentationId || null,
        unidadesBase: it.unidadesBase || 1,
        exento_iva: it.exento_iva === 1 || it.exento_iva === true,
        costVes: it.costo_unitario_ves || it.costVes || 0
      });
    });

    renderCart();
    saveCartToLocalStorage();

    if (searchInputPOS) {
      searchInputPOS.focus();
    }

    showGlobalAlert(
      'Los productos de la venta anulada se han cargado en el POS.\nRevisa cantidades y precios antes de completar la nueva venta.',
      'Venta reabierta en POS'
    );
  }

  // Exponer global para que el iframe padre pueda llamarla
  window.applySalePayloadToCart = applySalePayloadToCart;

  // --- RECONCILIACIÓN CASHEA ---
  const casheaReconcileModal = document.getElementById('cashea-reconciliation-modal');
  const btnCasheaReconciliation = document.getElementById('btn-cashea-reconciliation');
  const btnCasheaReconcileClose = document.getElementById('btn-cashea-reconcile-close');
  const btnCasheaReconcileCancel = document.getElementById('btn-cashea-reconcile-cancel');
  const btnCasheaReconcileRefresh = document.getElementById('btn-cashea-reconcile-refresh');
  const casheaPendingList = document.getElementById('cashea-pending-list');

  function openCasheaReconciliationModal() {
    if (casheaReconcileModal) casheaReconcileModal.classList.remove('hidden');
    fetchCasheaPendientes();
  }

  function closeCasheaReconciliationModal() {
    if (casheaReconcileModal) casheaReconcileModal.classList.add('hidden');
  }

  async function fetchCasheaPendientes() {
    try {
      if (!casheaPendingList) return;
      casheaPendingList.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-gray-400 font-bold">Cargando datos de plataforma...</td></tr>`;
      
      const response = await fetch('/api/cashea/pendientes');
      const data = await response.json();
      
      if (!Array.isArray(data) || data.length === 0) {
        casheaPendingList.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-gray-400 italic font-bold">No hay ventas pendientes por liquidar.</td></tr>`;
        return;
      }
      
      casheaPendingList.innerHTML = '';
      data.forEach(item => {
        const financedAmountUsd = item.monto_total_usd - item.monto_inicial_usd;
        const percentFinanced = 100 - item.porcentaje_inicial;
        
        const tr = document.createElement('tr');
        tr.className = "hover:bg-yellow-50/50 transition-colors border-b border-gray-50";
        tr.innerHTML = `
          <td class="px-6 py-4">
            <div class="font-black text-gray-900">${new Date(item.creado_en).toLocaleDateString()}</div>
            <div class="text-[10px] text-gray-400 font-mono tracking-tighter">${item.referencia}</div>
          </td>
          <td class="px-6 py-4 text-gray-600 font-bold">${item.cliente_nombre || 'Cliente Final'}</td>
          <td class="px-6 py-4">
            <span class="px-2 py-0.5 rounded-full ${item.linea === 'principal' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'} text-[10px] font-black uppercase tracking-tighter">
              ${item.linea}
            </span>
          </td>
          <td class="px-6 py-4 text-right text-gray-400 font-black">${percentFinanced}%</td>
          <td class="px-6 py-4 text-right text-green-600 font-black text-base italic">${financedAmountUsd.toFixed(2)} <span class="text-[10px]">$</span></td>
          <td class="px-6 py-4 text-center">
            <button onclick="reconciliarCashea(${item.id})" class="bg-gray-900 text-[#f2ff00] px-4 py-2 rounded-xl hover:bg-green-600 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest shadow-sm">
              Liquidado
            </button>
          </td>
        `;
        casheaPendingList.appendChild(tr);
      });
    } catch (error) {
      console.error('Error fetching cashea pendientes:', error);
      if (casheaPendingList) casheaPendingList.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-red-500 font-bold">Error de comunicación con el servidor.</td></tr>`;
    }
  }

  window.reconciliarCashea = async function(id) {
    const ok = await showGlobalConfirm('¿Marcar como liquidada?', 'Confirma que has recibido el dinero de Cashea por esta venta en tu cuenta bancaria.');
    if (!ok) return;
    
    try {
      const response = await fetch(`/api/cashea/${id}/reconciliar`, { method: 'PUT' });
      const res = await response.json();
      if (res.ok) {
        fetchCasheaPendientes();
      } else {
        await showGlobalAlert('Error: ' + (res.error || 'No se pudo reconciliar.'));
      }
    } catch (error) {
      console.error('Error reconciling cashea sale:', error);
      await showGlobalAlert('Error crítico de red al reconciliar.');
    }
  };

  // --- CASHEA CHECKOUT LOGIC ---
  casheaSelectedPercent = 40;
  casheaSelectedLinea = 'principal';

  function openCasheaModal() {
    if (!selectedClientIdInput.value) {
       showGlobalAlert('Debes seleccionar un cliente para usar Cashea.', 'Cliente Requerido');
       return;
    }

    const totalVes = calculateCartTotalVes();
    const bcv = currentRates?.BCV || 1;
    const totalUsd = totalVes / bcv;

    document.getElementById('cashea-total-ves').textContent = totalVes.toFixed(2) + ' Bs';
    document.getElementById('cashea-total-usd').textContent = totalUsd.toFixed(2) + ' $';

    const modal = document.getElementById('cashea-modal');
    if (modal) modal.classList.remove('hidden');
    updateCasheaSummary();
  }

  function updateCasheaSummary() {
    const totalVes = calculateCartTotalVes();
    const bcv = currentRates?.BCV || 1;
    const totalUsd = totalVes / bcv;

    const initialUsd = totalUsd * (casheaSelectedPercent / 100);
    const initialVes = initialUsd * bcv;

    const remainingUsd = totalUsd - initialUsd;
    let numCuotas = 3;
    if (casheaSelectedLinea === 'cotidiana') numCuotas = 1;
    else if (casheaSelectedLinea === 'linea-6') numCuotas = 6;
    else if (casheaSelectedLinea === 'linea-9') numCuotas = 9;
    else if (casheaSelectedLinea === 'linea-12') numCuotas = 12;
    else if (casheaSelectedLinea === 'linea-15') numCuotas = 15;
    
    const cuotaVes = (remainingUsd * bcv) / numCuotas;
    const cuotaUsd = remainingUsd / numCuotas;

    const labelCuotas = document.getElementById('cashea-label-cuotas');
    if (labelCuotas) {
      labelCuotas.innerText = `${numCuotas} CUOTAS DE PAGO`;
    }

    document.getElementById('cashea-monto-inicial-ves').textContent = `${initialVes.toFixed(2)} Bs`;
    document.getElementById('cashea-monto-inicial-usd').textContent = `${initialUsd.toFixed(2)} $`;
    
    const cuotaVesEl = document.getElementById('cashea-monto-cuota-ves');
    const cuotaUsdEl = document.getElementById('cashea-monto-cuota-usd');
    if (cuotaVesEl) cuotaVesEl.textContent = `${cuotaVes.toFixed(2)} Bs`;
    if (cuotaUsdEl) cuotaUsdEl.textContent = `${cuotaUsd.toFixed(2)} $`;

    // Botones de porcentaje
    document.querySelectorAll('.cashea-percent-btn').forEach(btn => {
      const p = parseInt(btn.id.split('-').pop());
      if (p === casheaSelectedPercent) btn.classList.add('active');
      else btn.classList.remove('active');
    });

    // Botones de línea
    document.querySelectorAll('.cashea-linea-btn').forEach(btn => {
      if (btn.id.includes(casheaSelectedLinea)) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }

  async function handleCasheaConfirm() {
    const totalVes = calculateCartTotalVes();
    const bcv = currentRates?.BCV || 1;
    const totalUsd = totalVes / bcv;
    const initialUsd = totalUsd * (casheaSelectedPercent / 100);
    const referencia = document.getElementById('cashea-referencia').value.trim();

    let numCuotas = 3;
    if (casheaSelectedLinea === 'cotidiana') numCuotas = 1;
    else if (casheaSelectedLinea === 'linea-6') numCuotas = 6;
    else if (casheaSelectedLinea === 'linea-9') numCuotas = 9;
    else if (casheaSelectedLinea === 'linea-12') numCuotas = 12;
    else if (casheaSelectedLinea === 'linea-15') numCuotas = 15;

    const financedUsd = totalUsd - initialUsd;
    const cuotaUsd = financedUsd / numCuotas;
    const cuotas = [];
    for (let i = 1; i <= numCuotas; i++) {
        const fecha = new Date();
        fecha.setDate(fecha.getDate() + (i * 14)); // Estimación: cada 14 días
        cuotas.push({
            numero: i,
            monto_usd: cuotaUsd,
            fecha_vencimiento: fecha.toISOString().split('T')[0]
        });
    }

    currentCasheaData = {
      monto_total_usd: totalUsd,
      monto_inicial_usd: initialUsd,
      porcentaje_inicial: casheaSelectedPercent,
      linea: casheaSelectedLinea,
      num_cuotas: numCuotas,
      referencia: referencia,
      cliente_id: parseInt(selectedClientIdInput.value, 10),
      cuotas: cuotas
    };

    const modal = document.getElementById('cashea-modal');
    if (modal) modal.classList.add('hidden');
    openPaymentModal();
  }

  // =========================
  // INICIALIZACIÓN
  // =========================

  async function initializePOS() {
    await loadRates();

    loadCartFromLocalStorage();
    window.addEventListener('beforeunload', saveCartToLocalStorage);

    renderCart();
    renderSearchResults();

    if (formPrice) {
      formPrice.addEventListener('submit', handlePriceModalSubmit);
    }
    if (btnCancelarPrecio) {
      btnCancelarPrecio.addEventListener('click', closePriceModal);
    }
    if (priceModal) {
      priceModal.addEventListener('click', (e) => {
        if (e.target === priceModal) {
          closePriceModal();
        }
      });
    }

    // Conversión dinámica dentro del modal de precio
    if (priceModalCurrencySelect && priceModalInput) {
      priceModalCurrencySelect.addEventListener('change', () => {
        const newCurrency = priceModalCurrencySelect.value;
        const currentValue = parseFloat(priceModalInput.value);

        if (!isNaN(currentValue)) {
          const converted = convertPrice(currentValue, priceModalCurrentCurrency, newCurrency);
          priceModalInput.value = converted.toFixed(2);
        }

        priceModalCurrentCurrency = newCurrency;
      });

      priceModalInput.addEventListener('input', () => {
        priceModalCurrentCurrency = priceModalCurrencySelect.value;
      });
    }

    if (searchInputPOS) {
      searchInputPOS.addEventListener('input', handlePosSearchInput);
      searchInputPOS.addEventListener('keydown', handlePosSearchKeydown);
    }

    if (btnCancelarVenta) {
      btnCancelarVenta.addEventListener('click', () => { cancelSale(); });
    }
    if (btnPagar) {
      btnPagar.addEventListener('click', () => { openPaymentModal(); });
    }
    if (btnCancelarPago) {
      btnCancelarPago.addEventListener('click', closePaymentModal);
    }
    if (btnDailyClose) {
      btnDailyClose.addEventListener('click', openCierreZModal);
    }

    if (btnPrintSettings) {
      btnPrintSettings.addEventListener('click', openPrintSettingsModal);
    }
    if (btnClosePrintSettings) {
      btnClosePrintSettings.addEventListener('click', closePrintSettingsModal);
    }
    if (btnCancelPrintSettings) {
      btnCancelPrintSettings.addEventListener('click', closePrintSettingsModal);
    }
    if (printSettingsModal) {
      // Cerrar al hacer click en el fondo oscuro del modal de impresión
      printSettingsModal.addEventListener('click', (e) => {
        if (e.target === printSettingsModal) {
          closePrintSettingsModal();
        }
      });
    }
    if (formPrintSettings) {
      formPrintSettings.addEventListener('submit', handleSavePrintSettings);
    }

    paymentInputs.forEach(input => {
      input.addEventListener('input', updatePaymentSummary);
    });

    if (btnCompletarVenta) {
      btnCompletarVenta.addEventListener('click', () => completeSale(false));
    }
    if (btnGuardarFiado) {
      btnGuardarFiado.addEventListener('click', () => completeSale(true));
    }
    if (formPago) {
      formPago.addEventListener('submit', (e) => e.preventDefault());
    }

    changeInputs.forEach(input => {
      input.addEventListener('input', updateChangeSummary);
    });
    if (btnConfirmarVuelto) {
      btnConfirmarVuelto.addEventListener('click', confirmChangeAndClose);
    }
    const btnCloseChangeModal = document.getElementById('btn-close-change-modal');
    if (btnCloseChangeModal) {
      btnCloseChangeModal.addEventListener('click', closeChangeModal);
    }
    if (formChange) {
      formChange.addEventListener('submit', (e) => e.preventDefault());
    }

    if (formQuantity) {
      formQuantity.addEventListener('submit', handleQuantitySubmit);
    }
    if (btnCancelarCantidad) {
      btnCancelarCantidad.addEventListener('click', closeQuantityModal);
    }

    if (clientSearchInput) {
      clientSearchInput.addEventListener('input', () => {
        clearTimeout(currentClientSearchTimeout);
        currentClientSearchTimeout = setTimeout(() => {
          searchClients(clientSearchInput.value);
        }, 300);
      });
    }
    if (btnRemoveSelectedClient) {
      btnRemoveSelectedClient.addEventListener('click', resetClientSearch);
    }

    if (btnAddNewClientPOS) {
      btnAddNewClientPOS.addEventListener('click', openClientModalPOS);
    }
    if (clientForm) {
      clientForm.addEventListener('submit', handleClientSubmitPOS);
    }
    if (btnCancelClient) {
      btnCancelClient.addEventListener('click', closeClientModalPOS);
    }

    if (btnPagoTodoVes) btnPagoTodoVes.addEventListener('click', handlePagoTodoVes);
    if (btnPagoTodoUsd) btnPagoTodoUsd.addEventListener('click', handlePagoTodoUsd);
    if (btnPagoTodoPunto) btnPagoTodoPunto.addEventListener('click', handlePagoTodoPunto);
    if (btnPagoTodoBiopago) btnPagoTodoBiopago.addEventListener('click', handlePagoTodoBiopago);
    if (btnPagoTodoPagomovil) btnPagoTodoPagomovil.addEventListener('click', handlePagoTodoPagomovil);

    if (btnChangeTodoUsd) btnChangeTodoUsd.addEventListener('click', handleChangeTodoUsd);
    if (btnChangeTodoVes) btnChangeTodoVes.addEventListener('click', handleChangeTodoVes);
    if (btnChangeTodoPm) btnChangeTodoPm.addEventListener('click', handleChangeTodoPm);

    // Gestionar clientes desde POS con contraseña de admin
    if (btnManageClientsPOS) {
      btnManageClientsPOS.addEventListener('click', async () => {
        const ctx = window.parent || window;
        let hasPermission = true;

        if (typeof ctx.askForAdminPassword === 'function') {
          hasPermission = await ctx.askForAdminPassword();
        }

        if (!hasPermission) return;

        openClientManageModal();
      });
    }
    if (btnCloseClientManage) {
      btnCloseClientManage.addEventListener('click', closeClientManageModal);
    }
    if (btnCancelClientManage) {
      btnCancelClientManage.addEventListener('click', closeClientManageModal);
    }
    if (manageClientSearchInput) {
      manageClientSearchInput.addEventListener('input', () => {
        clearTimeout(manageClientSearchTimeout);
        manageClientSearchTimeout = setTimeout(() => {
          searchClientsForManage(manageClientSearchInput.value.trim());
        }, 300);
      });
    }
    if (clientManageForm) {
      clientManageForm.addEventListener('submit', handleManageClientSubmit);
    }
    if (btnUpdateClient) {
      btnUpdateClient.addEventListener('click', (e) => handleManageClientSubmit(e));
    }
    if (btnDeleteClient) {
      btnDeleteClient.addEventListener('click', handleDeleteClient);
    }

    if (btnCloseCierreZ) {
      btnCloseCierreZ.addEventListener('click', closeCierreZModal);
    }
    if (btnImprimirCierreZ) {
      btnImprimirCierreZ.addEventListener('click', handleImprimirCierreZ);
    }
    if (cierreZSummaryBody) {
      cierreZSummaryBody.addEventListener('input', calculateCierreZDiferencia);
    }

    // Eventos para Retiro de efectivo
    if (btnOpenWithdrawalModal) {
      btnOpenWithdrawalModal.addEventListener('click', async () => {
        const ctx = window.parent || window;
        let hasPermission = true;

        if (typeof ctx.askForAdminPassword === 'function') {
          hasPermission = await ctx.askForAdminPassword();
        }

        if (!hasPermission) return;

        openWithdrawalModal();
      });
    }
    if (btnCloseWithdrawalModal) {
      btnCloseWithdrawalModal.addEventListener('click', closeWithdrawalModal);
    }
    if (btnCancelWithdrawal) {
      btnCancelWithdrawal.addEventListener('click', closeWithdrawalModal);
    }
    if (withdrawalModal) {
      withdrawalModal.addEventListener('click', (e) => {
        if (e.target === withdrawalModal) {
          closeWithdrawalModal();
        }
      });
    }
    if (withdrawalForm) {
      withdrawalForm.addEventListener('submit', handleWithdrawalSubmit);
    }

    // 🔹 Eventos para APERTURA DE CAJA
    if (btnOpenCashOpeningModal) {
      btnOpenCashOpeningModal.addEventListener('click', async () => {
        const ctx = window.parent || window;
        let hasPermission = true;

        if (typeof ctx.askForAdminPassword === 'function') {
          hasPermission = await ctx.askForAdminPassword();
        }

        if (!hasPermission) return;

        openCashOpeningModal();
      });
    }
    if (btnCloseCashOpeningModal) {
      btnCloseCashOpeningModal.addEventListener('click', closeCashOpeningModal);
    }
    if (btnCancelCashOpening) {
      btnCancelCashOpening.addEventListener('click', closeCashOpeningModal);
    }
    if (cashOpeningModal) {
      cashOpeningModal.addEventListener('click', (e) => {
        if (e.target === cashOpeningModal) {
          closeCashOpeningModal();
        }
      });
    }
    if (formCashOpening) {
      formCashOpening.addEventListener('submit', handleCashOpeningSubmit);
    }

    // Eventos venta completada ya se manejan en showSaleCompleteModal

    // Eventos para ventas en espera
    if (btnHoldSale) {
      btnHoldSale.addEventListener('click', () => { putSaleOnHold(); });
    }
    if (btnOpenHeldSales) {
      btnOpenHeldSales.addEventListener('click', openHeldSalesModal);
    }
    if (btnCloseHoldSales) {
      btnCloseHoldSales.addEventListener('click', closeHeldSalesModal);
    }
    if (holdSalesList) {
      holdSalesList.addEventListener('click', handleHoldSalesListClick);
    }

    // Eventos para modal de nombre de venta en espera
    if (btnConfirmHoldSaleClient) {
      btnConfirmHoldSaleClient.addEventListener('click', handleConfirmHoldSaleClient);
    }
    if (btnCancelHoldSaleClient) {
      btnCancelHoldSaleClient.addEventListener('click', handleCancelHoldSaleClient);
    }
    if (holdSaleClientModal) {
      holdSaleClientModal.addEventListener('click', (e) => {
        if (e.target === holdSaleClientModal) {
          handleCancelHoldSaleClient();
        }
      });
    }

    // --- CASHEA EVENT LISTENERS ---
    const btnCasheaOpen = document.getElementById('btn-cashea-open');
    if (btnCasheaOpen) {
      btnCasheaOpen.addEventListener('click', openCasheaModal);
    }
    
    document.querySelectorAll('.cashea-percent-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        casheaSelectedPercent = parseInt(btn.id.split('-').pop());
        updateCasheaSummary();
      });
    });

    document.querySelectorAll('.cashea-linea-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.id.includes('principal')) casheaSelectedLinea = 'principal';
        else if (btn.id.includes('cotidiana')) casheaSelectedLinea = 'cotidiana';
        else if (btn.id.includes('linea-6')) casheaSelectedLinea = 'linea-6';
        else if (btn.id.includes('linea-9')) casheaSelectedLinea = 'linea-9';
        else if (btn.id.includes('linea-12')) casheaSelectedLinea = 'linea-12';
        else if (btn.id.includes('linea-15')) casheaSelectedLinea = 'linea-15';
        updateCasheaSummary();
      });
    });

    const btnCasheaConfirm = document.getElementById('btn-cashea-confirm');
    if (btnCasheaConfirm) {
      btnCasheaConfirm.addEventListener('click', handleCasheaConfirm);
    }

    const btnCasheaClose = document.getElementById('btn-cashea-close');
    const btnCasheaCancel = document.getElementById('btn-cashea-cancel');
    if (btnCasheaClose) btnCasheaClose.addEventListener('click', () => document.getElementById('cashea-modal').classList.add('hidden'));
    if (btnCasheaCancel) btnCasheaCancel.addEventListener('click', () => document.getElementById('cashea-modal').classList.add('hidden'));

    if (btnCasheaReconciliation) {
      btnCasheaReconciliation.addEventListener('click', openCasheaReconciliationModal);
    }
    if (btnCasheaReconcileClose) {
      btnCasheaReconcileClose.addEventListener('click', closeCasheaReconciliationModal);
    }
    if (btnCasheaReconcileCancel) {
      btnCasheaReconcileCancel.addEventListener('click', closeCasheaReconciliationModal);
    }
    if (btnCasheaReconcileRefresh) {
      btnCasheaReconcileRefresh.addEventListener('click', fetchCasheaPendientes);
    }

    const btnCancelCasheaFlow = document.getElementById('btn-cancel-cashea-flow');
    if (btnCancelCasheaFlow) {
      btnCancelCasheaFlow.addEventListener('click', () => {
        currentCasheaData = null;
        document.getElementById('cashea-active-banner').classList.add('hidden');
        updatePaymentSummary();
      });
    }
    const btnCasheaLineaPrincipal = document.getElementById('btn-cashea-linea-principal');
    if (btnCasheaLineaPrincipal) {
      btnCasheaLineaPrincipal.addEventListener('click', () => { casheaSelectedLinea = 'principal'; updateCasheaPlan(); });
    }
    const btnCasheaLineaCotidiana = document.getElementById('btn-cashea-linea-cotidiana');
    if (btnCasheaLineaCotidiana) {
      btnCasheaLineaCotidiana.addEventListener('click', () => { casheaSelectedLinea = 'cotidiana'; updateCasheaPlan(); });
    }
    const btnCasheaAddClient = document.getElementById('btn-cashea-add-client');
    if (btnCasheaAddClient) {
      btnCasheaAddClient.addEventListener('click', () => {
        openClientModalPOS();
      });
    }
  }

  // === Al abrir POS, revisar si hay una venta pendiente enviada desde Reportes ===
  try {
    const parentCtx = window.parent || window;
    const pending = parentCtx.__POS_PENDING_SALE__;
    if (pending && Array.isArray(pending.items) && pending.items.length > 0) {
      // Limpiamos la variable en el padre y aplicamos aquí
      parentCtx.__POS_PENDING_SALE__ = null;
      applySalePayloadToCart(pending);
    }
  } catch (e) {
    console.warn('[POS] No se pudo leer venta pendiente desde el padre:', e);
  }



  initializePOS();

  // Auto-refresh rates every 60 seconds to keep sync with server auto-updater
  setInterval(() => {
    loadRates();
  }, 60000);

  // Manual refresh via Rate Card
  const bcvDisplayBtn = document.getElementById('pos-bcv-display');
  if (bcvDisplayBtn) {
    bcvDisplayBtn.style.cursor = 'pointer';
    bcvDisplayBtn.title = 'Click para actualizar tasa';
    bcvDisplayBtn.addEventListener('click', () => {
      loadRates().then(() => {
        // Visual feedback
        const originalBg = bcvDisplayBtn.className;
        bcvDisplayBtn.classList.remove('bg-blue-50', 'text-blue-700');
        bcvDisplayBtn.classList.add('bg-green-100', 'text-green-800');
        setTimeout(() => {
          bcvDisplayBtn.classList.remove('bg-green-100', 'text-green-800');
          bcvDisplayBtn.classList.add('bg-blue-50', 'text-blue-700');
        }, 500);
      });
    });
  } // Cierre del if (bcvDisplayBtn)

  // =========================
  // MODAL AVANCE / CANJE DE EFECTIVO
  // =========================
  const advanceModal = document.getElementById('advance-modal');
  const btnOpenAdvanceModal = document.getElementById('btn-open-advance-modal');
  const btnCloseAdvanceModal = document.getElementById('btn-close-advance-modal');
  const btnCancelAdvance = document.getElementById('btn-cancel-advance');
  const formAdvance = document.getElementById('form-advance');

  const advanceAmountOut = document.getElementById('advance-amount-out');
  const advanceFeePercent = document.getElementById('advance-fee-percent');
  const advanceFeeAmount = document.getElementById('advance-fee-amount');
  const advanceTotalInDisplay = document.getElementById('advance-total-in-display');
  const advanceTotalInInput = document.getElementById('advance-total-in');
  const advanceMethodIn = document.getElementById('advance-method-in');
  const advanceDescription = document.getElementById('advance-description');
  const advanceStatus = document.getElementById('advance-status');

  function updateAdvanceCalculations() {
    if (!advanceAmountOut || !advanceFeePercent) return;

    const amount = parseFloat(advanceAmountOut.value) || 0;
    const percent = parseFloat(advanceFeePercent.value) || 0;

    // Fee = Amount * (percent / 100)
    const fee = amount * (percent / 100);
    const total = amount + fee;

    if (advanceFeeAmount) advanceFeeAmount.value = fee.toFixed(2);
    if (advanceTotalInDisplay) advanceTotalInDisplay.textContent = total.toFixed(2) + ' Bs';
    if (advanceTotalInInput) advanceTotalInInput.value = total.toFixed(2);
  }

  if (advanceAmountOut) advanceAmountOut.addEventListener('input', updateAdvanceCalculations);
  if (advanceFeePercent) advanceFeePercent.addEventListener('input', updateAdvanceCalculations);

  function openAdvanceModal() {
    if (cierreZModal) cierreZModal.classList.add('hidden'); // Close parent modal if open

    if (advanceModal) {
      advanceModal.classList.remove('hidden');
      if (formAdvance) formAdvance.reset();

      if (advanceTotalInDisplay) advanceTotalInDisplay.textContent = '0.00 Bs';
      if (advanceStatus) advanceStatus.textContent = '';

      // Default fee suggestion (e.g. 10%)
      if (advanceFeePercent) advanceFeePercent.value = 10;
      if (advanceAmountOut) advanceAmountOut.focus();
    }
  }

  if (btnOpenAdvanceModal) btnOpenAdvanceModal.addEventListener('click', openAdvanceModal);

  function closeAdvanceModal() {
    if (advanceModal) advanceModal.classList.add('hidden');
    // Re-open Cierre Z modal if appropriate? Usually better to stay in context or go back to main
    // But if we opened from Cierre Z, maybe we want to go back there?
    // Let's just close for now.
    if (cierreZModal) cierreZModal.classList.remove('hidden');
  }

  if (btnCloseAdvanceModal) btnCloseAdvanceModal.addEventListener('click', closeAdvanceModal);
  if (btnCancelAdvance) btnCancelAdvance.addEventListener('click', closeAdvanceModal);

  if (formAdvance) {
    formAdvance.addEventListener('submit', async (e) => {
      e.preventDefault();

      const amountOut = parseFloat(advanceAmountOut.value);
      const feeAmount = parseFloat(advanceFeeAmount.value);
      const method = advanceMethodIn.value;
      const desc = advanceDescription.value;

      if (!amountOut || amountOut <= 0) {
        if (advanceStatus) {
          advanceStatus.textContent = 'El monto a entregar debe ser mayor a 0.';
          advanceStatus.className = 'text-xs text-red-600';
        }
        return;
      }

      if (advanceStatus) {
        advanceStatus.textContent = 'Procesando...';
        advanceStatus.className = 'text-xs text-blue-600';
      }

      try {
        const res = await fetch('/api/reports/cash-advance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount_out: amountOut,
            fee_amount: feeAmount,
            method_in: method,
            description: desc
          })
        });

        const data = await res.json();

        if (data.error) {
          if (advanceStatus) {
            advanceStatus.textContent = data.error;
            advanceStatus.className = 'text-xs text-red-600';
          }
        } else {
          await showGlobalAlert(`Avance de efectivo registrado con éxito. Venta #${data.saleId}`);
          closeAdvanceModal();
        }
      } catch (err) {
        console.error(err);
        if (advanceStatus) {
          advanceStatus.textContent = 'Error de conexión con el servidor.';
          advanceStatus.className = 'text-xs text-red-600';
        }
      }
    });
  } // ends if formAdvance

  // =========================
  // VENTA LIBRE LOGICA
  // =========================
  function openVentaLibreModal() {
    if (formVentaLibre) formVentaLibre.reset();
    if (vlCantidad) vlCantidad.value = 1;
    if (vlExentoIva) vlExentoIva.checked = true; // Por defecto exento
    if (ventaLibreModal) ventaLibreModal.classList.remove('hidden');
    setTimeout(() => { if (vlNombre) vlNombre.focus(); }, 100);
  }

  function closeVentaLibreModal() {
    if (ventaLibreModal) ventaLibreModal.classList.add('hidden');
    resetSearch();
  }

  if (btnCloseVentaLibre) btnCloseVentaLibre.addEventListener('click', closeVentaLibreModal);
  if (btnCancelVentaLibre) btnCancelVentaLibre.addEventListener('click', closeVentaLibreModal);

  if (vlCostoUsd && vlCostoVes) {
    vlCostoUsd.addEventListener('input', () => {
      vlCostoVes.value = (parseFloat(vlCostoUsd.value || 0) * (currentRates?.BCV || 1)).toFixed(2);
    });
    vlCostoVes.addEventListener('input', () => {
      vlCostoUsd.value = (parseFloat(vlCostoVes.value || 0) / (currentRates?.BCV || 1)).toFixed(2);
    });
  }

  if (vlPrecioUsd && vlPrecioVes) {
    vlPrecioUsd.addEventListener('input', () => {
      vlPrecioVes.value = (parseFloat(vlPrecioUsd.value || 0) * (currentRates?.BCV || 1)).toFixed(2);
    });
    vlPrecioVes.addEventListener('input', () => {
      vlPrecioUsd.value = (parseFloat(vlPrecioVes.value || 0) / (currentRates?.BCV || 1)).toFixed(2);
    });
  }

  if (formVentaLibre) {
    formVentaLibre.addEventListener('submit', (e) => {
      e.preventDefault();
      const nombre = vlNombre.value.trim() || 'Venta Libre';
      const precioVes = parseFloat(vlPrecioVes.value || 0);
      const precioUsd = parseFloat(vlPrecioUsd.value || 0);
      const costoVes = parseFloat(vlCostoVes.value || 0);
      const qty = parseFloat(vlCantidad.value || 1);
      const isExempt = vlExentoIva ? vlExentoIva.checked : true;

      if (precioUsd <= 0 && precioVes <= 0) {
        showGlobalAlert('El precio de venta debe ser mayor a 0');
        return;
      }

      cart.push({
        lineId: generateCartItemId(),
        id: 'vl-' + Date.now(),
        name: nombre,
        quantity: qty,
        priceVes: precioVes,
        priceUsd: precioUsd,
        costVes: costoVes,
        stock: 999999,
        baseStock: 999999,
        tipo_venta: 'UNIDAD',
        presentationId: null,
        unidadesBase: 1,
        exento_iva: isExempt
      });

      renderCart();
      closeVentaLibreModal();
    });
  }

  // =========================
  // KEYBOARD SHORTCUTS
  // =========================
  function handleKeyboardShortcut(keyStr, e = null) {
    const activeModals = document.querySelectorAll('.fixed:not(.hidden)');
    const isModalOpen = activeModals.length > 0;

    // F1: Focus Search
    if (keyStr === 'F1') {
      if (e) e.preventDefault();
      if (!isModalOpen && searchInputPOS) {
        searchInputPOS.focus();
        searchInputPOS.select();
      }
    }

    // F2: New Client
    if (keyStr === 'F2') {
      if (e) e.preventDefault();
      const btn = document.getElementById('btn-add-new-client-pos');
      if (btn && btn.offsetParent !== null) {
        btn.click();
      } else {
        const btnManage = document.getElementById('btn-manage-clients-pos');
        if (btnManage && !isModalOpen) btnManage.click();
      }
    }

    // F4: Venta Libre
    if (keyStr === 'F4') {
      if (e) e.preventDefault();
      if (!isModalOpen) openVentaLibreModal();
    }

    // F7: Hold Sale
    if (keyStr === 'F7') {
      if (e) e.preventDefault();
      if (!isModalOpen && btnHoldSale && !btnHoldSale.disabled) {
        btnHoldSale.click();
      }
    }

    // F8: Held Sales Modal
    if (keyStr === 'F8') {
      if (e) e.preventDefault();
      if (!isModalOpen && btnOpenHeldSales) {
        btnOpenHeldSales.click();
      }
    }

    // F9: Cierre Z
    if (keyStr === 'F9') {
      if (e) e.preventDefault();
      // Ensure it triggers main button
      if (!isModalOpen && btnDailyClose) {
        btnDailyClose.click();
      }
    }

    // F10: Cobrar
    if (keyStr === 'F10') {
      if (e) e.preventDefault();
      if (!isModalOpen && btnPagar && !btnPagar.disabled) {
        btnPagar.click();
      }
    }

    // F12: Complete Sale (inside Payment modal)
    if (keyStr === 'F12') {
      if (e) e.preventDefault();
      if (!paymentModal.classList.contains('hidden') && btnCompletarVenta && !btnCompletarVenta.disabled) {
        btnCompletarVenta.click();
      }
    }

    // Esc: Close things
    if (keyStr === 'Escape') {
      if (isModalOpen) {
        // Find visible cancel buttons and click them, or call explicit close functions
        if (!paymentModal.classList.contains('hidden') && btnCancelarPago) btnCancelarPago.click();
        else if (!ventaLibreModal.classList.contains('hidden') && btnCloseVentaLibre) btnCloseVentaLibre.click();
        else if (!quantityModal.classList.contains('hidden') && btnCancelarCantidad) btnCancelarCantidad.click();
        else if (!priceModal.classList.contains('hidden') && btnCancelarPrecio) btnCancelarPrecio.click();
        else if (!clientModal.classList.contains('hidden') && btnCancelClient) btnCancelClient.click();
        else if (!changeModal.classList.contains('hidden')) {
          const btn = document.getElementById('btn-close-change-modal');
          if (btn) btn.click();
        }
        else if (!cierreZModal.classList.contains('hidden') && btnCloseCierreZ) btnCloseCierreZ.click();
        else if (!withdrawalModal.classList.contains('hidden') && btnCloseWithdrawalModal) btnCloseWithdrawalModal.click();
        else if (!cashOpeningModal.classList.contains('hidden') && btnCloseCashOpeningModal) btnCloseCashOpeningModal.click();
        else if (!printSettingsModal.classList.contains('hidden') && btnClosePrintSettings) btnClosePrintSettings.click();
        else if (!holdSalesModal.classList.contains('hidden') && btnCloseHoldSales) btnCloseHoldSales.click();
        else if (!holdSaleClientModal.classList.contains('hidden') && btnCancelHoldSaleClient) btnCancelHoldSaleClient.click();
        else if (!clientManageModal.classList.contains('hidden') && btnCloseClientManage) btnCloseClientManage.click();
        if (e) e.preventDefault();
      } else {
        if (searchInputPOS.value.trim() !== '') {
          resetSearch();
          if (e) e.preventDefault();
        }
      }
    }

    // ArrowDown / ArrowUp: Navigate search results if visible
    if ((keyStr === 'ArrowDown' || keyStr === 'ArrowUp') && !isModalOpen && searchResultsDiv && !searchResultsDiv.classList.contains('hidden') && searchResultsDiv.children.length > 0) {
      if (e) e.preventDefault();
      const buttons = Array.from(searchResultsDiv.querySelectorAll('button:not(.hidden)'));
      if (buttons.length === 0) return;

      let index = buttons.findIndex(b => b === document.activeElement);

      if (keyStr === 'ArrowDown') {
        if (index === -1 || index === buttons.length - 1) buttons[0].focus();
        else buttons[index + 1].focus();
      } else if (keyStr === 'ArrowUp') {
        if (index === -1 || index === 0) buttons[buttons.length - 1].focus();
        else buttons[index - 1].focus();
      }
    }
  }

  // Support for standard keydown event
  document.addEventListener('keydown', (e) => handleKeyboardShortcut(e.key, e));

  // Receive forwarded shortcut events from the parent layout
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'KEYBOARD_SHORTCUT') {
      handleKeyboardShortcut(event.data.key, null);
    }
  });


}); // ends DOMContentLoaded
