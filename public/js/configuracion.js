document.addEventListener('DOMContentLoaded', () => {
  // ---------------- REFERENCIAS DOM ----------------

  const updateRatesForm = document.getElementById('updateRatesForm');
  const rateBcvInput = document.getElementById('rate-bcv');
  const rateParaleloInput = document.getElementById('rate-paralelo');
  const rateCopInput = document.getElementById('rate-cop');
  const updateStatus = document.getElementById('updateStatus');

  const formBusinessSettings = document.getElementById('formBusinessSettings');
  const businessNameInput = document.getElementById('businessName');
  const logoFileInput = document.getElementById('logoFile');
  const logoPathInput = document.getElementById('logoPath');
  const logoPreviewContainer = document.getElementById('logoPreviewContainer');
  const logoPreview = document.getElementById('logoPreview');
  const businessSettingsStatus = document.getElementById('businessSettingsStatus');

  const exportCategorySelect = document.getElementById('exportCategorySelect');
  const btnExportar = document.getElementById('btnExportar');
  const formImportar = document.getElementById('formImportar');
  const csvFileInput = document.getElementById('csvFile');
  const dataManagementStatus = document.getElementById('dataManagementStatus');

  // NUEVO: botones para imprimir en PDF
  const btnPrintInventoryPdf = document.getElementById('btnPrintInventoryPdf');
  const btnPrintFiadosPdf = document.getElementById('btnPrintFiadosPdf');

  // Historial de Cierres Z
  const btnOpenCierreZHistory = document.getElementById('btnOpenCierreZHistory');
  const cierreZHistoryModal = document.getElementById('cierreZHistoryModal');
  const btnCloseCierreZHistory = document.getElementById('btnCloseCierreZHistory');
  const cierreZHistoryBody = document.getElementById('cierreZHistoryBody');
  const cierreZHistoryStatus = document.getElementById('cierreZHistoryStatus');

  // NUEVO: controles de paginación del historial
  const cierreZHistoryPrev = document.getElementById('cierreZHistoryPrev');
  const cierreZHistoryNext = document.getElementById('cierreZHistoryNext');
  const cierreZHistoryPaginationInfo = document.getElementById('cierreZHistoryPaginationInfo');

  const CIERRE_Z_HISTORY_LIMIT = 50;
  let cierreZHistoryCurrentPage = 1;
  let cierreZHistoryTotalPages = 1;

  const licenseSection = document.getElementById('license-section');
  const settingsContent = document.getElementById('settings-content');
  const formLicense = document.getElementById('formLicense');
  const hardwareIdInput = document.getElementById('hardware-id');
  const licenseStatus = document.getElementById('license-status');
  const trialActivateSection = document.getElementById('trial-activate-section');
  const btnShowActivateForm = document.getElementById('btn-show-activate-form');

  const btnCopyHwid = document.getElementById('btn-copy-hwid');
  const licenseFileInput = document.getElementById('license-file');

  const formAdminPassword = document.getElementById('form-admin-password');
  const currentPasswordGroup = document.getElementById('current-password-group');
  const currentPasswordInput = document.getElementById('current-password');
  const newPasswordInput = document.getElementById('new-password');
  const confirmPasswordInput = document.getElementById('confirm-password');
  const passwordStatus = document.getElementById('password-status');

  let isPasswordEnabled = false;

  // ---------------- LICENCIA / TRIAL ----------------

  async function loadAndCheckLicense() {
    try {
      const response = await fetch('/api/license/info');
      const data = await response.json();

      hardwareIdInput.value = data.hardwareId || 'Error al obtener ID';

      if (data.status === 'LICENSED') {
        licenseSection.classList.add('hidden');
        settingsContent.classList.remove('hidden');
        trialActivateSection.classList.add('hidden');
        initializePageFunctions();
        mostrarMensaje(
          businessSettingsStatus,
          'Sistema activado (Licencia Completa).',
          'success'
        );
      } else if (data.status === 'TRIAL') {
        licenseSection.classList.add('hidden');
        settingsContent.classList.remove('hidden');
        trialActivateSection.classList.remove('hidden');
        initializePageFunctions();
        mostrarMensaje(businessSettingsStatus, data.message, 'info');
      } else {
        licenseSection.classList.remove('hidden');
        licenseSection.classList.add('border-2', 'border-red-500');
        settingsContent.classList.add('hidden');
        trialActivateSection.classList.add('hidden');
        mostrarMensaje(
          licenseStatus,
          data.message || 'La licencia o período de prueba ha expirado.',
          'error'
        );
      }
    } catch (error) {
      console.error('Error verificando licencia:', error);
      licenseSection.classList.remove('hidden');
      settingsContent.classList.add('hidden');
      hardwareIdInput.value = 'Error al contactar el servidor';
      mostrarMensaje(
        licenseStatus,
        'Error al verificar licencia. Recarga la página.',
        'error'
      );
    }
  }

  async function handleLicenseActivate(event) {
    event.preventDefault();

    if (!licenseFileInput || !licenseFileInput.files || licenseFileInput.files.length === 0) {
      mostrarMensaje(licenseStatus, 'Por favor, selecciona un archivo de licencia.', 'error');
      return;
    }

    const file = licenseFileInput.files[0];

    try {
      mostrarMensaje(licenseStatus, 'Leyendo archivo de licencia...', 'info');

      const text = (await file.text()).trim();

      if (!text) {
        mostrarMensaje(
          licenseStatus,
          'El archivo de licencia está vacío o es inválido.',
          'error'
        );
        return;
      }

      const key = text;

      mostrarMensaje(licenseStatus, 'Verificando licencia...', 'info');

      const response = await fetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: key })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Error desconocido');
      }

      mostrarMensaje(licenseStatus, '¡Activado con éxito! Recargando...', 'success');

      setTimeout(() => {
        window.parent.location.reload();
      }, 1500);
    } catch (error) {
      console.error('Error activando licencia:', error);
      mostrarMensaje(licenseStatus, error.message, 'error');
    }
  }

  // Copiar HWID al portapapeles
  async function handleCopyHwid() {
    const value = hardwareIdInput.value || '';
    if (!value || value === 'Error al obtener ID' || value === 'Error al contactar el servidor') {
      mostrarMensaje(
        licenseStatus,
        'No hay un Hardware ID válido para copiar.',
        'error'
      );
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      mostrarMensaje(
        licenseStatus,
        'Hardware ID copiado al portapapeles.',
        'success'
      );
    } catch (error) {
      console.error('Error copiando HWID:', error);
      mostrarMensaje(
        licenseStatus,
        'No se pudo copiar automáticamente. Copia el texto manualmente.',
        'error'
      );
    }
  }

  // ---------------- SEGURIDAD / CONTRASEÑA ----------------

  async function loadAuthStatus() {
    try {
      const response = await fetch('/api/auth/status');
      const data = await response.json();
      isPasswordEnabled = data.isPasswordEnabled;
      if (isPasswordEnabled) {
        currentPasswordGroup.classList.remove('hidden');
        currentPasswordInput.required = true;
      } else {
        currentPasswordGroup.classList.add('hidden');
        currentPasswordInput.required = false;
      }
    } catch (error) {
      console.error('Error cargando estado de auth:', error);
      mostrarMensaje(
        passwordStatus,
        'Error al cargar estado de seguridad.',
        'error'
      );
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    const currentPassword = currentPasswordInput.value;
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (newPassword !== confirmPassword) {
      mostrarMensaje(passwordStatus, 'Las nuevas contraseñas no coinciden.', 'error');
      return;
    }

    if (isPasswordEnabled && !currentPassword) {
      mostrarMensaje(
        passwordStatus,
        'Debe ingresar su contraseña actual para hacer cambios.',
        'error'
      );
      return;
    }

    if (newPassword && newPassword.length < 4) {
      mostrarMensaje(
        passwordStatus,
        'La nueva contraseña debe tener al menos 4 caracteres.',
        'error'
      );
      return;
    }

    const body = {
      currentPassword: currentPassword || null,
      newPassword: newPassword || null
    };

    mostrarMensaje(passwordStatus, 'Guardando...', 'info');

    try {
      const response = await fetch('/api/auth/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Error desconocido');
      }

      mostrarMensaje(passwordStatus, result.message, 'success');
      formAdminPassword.reset();
      loadAuthStatus();
    } catch (error) {
      console.error('Error guardando contraseña:', error);
      mostrarMensaje(passwordStatus, error.message, 'error');
    }
  }

  // ---------------- INICIALIZACIÓN PÁGINA ----------------

  function initializePageFunctions() {
    loadCurrentRates();
    loadBusinessSettings();
    loadExportCategories();
    loadAuthStatus();
    loadPaymentMethods();
    loadCustomRates();

    updateRatesForm.addEventListener('submit', handleUpdateRates);
    formBusinessSettings.addEventListener('submit', handleBusinessSettingsSubmit);
    formImportar.addEventListener('submit', handleImportSubmit);
    logoFileInput.addEventListener('change', previewLogoFile);
    btnExportar.addEventListener('click', handleExportClick);
    formAdminPassword.addEventListener('submit', handlePasswordSubmit);

    // NUEVO: eventos para imprimir en PDF
    if (btnPrintInventoryPdf) {
      btnPrintInventoryPdf.addEventListener('click', handlePrintInventoryPdf);
    }
    if (btnPrintFiadosPdf) {
      btnPrintFiadosPdf.addEventListener('click', handlePrintFiadosPdf);
    }

    if (btnShowActivateForm) {
      btnShowActivateForm.addEventListener('click', () => {
        settingsContent.classList.add('hidden');
        licenseSection.classList.remove('hidden');
        licenseSection.classList.remove('border-2', 'border-red-500');
        mostrarMensaje(
          licenseStatus,
          'Selecciona tu archivo de licencia para activar la versión completa.',
          'info'
        );
      });
    }

    // Historial de Cierres Z
    if (btnOpenCierreZHistory) {
      btnOpenCierreZHistory.addEventListener(
        'click',
        handleOpenCierreZHistoryFromSettings
      );
    }

    if (btnCloseCierreZHistory) {
      btnCloseCierreZHistory.addEventListener(
        'click',
        closeCierreZHistoryModal
      );
    }

    if (cierreZHistoryModal) {
      cierreZHistoryModal.addEventListener('click', (e) => {
        if (e.target === cierreZHistoryModal) {
          closeCierreZHistoryModal();
        }
      });
    }

    if (cierreZHistoryBody) {
      cierreZHistoryBody.addEventListener('click', handleCierreZHistoryClick);
    }

    // NUEVO: listeners de paginación (si existen en el HTML)
    if (cierreZHistoryPrev) {
      cierreZHistoryPrev.addEventListener('click', () => {
        if (cierreZHistoryCurrentPage > 1) {
          loadCierreZHistory(cierreZHistoryCurrentPage - 1);
        }
      });
    }

    if (cierreZHistoryNext) {
      cierreZHistoryNext.addEventListener('click', () => {
        if (cierreZHistoryCurrentPage < cierreZHistoryTotalPages) {
          loadCierreZHistory(cierreZHistoryCurrentPage + 1);
        }
      });
    }

    const casheaToggle = document.getElementById('setting-enable-cashea');
    if (casheaToggle) {
      casheaToggle.addEventListener('change', async () => {
        const enabled = casheaToggle.checked;
        try {
          // Usamos el mismo endpoint de rates pero mandamos solo esto
          // El backend soporta upsert parcial si mandamos los campos necesarios
          // Pero para estar seguro, mandamos lo que ya tiene el form + esto
          const currentRates = {
            BCV: rateBcvInput.value,
            PARALELO: rateParaleloInput.value,
            COP: rateCopInput.value,
            CALC_METHOD: document.querySelector('input[name="calc-method"]:checked')?.value || 1,
            AUTO_BCV: document.getElementById('auto-bcv')?.checked || false,
            IVA_PERCENTAGE: document.getElementById('rate-iva')?.value || 16,
            IVA_MODE: document.querySelector('input[name="iva-mode"]:checked')?.value || 'INCLUDED',
            ENABLE_CASHEA: enabled
          };

          await fetch('/api/settings/rates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentRates)
          });
          
          if (typeof window.parent.showToast === 'function') {
            window.parent.showToast(enabled ? 'Cashea Habilitado' : 'Cashea Deshabilitado', 'success');
          }
        } catch (e) {
          console.error('Error saving cashea setting:', e);
        }
      });
    }

    // --- ACTUALIZACIONES ---
    const chkAutoUpdates = document.getElementById('setting-auto-updates');
    const btnCheckUpdatesManual = document.getElementById('btn-check-updates-manual');
    const updatesManualStatus = document.getElementById('updates-manual-status');

    if (chkAutoUpdates) {
      chkAutoUpdates.checked = localStorage.getItem('disableAutoUpdates') !== 'true';
      chkAutoUpdates.addEventListener('change', () => {
        localStorage.setItem('disableAutoUpdates', chkAutoUpdates.checked ? 'false' : 'true');
        if (typeof window.parent.showToast === 'function') {
          window.parent.showToast(chkAutoUpdates.checked ? 'Búsqueda automática activada' : 'Búsqueda automática desactivada', 'info');
        }
      });
    }

    if (btnCheckUpdatesManual) {
      btnCheckUpdatesManual.addEventListener('click', async () => {
        mostrarMensaje(updatesManualStatus, 'Buscando actualizaciones...', 'info');
        btnCheckUpdatesManual.disabled = true;

        try {
          const response = await fetch('/api/license/check-update-online');
          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'No se pudo conectar al servidor.');
          }

          if (data.hasUpdate && data.update) {
            mostrarMensaje(updatesManualStatus, '¡Nueva versión disponible!', 'success');
            if (window.parent && typeof window.parent.showUpdateModal === 'function') {
              window.parent.showUpdateModal(data.update);
            }
          } else {
            mostrarMensaje(updatesManualStatus, 'El sistema está actualizado.', 'success');
            if (typeof window.parent.showToast === 'function') {
              window.parent.showToast('Ya tienes la última versión instalada.', 'success');
            }
          }
        } catch (error) {
          console.error('[UPDATER] Error en búsqueda manual:', error);
          mostrarMensaje(updatesManualStatus, error.message || 'Error de conexión', 'error');
        } finally {
          btnCheckUpdatesManual.disabled = false;
        }
      });
    }

    // --- ACCESO MÓVIL (LAN) ---
    const toggleLan = document.getElementById('toggle-lan');
    const lanStatus = document.getElementById('lan-status');
    if (toggleLan) {
      // Estado inicial
      fetch('/api/utils/lan-status')
        .then(r => r.json())
        .then(d => { toggleLan.checked = !!d.lanEnabled; })
        .catch(() => {});

      toggleLan.addEventListener('change', async () => {
        const enabled = toggleLan.checked;
        try {
          const response = await fetch('/api/utils/lan-enable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'No se pudo cambiar el modo LAN.');
          mostrarMensaje(lanStatus, data.message || 'Cambio aplicado. Reinicia la app.', 'info');
          if (typeof window.parent.showToast === 'function') {
            window.parent.showToast('Modo LAN ' + (enabled ? 'activado' : 'desactivado') + '. Reinicia BodegApp.', 'info');
          }
        } catch (error) {
          toggleLan.checked = !enabled; // revertir
          mostrarMensaje(lanStatus, error.message || 'Error al cambiar el modo LAN.', 'error');
        }
      });
    }

    // --- CORTAFUEGOS (FIREWALL) ---
    const btnConfigureFirewall = document.getElementById('btn-configure-firewall');
    const firewallStatus = document.getElementById('firewall-status');

    if (btnConfigureFirewall) {
      btnConfigureFirewall.addEventListener('click', async () => {
        mostrarMensaje(firewallStatus, 'Solicitando permisos de administrador...', 'info');
        btnConfigureFirewall.disabled = true;

        try {
          const currentPort = window.location.port || '';
          const response = await fetch('/api/utils/configure-firewall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port: currentPort ? parseInt(currentPort, 10) : undefined })
          });
          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'No se pudo configurar el firewall.');
          }

          mostrarMensaje(firewallStatus, data.message || 'Proceso iniciado. Por favor confirma la solicitud de UAC.', 'success');
          if (typeof window.parent.showToast === 'function') {
            window.parent.showToast('Consola abierta para configuración de Firewall', 'success');
          }
        } catch (error) {
          console.error('[FIREWALL] Error:', error);
          mostrarMensaje(firewallStatus, error.message || 'Error al configurar.', 'error');
        } finally {
          btnConfigureFirewall.disabled = false;
        }
      });
    }
  }

  // ---------------- TASAS / CÁLCULO ----------------

  async function loadCurrentRates() {
    try {
      const response = await fetch('/api/settings/rates');
      if (!response.ok) throw new Error('No se pudieron cargar las tasas');
      const rates = await response.json();
      rateBcvInput.value = rates.BCV;
      rateParaleloInput.value = rates.PARALELO;
      rateCopInput.value = rates.COP;
      const rateIvaInput = document.getElementById('rate-iva');
      if (rateIvaInput) {
        rateIvaInput.value = rates.IVA_PERCENTAGE !== undefined ? rates.IVA_PERCENTAGE : 16.00;
      }

      if (rates.IVA_MODE === 'EXCLUDED') {
        document.getElementById('iva-mode-excluded').checked = true;
      } else {
        document.getElementById('iva-mode-included').checked = true;
      }

      const autoBcvCheckbox = document.getElementById('auto-bcv');
      if (autoBcvCheckbox) {
        autoBcvCheckbox.checked = (rates.AUTO_BCV === 1 || rates.AUTO_BCV === '1' || rates.AUTO_BCV === true);
      }

      if (rates.CALC_METHOD && rates.CALC_METHOD === 2) {
        document.getElementById('calc-method-fiscal').checked = true;
      } else {
        document.getElementById('calc-method-simple').checked = true;
      }

      const casheaToggle = document.getElementById('setting-enable-cashea');
      if (casheaToggle) {
        casheaToggle.checked = (rates.ENABLE_CASHEA === 1 || rates.ENABLE_CASHEA === '1' || rates.ENABLE_CASHEA === true);
      }
    } catch (error) {
      console.error('Error cargando tasas:', error);
      mostrarMensaje(updateStatus, 'Error al cargar tasas.', 'error');
    }
  }

  async function handleUpdateRates(event) {
    event.preventDefault();
    mostrarMensaje(updateStatus, '', 'info');

    const calcMethod = document.querySelector('input[name="calc-method"]:checked').value;
    // Handle potential missing radio (though HTML guarantees one is checked if initialized)
    const ivaModeEl = document.querySelector('input[name="iva-mode"]:checked');
    const ivaMode = ivaModeEl ? ivaModeEl.value : 'INCLUDED';
    const autoBcvCheckbox = document.getElementById('auto-bcv');
    const rateIvaInput = document.getElementById('rate-iva');

    const newRates = {
      BCV: rateBcvInput.value,
      PARALELO: rateParaleloInput.value,
      COP: rateCopInput.value,
      CALC_METHOD: calcMethod,
      AUTO_BCV: autoBcvCheckbox ? autoBcvCheckbox.checked : false,
      IVA_PERCENTAGE: rateIvaInput ? rateIvaInput.value : 16.0,
      IVA_MODE: ivaMode
    };

    try {
      const response = await fetch('/api/settings/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRates)
      });
      if (!response.ok) throw new Error('Error al actualizar');
      const result = await response.json();
      mostrarMensaje(
        updateStatus,
        result.message || '¡Configuración actualizada con éxito!',
        'success'
      );

      // Si nos devolvió nueva tasa (porque se auto-actualizó), la ponemos en el input
      if (result.newBcvRate) {
        rateBcvInput.value = result.newBcvRate;
      }
    } catch (error) {
      console.error('Error actualizando tasas:', error);
      mostrarMensaje(
        updateStatus,
        'Error al actualizar la configuración.',
        'error'
      );
    }
  }

  // ---------------- PERSONALIZACIÓN NEGOCIO ----------------

  async function loadBusinessSettings() {
    try {
      const response = await fetch('/api/settings/business');
      if (!response.ok) throw new Error('No se pudo cargar la config. del negocio');
      const settings = await response.json();
      businessNameInput.value = settings.businessName || '';
      logoPathInput.value = settings.logoPath || '';
      if (settings.logoPath) {
        logoPreview.src = settings.logoPath;
        logoPreviewContainer.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error cargando config. del negocio:', error);
      mostrarMensaje(
        businessSettingsStatus,
        'Error al cargar la configuración.',
        'error'
      );
    }
  }

  function previewLogoFile() {
    const file = logoFileInput.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        logoPreview.src = e.target.result;
        logoPreviewContainer.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    }
  }

  // Auto-Submit al marcar Checkbox de BCV
  const autoBcvCheck = document.getElementById('auto-bcv');
  if (autoBcvCheck) {
    autoBcvCheck.addEventListener('change', () => {
      // Forzamos el submit del formulario de tasas
      // Construimos un evento fake o llamamos la función directamente
      // Para consistencia visual, mostramos mensaje "Actualizando..." antes
      mostrarMensaje(updateStatus, 'Actualizando y consultando tasa BCV...', 'info');

      const fakeEvent = { preventDefault: () => { } };
      handleUpdateRates(fakeEvent);
    });
  }

  async function handleBusinessSettingsSubmit(event) {
    event.preventDefault();
    mostrarMensaje(businessSettingsStatus, 'Guardando...', 'info');

    const formData = new FormData();
    formData.append('businessName', businessNameInput.value);
    formData.append('logoPath', logoPathInput.value);
    if (logoFileInput.files.length > 0) {
      formData.append('logoFile', logoFileInput.files[0]);
    }

    try {
      const response = await fetch('/api/settings/business', {
        method: 'POST',
        body: formData
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Error desconocido al guardar');
      }

      mostrarMensaje(
        businessSettingsStatus,
        '¡Personalización guardada con éxito!',
        'success'
      );

      logoPathInput.value = result.settings.logoPath;
      if (result.settings.logoPath) {
        logoPreview.src = `${result.settings.logoPath}?t=${new Date().getTime()}`;
        logoPreviewContainer.classList.remove('hidden');
      } else {
        logoPreviewContainer.classList.add('hidden');
      }

      logoFileInput.value = '';
      if (typeof window.parent.reloadLayout === 'function') {
        window.parent.reloadLayout();
      }
    } catch (error) {
      console.error('Error guardando personalización:', error);
      mostrarMensaje(
        businessSettingsStatus,
        `Error: ${error.message}`,
        'error'
      );
    }
  }

  // ---------------- IMPORTAR / EXPORTAR ----------------

  async function loadExportCategories() {
    try {
      const response = await fetch('/api/categories');
      if (!response.ok) throw new Error('No se pudieron cargar categorías');
      const categorias = await response.json();

      while (exportCategorySelect.options.length > 1) {
        exportCategorySelect.remove(1);
      }

      categorias.forEach((cat) => {
        const option = document.createElement('option');
        option.value = cat.nombre;
        option.textContent = cat.nombre;
        exportCategorySelect.appendChild(option);
      });
    } catch (error) {
      console.error('Error cargando categorías para exportar:', error);
      mostrarMensaje(
        dataManagementStatus,
        'Error al cargar lista de categorías.',
        'error'
      );
    }
  }

  function handleExportClick() {
    mostrarMensaje(dataManagementStatus, 'Generando exportación...', 'info');
    const selectedCategory = exportCategorySelect.value;
    let url = '/api/products/export';
    if (selectedCategory !== '_TODAS_') {
      url += `?categoria=${encodeURIComponent(selectedCategory)}`;
    }
    window.location.href = url;
    setTimeout(() => {
      mostrarMensaje(dataManagementStatus, '', 'info');
    }, 2000);
  }

  async function handleImportSubmit(event) {
    event.preventDefault();

    const parentWin = window.parent || window;
    let hasPermission = true;

    if (typeof parentWin.askForAdminPassword === 'function') {
      hasPermission = await parentWin.askForAdminPassword();
    }

    if (!hasPermission) return;

    if (!csvFileInput.files || csvFileInput.files.length === 0) {
      mostrarMensaje(
        dataManagementStatus,
        'Error: Debes seleccionar un archivo CSV o Excel.',
        'error'
      );
      return;
    }

    mostrarMensaje(
      dataManagementStatus,
      'Importando productos, por favor espera...',
      'info'
    );

    const formData = new FormData();
    // Envíamos primero el flag para asegurar que multer lo procese si es necesario, aunque req.body suele estar disponible.
    const convertCheckbox = document.getElementById('convertFromVes');
    if (convertCheckbox && convertCheckbox.checked) {
      formData.append('convertFromVes', 'true');
    }
    formData.append('csvFile', csvFileInput.files[0]);

    try {
      const response = await fetch('/api/products/import', {
        method: 'POST',
        body: formData
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Error desconocido al importar');
      }
      mostrarMensaje(dataManagementStatus, result.message, 'success');
      formImportar.reset();
      await loadExportCategories();
    } catch (error) {
      console.error('Error importando CSV:', error);
      mostrarMensaje(
        dataManagementStatus,
        `Error: ${error.message}`,
        'error'
      );
    }
  }

  // -------- NUEVO: IMPRIMIR INVENTARIO / FIADOS EN PDF --------

  async function handlePrintInventoryPdf() {
    const parentWin = window.parent || window;
    let hasPermission = true;

    if (typeof parentWin.askForAdminPassword === 'function') {
      hasPermission = await parentWin.askForAdminPassword();
    }

    if (!hasPermission) return;

    mostrarMensaje(
      dataManagementStatus,
      'Generando PDF de inventario...',
      'info'
    );

    try {
      const a = document.createElement('a');
      a.href = '/api/reports/inventory-pdf';
      a.download = `inventario-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        mostrarMensaje(dataManagementStatus, '', 'info');
      }, 3000);
    } catch (error) {
      console.error('Error generando PDF de inventario:', error);
      mostrarMensaje(
        dataManagementStatus,
        'Error al generar el PDF de inventario.',
        'error'
      );
    }
  }

  async function handlePrintFiadosPdf() {
    const parentWin = window.parent || window;
    let hasPermission = true;

    if (typeof parentWin.askForAdminPassword === 'function') {
      hasPermission = await parentWin.askForAdminPassword();
    }

    if (!hasPermission) return;

    mostrarMensaje(
      dataManagementStatus,
      'Generando PDF de fiados...',
      'info'
    );

    try {
      const a = document.createElement('a');
      a.href = '/api/reports/fiados-pdf';
      a.download = `fiados-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        mostrarMensaje(dataManagementStatus, '', 'info');
      }, 3000);
    } catch (error) {
      console.error('Error generando PDF de fiados:', error);
      mostrarMensaje(
        dataManagementStatus,
        'Error al generar el PDF de fiados.',
        'error'
      );
    }
  }

  // -------- HISTORIAL DE CIERRES Z --------

  async function handleOpenCierreZHistoryFromSettings() {
    const parentWin = window.parent || window;
    let hasPermission = true;

    if (typeof parentWin.askForAdminPassword === 'function') {
      hasPermission = await parentWin.askForAdminPassword();
    }

    if (!hasPermission) return;

    openCierreZHistoryModal();
  }

  function openCierreZHistoryModal() {
    if (!cierreZHistoryModal) return;

    if (cierreZHistoryStatus) {
      cierreZHistoryStatus.textContent = 'Cargando historial de cierres...';
      cierreZHistoryStatus.className = 'text-sm text-gray-500 mb-2';
    }

    // reset de paginación al abrir
    cierreZHistoryCurrentPage = 1;
    cierreZHistoryTotalPages = 1;
    updateCierreZHistoryPaginationUI();

    cierreZHistoryModal.classList.remove('hidden');
    loadCierreZHistory(1);
  }

  function closeCierreZHistoryModal() {
    if (!cierreZHistoryModal) return;
    cierreZHistoryModal.classList.add('hidden');

    if (cierreZHistoryBody) {
      cierreZHistoryBody.innerHTML = '';
    }
    if (cierreZHistoryStatus) {
      cierreZHistoryStatus.textContent = '';
      cierreZHistoryStatus.className = 'text-sm text-gray-500 mb-2';
    }

    // reset paginación
    cierreZHistoryCurrentPage = 1;
    cierreZHistoryTotalPages = 1;
    updateCierreZHistoryPaginationUI();
  }

  async function loadCierreZHistory(page = 1) {
    if (!cierreZHistoryBody) return;

    cierreZHistoryCurrentPage = page;

    cierreZHistoryBody.innerHTML = `
      <tr>
        <td colspan="5" class="px-4 py-3 text-center text-gray-500 text-sm">
          Cargando...
        </td>
      </tr>
    `;

    try {
      const params = new URLSearchParams();
      params.append('limit', CIERRE_Z_HISTORY_LIMIT);
      params.append('page', String(page)); // el backend puede usar page, o lo adaptas a offset/skip

      const response = await fetch(`/api/reports/cierre-z/history?${params.toString()}`);
      if (!response.ok) {
        throw new Error('No se pudo cargar el historial de cierres.');
      }

      const data = await response.json();

      let cierres;
      let totalPages = 1;

      if (Array.isArray(data)) {
        // Si el backend devuelve directamente un array
        cierres = data;
      } else {
        // Soportar varias estructuras, priorizando data.rows
        cierres = Array.isArray(data.rows)
          ? data.rows
          : (Array.isArray(data.cierres)
            ? data.cierres
            : (Array.isArray(data.items) ? data.items : [])
          );

        // Intentar deducir totalPages si el backend lo envía
        if (typeof data.totalPages === 'number') {
          totalPages = data.totalPages;
        } else if (typeof data.total_pages === 'number') {
          totalPages = data.total_pages;
        } else if (typeof data.total === 'number') {
          totalPages = Math.max(1, Math.ceil(data.total / CIERRE_Z_HISTORY_LIMIT));
        }
      }

      cierreZHistoryTotalPages = totalPages || 1;

      renderCierreZHistory(cierres);
      updateCierreZHistoryPaginationUI();

      if (cierreZHistoryStatus) {
        cierreZHistoryStatus.textContent =
          cierres.length === 0
            ? 'No hay cierres Z registrados todavía.'
            : '';
        cierreZHistoryStatus.className = 'text-sm text-gray-500 mb-2';
      }
    } catch (error) {
      console.error('Error cargando historial de cierres Z:', error);
      cierreZHistoryBody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-3 text-center text-red-500 text-sm">
            Error al cargar el historial.
          </td>
        </tr>
      `;
      if (cierreZHistoryStatus) {
        cierreZHistoryStatus.textContent =
          error.message || 'Error al cargar el historial.';
        cierreZHistoryStatus.className = 'text-sm text-red-600 mb-2';
      }

      // si falla, deja la paginación en 1/1
      cierreZHistoryCurrentPage = 1;
      cierreZHistoryTotalPages = 1;
      updateCierreZHistoryPaginationUI();
    }
  }

  function renderCierreZHistory(cierres) {
    cierreZHistoryBody.innerHTML = '';

    if (!cierres || cierres.length === 0) {
      cierreZHistoryBody.innerHTML = `
        <tr>
          <td colspan="5" class="px-4 py-3 text-center text-gray-500 text-sm">
            No hay cierres Z registrados.
          </td>
        </tr>
      `;
      return;
    }

    cierres.forEach((cierre) => {
      const fechaRaw =
        cierre.fecha ||
        cierre.date ||
        cierre.created_at ||
        cierre.createdAt;

      let fechaTexto = '-';
      if (fechaRaw) {
        const d = new Date(fechaRaw);
        if (!isNaN(d.getTime())) {
          fechaTexto = d.toLocaleString('es-VE', {
            dateStyle: 'short',
            timeStyle: 'short'
          });
        }
      }

      const totalSistemaVes = Number(
        cierre.total_sistema_ves ||
        cierre.total_ves ||
        cierre.totalVes ||
        0
      );

      const totalSistemaUsd = Number(
        cierre.total_sistema_usd ||
        cierre.total_usd ||
        cierre.totalUsd ||
        0
      );

      const aperturaVes = Number(
        cierre.opening_ves ||
        cierre.apertura_ves ||
        0
      );

      const aperturaUsd = Number(
        cierre.opening_usd ||
        cierre.apertura_usd ||
        0
      );

      const notasFull = cierre.notes || cierre.notas || '';
      const notasCortas = notasFull
        ? (notasFull.length > 50 ? notasFull.slice(0, 50) + '…' : notasFull)
        : '';

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';

      tr.innerHTML = `
        <td class="px-4 py-2 text-xs text-gray-700 whitespace-nowrap">
          ${fechaTexto}
        </td>
        <td class="px-4 py-2 text-xs text-gray-800 text-right whitespace-nowrap">
          ${totalSistemaVes.toFixed(2)} Bs
          <br>
          <span class="text-gray-500">(${totalSistemaUsd.toFixed(2)} $)</span>
        </td>
        <td class="px-4 py-2 text-xs text-gray-800 text-right whitespace-nowrap">
          ${aperturaVes > 0 || aperturaUsd > 0
          ? `${aperturaVes.toFixed(2)} Bs / ${aperturaUsd.toFixed(2)} $`
          : '<span class="text-gray-400">–</span>'
        }
        </td>
        <td class="px-4 py-2 text-xs text-gray-600">
          ${notasCortas
          ? notasCortas
          : '<span class="text-gray-400">Sin notas</span>'
        }
        </td>
        <td class="px-4 py-2 text-xs text-right whitespace-nowrap">
          <button
            class="btn-open-cierre-z-pdf px-2 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            data-id="${cierre.id}"
          >
            Ver / Imprimir
          </button>
        </td>
      `;

      cierreZHistoryBody.appendChild(tr);
    });
  }

  function handleCierreZHistoryClick(event) {
    const pdfBtn = event.target.closest('.btn-open-cierre-z-pdf');
    if (!pdfBtn) return;

    const id = pdfBtn.dataset.id;
    if (!id) return;

    openCierreZPdf(id);
  }

  function openCierreZPdf(id) {
    // Endpoint esperado:
    // GET /api/reports/cierre-z/:id/pdf  -> PDF de ese cierre
    const a = document.createElement('a');
    a.href = `/api/reports/cierre-z/${id}/pdf`;
    a.download = `cierre-z-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // NUEVO: actualizar UI de paginación
  function updateCierreZHistoryPaginationUI() {
    if (cierreZHistoryPaginationInfo) {
      cierreZHistoryPaginationInfo.textContent =
        `Página ${cierreZHistoryCurrentPage} de ${cierreZHistoryTotalPages}`;
    }

    if (cierreZHistoryPrev) {
      const disabled = cierreZHistoryCurrentPage <= 1;
      cierreZHistoryPrev.disabled = disabled;
      cierreZHistoryPrev.classList.toggle('opacity-50', disabled);
      cierreZHistoryPrev.classList.toggle('cursor-not-allowed', disabled);
    }

    if (cierreZHistoryNext) {
      const disabled = cierreZHistoryCurrentPage >= cierreZHistoryTotalPages;
      cierreZHistoryNext.disabled = disabled;
      cierreZHistoryNext.classList.toggle('opacity-50', disabled);
      cierreZHistoryNext.classList.toggle('cursor-not-allowed', disabled);
    }
  }

  // --- MÉTODOS DE PAGO Y TASAS PERSONALIZADAS ---

  const formAddPaymentMethod = document.getElementById('form-add-payment-method');
  const paymentMethodsList = document.getElementById('payment-methods-list');
  const methodRateTypeSelect = document.getElementById('method-rate-type');
  const methodRateValueGroup = document.getElementById('method-rate-value-group');
  const methodCustomRateGroup = document.getElementById('method-custom-rate-group');
  const methodCustomRateSelect = document.getElementById('method-custom-rate-select');

  const formAddCustomRate = document.getElementById('form-add-custom-rate');
  const customRatesList = document.getElementById('custom-rates-list');

  // Toggle dynamic inputs based on rate type
  if (methodRateTypeSelect) {
    methodRateTypeSelect.addEventListener('change', () => {
      const type = methodRateTypeSelect.value;
      if (type === 'FIJA') {
        methodRateValueGroup.classList.remove('hidden');
        methodCustomRateGroup.classList.add('hidden');
      } else if (type === 'PERSONALIZADA') {
        methodRateValueGroup.classList.add('hidden');
        methodCustomRateGroup.classList.remove('hidden');
      } else {
        methodRateValueGroup.classList.add('hidden');
        methodCustomRateGroup.classList.add('hidden');
      }
    });
  }

  async function loadCustomRates() {
    if (!customRatesList) return;
    try {
      const response = await fetch('/api/custom-rates');
      if (!response.ok) throw new Error('No se pudieron cargar las tasas personalizadas');
      const rates = await response.json();
      
      // Render list
      customRatesList.innerHTML = '';
      if (rates.length === 0) {
        customRatesList.innerHTML = '<p class="text-xs text-gray-500 italic">No hay tasas creadas.</p>';
      } else {
        rates.forEach(r => {
          const div = document.createElement('div');
          div.className = 'flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-200 dark:border-gray-600 text-xs';
          div.innerHTML = `
            <div>
              <span class="font-bold text-gray-700 dark:text-gray-200">${r.nombre}</span>
              <span class="text-gray-500 block">Valor: ${r.valor.toFixed(2)} Bs/$</span>
            </div>
            <button type="button" class="btn-delete-custom-rate text-red-500 hover:text-red-700 font-bold px-2 py-1" data-id="${r.id}">
              Borrar
            </button>
          `;
          customRatesList.appendChild(div);
        });
      }

      // Populate select inside payment method form
      if (methodCustomRateSelect) {
        methodCustomRateSelect.innerHTML = '';
        rates.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.key;
          opt.textContent = `${r.nombre} (${r.valor.toFixed(2)} Bs/$)`;
          methodCustomRateSelect.appendChild(opt);
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function loadPaymentMethods() {
    if (!paymentMethodsList) return;
    try {
      const response = await fetch('/api/payment-methods');
      if (!response.ok) throw new Error('No se pudieron cargar los métodos de pago');
      const methods = await response.json();

      paymentMethodsList.innerHTML = '';
      methods.forEach(m => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-200 dark:border-gray-600 text-xs';
        
        let rateInfo = m.tipo_tasa;
        if (m.tipo_tasa === 'FIJA') rateInfo += ` (${m.tasa_valor})`;
        if (m.tipo_tasa === 'PERSONALIZADA') rateInfo += ` (${m.tasa_personalizada_key})`;

        const canDelete = !m.es_predeterminado;

        div.innerHTML = `
          <div>
            <span class="font-bold text-gray-700 dark:text-gray-200">${m.nombre}</span>
            <span class="text-gray-500 block">Moneda: ${m.moneda} | Tasa: ${rateInfo}</span>
          </div>
          ${canDelete ? `
            <button type="button" class="btn-delete-payment-method text-red-500 hover:text-red-700 font-bold px-2 py-1" data-id="${m.id}">
              Borrar
            </button>
          ` : '<span class="text-gray-400 italic text-[10px] px-2">Bloqueado</span>'}
        `;
        paymentMethodsList.appendChild(div);
      });
    } catch (err) {
      console.error(err);
    }
  }

  if (formAddCustomRate) {
    formAddCustomRate.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('rate-name').value;
      const value = parseFloat(document.getElementById('rate-value').value);
      
      try {
        const response = await fetch('/api/custom-rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre: name, valor: value })
        });
        const res = await response.json();
        if (!response.ok) throw new Error(res.error || 'Error al guardar');
        
        if (typeof window.parent.showToast === 'function') {
          window.parent.showToast('Tasa agregada con éxito', 'success');
        }
        formAddCustomRate.reset();
        await loadCustomRates();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  if (customRatesList) {
    customRatesList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-delete-custom-rate');
      if (!btn) return;
      const id = btn.dataset.id;
      if (!confirm('¿Seguro que desea eliminar esta tasa personalizada?')) return;

      try {
        const response = await fetch(`/api/custom-rates/${id}`, {
          method: 'DELETE'
        });
        const res = await response.json();
        if (!response.ok) throw new Error(res.error || 'Error al eliminar');

        if (typeof window.parent.showToast === 'function') {
          window.parent.showToast('Tasa personalizada eliminada', 'success');
        }
        await loadCustomRates();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  if (formAddPaymentMethod) {
    formAddPaymentMethod.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = document.getElementById('method-name').value;
      const moneda = document.getElementById('method-currency').value;
      const tipo_tasa = methodRateTypeSelect.value;
      let tasa_valor = null;
      let tasa_personalizada_key = null;

      if (tipo_tasa === 'FIJA') {
        tasa_valor = parseFloat(document.getElementById('method-rate-value').value);
      } else if (tipo_tasa === 'PERSONALIZADA') {
        tasa_personalizada_key = methodCustomRateSelect.value;
      }

      try {
        const response = await fetch('/api/payment-methods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre, moneda, tipo_tasa, tasa_valor, tasa_personalizada_key })
        });
        const res = await response.json();
        if (!response.ok) throw new Error(res.error || 'Error al guardar');

        if (typeof window.parent.showToast === 'function') {
          window.parent.showToast('Método de pago agregado', 'success');
        }
        formAddPaymentMethod.reset();
        methodRateValueGroup.classList.add('hidden');
        methodCustomRateGroup.classList.add('hidden');
        await loadPaymentMethods();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  if (paymentMethodsList) {
    paymentMethodsList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-delete-payment-method');
      if (!btn) return;
      const id = btn.dataset.id;
      if (!confirm('¿Seguro que desea eliminar este método de pago?')) return;

      try {
        const response = await fetch(`/api/payment-methods/${id}`, {
          method: 'DELETE'
        });
        const res = await response.json();
        if (!response.ok) throw new Error(res.error || 'Error al eliminar');

        if (typeof window.parent.showToast === 'function') {
          window.parent.showToast('Método de pago eliminado', 'success');
        }
        await loadPaymentMethods();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // ---------------- UTILIDAD MENSAJES ----------------

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

  // ---------------- ARRANQUE ----------------

  loadAndCheckLicense();
  formLicense.addEventListener('submit', handleLicenseActivate);

  if (btnCopyHwid) {
    btnCopyHwid.addEventListener('click', handleCopyHwid);
  }
});
