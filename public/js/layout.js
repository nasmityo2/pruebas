// ---------- MODALES GLOBALES (ALERTA / CONFIRMAR) ----------

function getGlobalAlertModalElements() {
  const modal = document.getElementById('global-alert-modal');
  const titleEl = document.getElementById('global-alert-title');
  const messageEl = document.getElementById('global-alert-message');
  const btnCloseX = document.getElementById('btn-close-global-alert');
  const btnOk = document.getElementById('btn-global-ok');
  const btnCancel = document.getElementById('btn-global-cancel');

  if (!modal || !titleEl || !messageEl || !btnCloseX || !btnOk || !btnCancel) {
    console.warn('Modal de alerta global no encontrado o incompleto en index.html.');
    return null;
  }

  return { modal, titleEl, messageEl, btnCloseX, btnOk, btnCancel };
}

window.openSystemAlert = function (message, title) {
  const els = getGlobalAlertModalElements();
  if (!els) {
    console.log('ALERTA:', message);
    return Promise.resolve(true);
  }

  const { modal, titleEl, messageEl, btnOk, btnCloseX, btnCancel } = els;

  titleEl.textContent = title || 'Alerta del Sistema';
  messageEl.textContent = String(message || '');
  btnCancel.classList.add('hidden');

  return new Promise((resolve) => {
    const close = () => {
      modal.classList.add('hidden');
      btnOk.removeEventListener('click', onOk);
      btnCloseX.removeEventListener('click', onClose);
      modal.removeEventListener('click', onBackdrop);
      resolve(true);
    };

    const onOk = () => close();
    const onClose = () => close();
    const onBackdrop = (e) => {
      if (e.target === modal) close();
    };

    btnOk.addEventListener('click', onOk);
    btnCloseX.addEventListener('click', onClose);
    modal.addEventListener('click', onBackdrop);

    modal.classList.remove('hidden');
  });
};

window.openSystemConfirm = function (message, title) {
  const els = getGlobalAlertModalElements();
  if (!els) {
    console.log('CONFIRM (sin modal disponible):', message);
    return Promise.resolve(true);
  }

  const { modal, titleEl, messageEl, btnOk, btnCloseX, btnCancel } = els;

  titleEl.textContent = title || 'Confirmar acción';
  messageEl.textContent = String(message || '');
  btnCancel.classList.remove('hidden');

  return new Promise((resolve) => {
    const close = (result) => {
      modal.classList.add('hidden');
      btnOk.removeEventListener('click', onOk);
      btnCloseX.removeEventListener('click', onClose);
      btnCancel.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      resolve(result);
    };

    const onOk = () => close(true);
    const onClose = () => close(false);
    const onCancel = () => close(false);
    const onBackdrop = (e) => {
      if (e.target === modal) close(false);
    };

    btnOk.addEventListener('click', onOk);
    btnCloseX.addEventListener('click', onClose);
    btnCancel.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);

    modal.classList.remove('hidden');
  });
};

// ---------- LÓGICA ORIGINAL DEL LAYOUT ----------

let globalLicenseStatus = 'UNKNOWN';

document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    const iframe = document.getElementById('content-frame');

    try {
      const response = await fetch('/api/license/info');
      // Si la respuesta no es OK, podría ser error 500, pero no necesariamente "EXPIRED"
      if (!response.ok) {
        console.warn('Advertencia: El servidor de licencias local respondió con error ' + response.status);
        // No lanzamos error aquí para permitir que la UI cargue con estado UNKNOWN en vez de bloquear
      }

      const data = await response.json();

      if (data.status === 'EXPIRED') {
        console.warn('Licencia o prueba expirada, redirigiendo iframe a configuracion.html');
        globalLicenseStatus = 'EXPIRED';
        if (iframe) {
          // Solo redirigir si NO estamos ya ahí
          if (!iframe.src.includes('configuracion.html')) {
            iframe.src = 'configuracion.html';
          }
        }
      } else {
        globalLicenseStatus = data.status; // 'LICENSED' o 'TRIAL'
        console.log('Estado de Licencia:', globalLicenseStatus);
      }
    } catch (error) {
      console.error('Error en la verificación global de licencia (red/server):', error);
      // NO forzamos "EXPIRED" aquí. Si falla la red local, asumimos que puede seguir funcionando lo básico
      // o que es un error temporal. Bloquear por error de red es mala UX.
      globalLicenseStatus = 'UNKNOWN';
    }
  })();

  loadSidebar();
  loadTopbar();
  loadAndApplyBusinessSettings();

  const mobileModal = document.getElementById('mobile-modal');
  const closeMobileModal = document.getElementById('close-mobile-modal');
  const closeMobileModalBtn = document.getElementById('close-mobile-modal-btn');

  const closeAction = () => {
    if (mobileModal) {
      mobileModal.classList.add('hidden');
    }
  };

  if (mobileModal) {
    mobileModal.addEventListener('click', (event) => {
      if (event.target === mobileModal) {
        closeAction();
      }
    });
  }

  // --- New Feature Notification: Flexible Import ---
  if (!localStorage.getItem('flexible_import_ack_v1_5_2')) {
    setTimeout(() => {
      window.openSystemAlert(
        '¡NUEVO! Hemos mejorado el sistema de importación.\n\n' +
        '- Compatible con Excel (.xlsx) y CSV.\n' +
        '- Columnas flexibles (no requiere nombres exactos).\n' +
        '- Valores opcionales (Activo, Ganancia, Categoría automáticos).\n' +
        '- Carga de bultos inteligente.\n\n' +
        '¡Plantilla de importación ahora es solo una guía!',
        'Mejora de Importación (v1.5.2)'
      ).then(() => {
        localStorage.setItem('flexible_import_ack_v1_5_2', 'true');
      });
    }, 2500);
  }

  // --- Promotion Notification: Power Outage Contingency Support ---
  const todayStr = new Date().toISOString().split('T')[0];
  const isPermanentlyDismissed = localStorage.getItem('promo_online_ack_v1') === 'true';
  const wasAlreadyShownToday = localStorage.getItem('promo_online_last_shown_date') === todayStr;

  if (!isPermanentlyDismissed && !wasAlreadyShownToday) {
    setTimeout(() => {
      showPromoModal();
    }, 2500);
  }
});

function showPromoModal() {
  const modalId = 'promo-online-modal';
  if (document.getElementById(modalId)) return;

  // Mark as shown today immediately upon displaying so it doesn't show again today
  const todayStr = new Date().toISOString().split('T')[0];
  localStorage.setItem('promo_online_last_shown_date', todayStr);

  const isDarkMode = document.body.classList.contains('dark-mode');

  const modalHtml = `
    <div id="${modalId}" class="fixed inset-0 bg-slate-900/75 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300 opacity-0 ${isDarkMode ? 'dark' : ''}">
      <div class="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-2xl border border-yellow-500/20 max-w-md w-full relative overflow-hidden transform scale-95 transition-transform duration-300 mx-4">
        <!-- Background Glow -->
        <div class="absolute -right-16 -top-16 w-36 h-36 bg-yellow-500/10 rounded-full blur-2xl pointer-events-none"></div>
        <div class="absolute -left-16 -bottom-16 w-36 h-36 bg-green-500/10 rounded-full blur-2xl pointer-events-none"></div>
        
        <div class="text-center relative z-10">
          <!-- Gift Icon Badge -->
          <div class="inline-flex items-center justify-center p-4 bg-gradient-to-tr from-yellow-500 to-amber-400 text-white rounded-2xl shadow-xl shadow-yellow-500/30 mb-5 transform hover:scale-110 transition-transform duration-300">
            <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5a2 2 0 10-2 2h2zm-2 4h4m6 0v10a2 2 0 01-2 2H6a2 2 0 01-2-2V11m16 0V9a2 2 0 00-2-2h-3m-9 4V9a2 2 0 012-2h3m0 0V5a2 2 0 012-2h2a2 2 0 012 2v2m-6 4h6"></path>
            </svg>
          </div>
          
          <h2 class="text-2xl font-black text-slate-800 dark:text-white tracking-tight mb-3">
            Apoyo por Contingencia 🎁
          </h2>
          
          <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-5 text-center">
            Debido a los cortes prolongados de luz causados por fenómenos climáticos, queremos apoyarte a mantener tu negocio activo y sincronizado sin interrupciones.
          </p>
          
          <!-- Offer Box -->
          <div class="bg-gradient-to-r from-yellow-500/10 to-amber-500/10 border border-yellow-500/20 rounded-2xl p-4 mb-6 shadow-inner">
            <p class="text-xs text-yellow-600 dark:text-yellow-400 font-bold uppercase tracking-wider mb-1">
              Promoción Especial
            </p>
            <p class="text-xl font-extrabold text-slate-800 dark:text-white leading-tight">
              6 Meses de Stokko Online
            </p>
            <p class="text-2xl font-black text-green-600 dark:text-green-400 mt-1">
              por tan solo 20$ <span class="text-sm font-semibold text-slate-500 dark:text-slate-400">(a tasa BCV)</span>
            </p>
          </div>
          
          <!-- Actions -->
          <div class="flex flex-col gap-3">
            <a href="https://wa.me/584167713802?text=Hola!%20Quiero%20adquirir%20la%20promoci%C3%B3n%20especial%20de%206%20meses%20de%20Stokko%20Online%20por%2020%20d%C3%B3lares."
               target="_blank" 
               id="btn-promo-whatsapp"
               class="flex items-center justify-center gap-2 w-full py-3.5 px-6 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold rounded-2xl shadow-lg shadow-green-500/25 transition-all hover:scale-[1.02] active:scale-[0.98]">
              <!-- WhatsApp Icon SVG -->
              <svg class="w-6 h-6 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Contactar por WhatsApp
            </a>
            
            <button id="btn-promo-close" 
                    class="w-full py-3 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-400 font-semibold text-sm transition-colors rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800">
              Ahora no, gracias
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modal = document.getElementById(modalId);
  const card = modal.querySelector('div');
  const btnClose = document.getElementById('btn-promo-close');
  const btnWhatsapp = document.getElementById('btn-promo-whatsapp');

  const closePromo = (permanent = false) => {
    modal.classList.add('opacity-0');
    card.classList.add('scale-95');
    setTimeout(() => {
      modal.remove();
    }, 300);
    if (permanent) {
      localStorage.setItem('promo_online_ack_v1', 'true');
    }
  };

  btnClose.addEventListener('click', () => closePromo(false));
  btnWhatsapp.addEventListener('click', (e) => {
    const url = btnWhatsapp.getAttribute('href');
    if (window.electronShell && typeof window.electronShell.openExternal === 'function') {
      e.preventDefault();
      window.electronShell.openExternal(url);
    }
    closePromo(true);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closePromo(false);
    }
  });

  setTimeout(() => {
    modal.classList.remove('opacity-0');
    card.classList.remove('scale-95');
  }, 50);
}

window.reloadLayout = () => {
  loadAndApplyBusinessSettings();
};

async function loadAndApplyBusinessSettings() {
  try {
    const response = await fetch('/api/settings/business');
    if (!response.ok) throw new Error('No se pudo cargar la config. del negocio');
    const settings = await response.json();
    window.appSettings = settings; // Expose settings to child iframes like pos.html
    
    const businessName = settings.businessName || 'Stokko';
    const nameElements = document.querySelectorAll('.brand-name');
    nameElements.forEach((el) => {
      el.textContent = businessName;
      
      if (!el.closest('#sidebar')) {
        el.style.removeProperty('font-size');
        el.style.setProperty('white-space', 'nowrap', 'important');
        el.style.setProperty('word-break', 'normal', 'important');
        return;
      }

      const hasSpaces = businessName.trim().includes(' ');
      
      if (!hasSpaces) {
        // Palabra única: NUNCA dividir a la mitad, solo encoger la fuente
        el.style.setProperty('white-space', 'nowrap', 'important');
        el.style.setProperty('word-break', 'normal', 'important');
        
        const len = businessName.length;
        if (len > 15) {
          el.style.setProperty('font-size', '0.9rem', 'important');
        } else if (len > 11) {
          el.style.setProperty('font-size', '1.1rem', 'important');
        } else if (len > 8) {
          el.style.setProperty('font-size', '1.35rem', 'important');
        } else {
          el.style.setProperty('font-size', '1.75rem', 'important'); // 2xl predeterminado
        }
      } else {
        // Múltiples palabras: permitir salto de línea SOLO en espacios
        el.style.setProperty('white-space', 'normal', 'important');
        el.style.setProperty('word-break', 'normal', 'important');
        
        const words = businessName.split(/\s+/);
        const longestWordLen = Math.max(...words.map(w => w.length));
        const totalLen = businessName.length;
        
        let fontSize = '1.75rem';
        if (longestWordLen > 15 || totalLen > 30) {
          fontSize = '0.95rem';
        } else if (longestWordLen > 11 || totalLen > 22) {
          fontSize = '1.15rem';
        } else if (longestWordLen > 8 || totalLen > 14) {
          fontSize = '1.35rem';
        }
        
        el.style.setProperty('font-size', fontSize, 'important');
      }
    });

    const logoElements = document.querySelectorAll('.brand-logo');
    logoElements.forEach((el) => {
      if (settings.logoPath) {
        el.src = `${settings.logoPath}?t=${new Date().getTime()}`;
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });
  } catch (error) {
    console.error('Error al aplicar la config. del negocio:', error);
    document.querySelectorAll('.brand-name').forEach((el) => {
      el.textContent = 'Stokko';
      el.style.fontSize = '';
    });
    document.querySelectorAll('.brand-logo').forEach((el) => {
      el.classList.add('hidden');
    });
  }
}

// =========================
// KEYBOARD SHORTCUTS BRIDGE
// =========================
// This bridges key events from the parent window (index.html, topbar, sidebar)
// into the active iframe so shortcuts work regardless of focus.
document.addEventListener('keydown', (e) => {
  const iframe = document.getElementById('content-frame');
  if (iframe && iframe.contentWindow) {
    // Only forward keys we care about
    const relevantKeys = ['F1', 'F2', 'F3', 'F4', 'F7', 'F8', 'F9', 'F10', 'F12', 'Escape', 'ArrowUp', 'ArrowDown'];
    if (relevantKeys.includes(e.key)) {
      iframe.contentWindow.postMessage({
        type: 'KEYBOARD_SHORTCUT',
        key: e.key
      }, '*');
      e.preventDefault(); // Prevent default browser actions for F-keys on parent
    }
  }
});

async function loadTopbar() {
  const container = document.getElementById('topbar-container');
  if (!container) return;
  try {
    const response = await fetch('topbar.html');
    if (!response.ok) throw new Error('No se pudo cargar la barra superior');
    container.innerHTML = await response.text();

    const hamburgerButton = document.getElementById('hamburger-button');
    if (hamburgerButton) {
      hamburgerButton.addEventListener('click', openSidebar);
    }

    await loadAndApplyBusinessSettings();
  } catch (error) {
    console.error('Error cargando topbar:', error);
  }
}

function toggleDesktopSidebar() {
  const sidebar = document.getElementById('sidebar');
  const sidebarWrapper = document.getElementById('sidebar-wrapper');
  const iconCollapse = document.getElementById('icon-collapse');
  const iconExpand = document.getElementById('icon-expand');

  if (!sidebar || !sidebarWrapper || !iconCollapse || !iconExpand) return;

  sidebar.classList.toggle('w-64');
  sidebar.classList.toggle('w-20');
  sidebarWrapper.classList.toggle('sidebar-collapsed');

  if (sidebar.classList.contains('w-20')) {
    iconCollapse.classList.add('hidden');
    iconExpand.classList.remove('hidden');
    localStorage.setItem('sidebarCollapsed', 'true');
  } else {
    iconCollapse.classList.remove('hidden');
    iconExpand.classList.add('hidden');
    localStorage.setItem('sidebarCollapsed', 'false');
  }
}

function initDesktopSidebarState() {
  if (localStorage.getItem('sidebarCollapsed') === 'true') {
    toggleDesktopSidebar();
  }
}

async function loadSidebar() {
  const container = document.getElementById('sidebar-container');
  if (!container) return;
  try {
    const response = await fetch('sidebar.html');
    if (!response.ok) throw new Error('No se pudo cargar la barra lateral');
    container.innerHTML = await response.text();

    document.getElementById('close-sidebar-button')?.addEventListener('click', closeSidebar);
    document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);
    document.getElementById('sidebar-toggle-button')?.addEventListener('click', toggleDesktopSidebar);
    document.getElementById('mobile-instructions-button')?.addEventListener('click', openMobileModal);

    highlightActiveLink();
    await loadAndApplyBusinessSettings();
    initDesktopSidebarState();
  } catch (error) {
    console.error('Error cargando sidebar:', error);
  }
}

function openSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) {
    sidebar.classList.remove('-translate-x-full');
  }
  if (overlay) {
    overlay.classList.remove('hidden');
  }
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) {
    sidebar.classList.add('-translate-x-full');
  }
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

function highlightActiveLink() {
  const links = document.querySelectorAll('#sidebar a.sidebar-link');
  const contentFrame = document.getElementById('content-frame');

  const updateHighlight = (targetHref) => {
    links.forEach((link) => {
      // RESET to inactive state
      link.classList.remove('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-500/20');
      link.classList.add('text-slate-400', 'hover:bg-slate-800', 'hover:text-white');

      if (link.getAttribute('href') === targetHref) {
        // SET to active state
        link.classList.remove('text-slate-400', 'hover:bg-slate-800', 'hover:text-white');
        link.classList.add('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-500/20');
      }
    });
  };

  const defaultPage = contentFrame ? contentFrame.getAttribute('src') : 'inventario.html';
  if (globalLicenseStatus !== 'EXPIRED') {
    updateHighlight(defaultPage);
  } else {
    updateHighlight('configuracion.html');
  }

  links.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetHref = e.currentTarget.getAttribute('href');

      if (globalLicenseStatus === 'EXPIRED' && targetHref !== 'configuracion.html') {
        console.warn('Acceso denegado. Licencia expirada. Redirigiendo a Configuración.');
        contentFrame.src = 'configuracion.html';
        updateHighlight('configuracion.html');
        closeSidebar();
        return;
      }

      contentFrame.src = targetHref;
      updateHighlight(targetHref);
      closeSidebar();
    });
  });

  if (contentFrame) {
    contentFrame.addEventListener('load', () => {
      const currentFrameSrc = new URL(contentFrame.src).pathname.split('/').pop();

      if (globalLicenseStatus === 'EXPIRED' && currentFrameSrc !== 'configuracion.html') {
        console.warn('Acceso denegado. Licencia expirada. Forzando redirección a Configuración.');
        contentFrame.src = 'configuracion.html';
        updateHighlight('configuracion.html');
        return;
      }

      updateHighlight(currentFrameSrc);
    });
  }
}

async function openMobileModal() {
  const mobileModal = document.getElementById('mobile-modal');
  if (!mobileModal) return;

  const ipDisplayElement = mobileModal.querySelector('#local-ip-urls');
  const qrCodeImage = mobileModal.querySelector('#qr-code-image');
  const qrCodeLoading = mobileModal.querySelector('#qr-code-loading');

  if (!ipDisplayElement || !qrCodeImage || !qrCodeLoading) {
    mobileModal.classList.remove('hidden');
    return;
  }

  ipDisplayElement.innerHTML = '<span class="text-gray-500 text-sm">Obteniendo dirección...</span>';
  qrCodeImage.classList.add('hidden');
  qrCodeLoading.textContent = 'Generando QR...';
  qrCodeLoading.classList.remove('hidden');

  // Puerto REAL con el que se abrió la app (portfinder en main.js)
  const currentPort = window.location.port || '';

  try {
    // 👇 ahora enviamos el puerto al backend
    const response = await fetch('/api/utils/local-ip?port=' + encodeURIComponent(currentPort));
    const data = await response.json();

    if (data.lanEnabled === false) {
      ipDisplayElement.innerHTML =
        '<span class="text-amber-600 text-sm">El acceso desde el móvil está <strong>desactivado</strong>. Actívalo en <strong>Configuración → Acceso móvil</strong> (requiere reiniciar la app).</span>';
      qrCodeLoading.textContent = 'QR no disponible hasta activar el acceso móvil.';
      qrCodeLoading.classList.remove('hidden');
      qrCodeImage.classList.add('hidden');
    } else if (data.success && Array.isArray(data.urls) && data.urls.length > 0) {
      ipDisplayElement.innerHTML = '';
      const note = document.createElement('p');
      note.className = 'text-xs text-gray-500 mb-1';
      note.textContent = 'Enlace temporal (expira). Vuelve a abrir esta ventana si caduca.';
      ipDisplayElement.appendChild(note);

      data.urls.forEach((url) => {
        const strong = document.createElement('strong');
        strong.className = 'block text-blue-600 break-all font-mono py-1';
        strong.textContent = url;
        ipDisplayElement.appendChild(strong);
      });

      // El backend ya genera el QR con el puerto correcto
      if (data.qrCodeDataURL) {
        qrCodeImage.src = data.qrCodeDataURL;
        qrCodeImage.classList.remove('hidden');
        qrCodeLoading.classList.add('hidden');
      } else {
        qrCodeLoading.textContent = 'Error al generar QR.';
        qrCodeLoading.classList.remove('hidden');
        qrCodeImage.classList.add('hidden');
      }
    } else {
      ipDisplayElement.innerHTML =
        '<span class="text-red-500 text-sm">No se pudo obtener la IP local. Revisa tu conexión de red.</span>';
      qrCodeLoading.textContent = 'QR no disponible.';
      qrCodeLoading.classList.remove('hidden');
      qrCodeImage.classList.add('hidden');
    }
  } catch (e) {
    console.error('Error fetching local IP:', e);
    ipDisplayElement.innerHTML =
      '<span class="text-red-500 text-sm">Error al contactar el servidor para obtener la IP.</span>';
    qrCodeLoading.textContent = 'Error.';
    qrCodeLoading.classList.remove('hidden');
    qrCodeImage.classList.add('hidden');
  }

  mobileModal.classList.remove('hidden');
}


window.askForAdminPassword = () => {
  return new Promise(async (resolve, reject) => {
    const response = await fetch('/api/auth/status');
    const data = await response.json();

    if (!data.isPasswordEnabled) {
      resolve(true);
      return;
    }

    const modal = document.getElementById('admin-password-modal');
    const form = document.getElementById('form-verify-password');
    const cancelButton = document.getElementById('btn-cancel-verification');
    const passwordInput = document.getElementById('verify-password-input');
    const statusElement = document.getElementById('verify-password-status');

    if (!modal || !form || !cancelButton || !passwordInput || !statusElement) {
      console.error('Elementos del modal de contraseña no encontrados en index.html.');
      reject(new Error('Modal de contraseña no implementado.'));
      return;
    }

    const closePasswordModal = () => {
      modal.classList.add('hidden');
      form.onsubmit = null;
      cancelButton.onclick = null;
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const password = passwordInput.value;
      statusElement.textContent = 'Verificando...';
      statusElement.className = 'text-sm mt-3 text-center text-gray-600';

      try {
        const verifyResponse = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password }),
        });
        const result = await verifyResponse.json();

        if (!verifyResponse.ok) {
          throw new Error(result.error || 'Error desconocido');
        }

        statusElement.textContent = '¡Éxito!';
        statusElement.className = 'text-sm mt-3 text-center text-green-600';
        setTimeout(() => {
          closePasswordModal();
          resolve(true);
        }, 500);
      } catch (error) {
        statusElement.textContent = `Error: ${error.message}`;
        statusElement.className = 'text-sm mt-3 text-center text-red-600';
      }
    };

    cancelButton.onclick = () => {
      closePasswordModal();
      resolve(false);
    };

    passwordInput.value = '';
    statusElement.textContent = '';
    modal.classList.remove('hidden');
    passwordInput.focus();
  });
};
