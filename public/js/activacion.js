// Pantalla de activación (gate). Bloquea la app hasta tener licencia/trial válido.
(function () {
    const hwidInput = document.getElementById('hwid');
    const statusBanner = document.getElementById('status-banner');
    const form = document.getElementById('activate-form');
    const keyInput = document.getElementById('license-key');
    const btnActivate = document.getElementById('btn-activate');
    const btnTrial = document.getElementById('btn-trial');
    const btnCopy = document.getElementById('btn-copy-hwid');
    const msg = document.getElementById('gate-message');

    function showMessage(text, type) {
        if (!msg) return;
        msg.textContent = text;
        msg.classList.remove('hidden', 'text-red-600', 'text-green-600', 'text-gray-600');
        msg.classList.add(type === 'error' ? 'text-red-600' : type === 'success' ? 'text-green-600' : 'text-gray-600');
    }

    function goToApp() {
        // El servidor ya no redirige a la activación una vez licenciado.
        window.location.href = '/index.html';
    }

    async function loadStatus() {
        try {
            const res = await fetch('/api/license/info');
            const data = await res.json();
            if (hwidInput) hwidInput.value = data.hardwareId || 'No disponible';
            if (data.status === 'LICENSED' || data.status === 'TRIAL') {
                statusBanner.textContent = data.message || 'Licencia activa. Redirigiendo...';
                goToApp();
                return;
            }
            statusBanner.textContent = data.message || 'Se requiere activar una licencia válida.';
        } catch (e) {
            statusBanner.textContent = 'No se pudo verificar el estado. Reintenta.';
        }
    }

    if (btnCopy) {
        btnCopy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(hwidInput.value || '');
                btnCopy.textContent = '¡Copiado!';
                setTimeout(() => { btnCopy.textContent = 'Copiar'; }, 1500);
            } catch (_) { /* noop */ }
        });
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const licenseKey = (keyInput.value || '').trim().toUpperCase();
            if (!licenseKey) { showMessage('Ingresa tu clave de licencia.', 'error'); return; }

            btnActivate.disabled = true;
            btnActivate.textContent = 'Activando...';
            showMessage('Contactando el servidor de licencias...', 'info');
            try {
                const res = await fetch('/api/license/activate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ licenseKey })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    showMessage('¡Activado con éxito! Abriendo BodegApp...', 'success');
                    setTimeout(goToApp, 900);
                } else {
                    showMessage(data.message || 'No se pudo activar.', 'error');
                    btnActivate.disabled = false;
                    btnActivate.textContent = 'Activar';
                }
            } catch (err) {
                showMessage('Error de conexión con el servidor de licencias.', 'error');
                btnActivate.disabled = false;
                btnActivate.textContent = 'Activar';
            }
        });
    }

    if (btnTrial) {
        btnTrial.addEventListener('click', async () => {
            btnTrial.disabled = true;
            btnTrial.textContent = 'Iniciando prueba...';
            showMessage('Solicitando prueba al servidor...', 'info');
            try {
                const res = await fetch('/api/license/start-trial', { method: 'POST' });
                const data = await res.json();
                if (res.ok && data.success) {
                    showMessage('Prueba iniciada. Abriendo BodegApp...', 'success');
                    setTimeout(goToApp, 900);
                } else {
                    showMessage(data.message || 'No se pudo iniciar la prueba.', 'error');
                    btnTrial.disabled = false;
                    btnTrial.textContent = 'Iniciar prueba de 72 horas';
                }
            } catch (err) {
                showMessage('Error de conexión con el servidor de licencias.', 'error');
                btnTrial.disabled = false;
                btnTrial.textContent = 'Iniciar prueba de 72 horas';
            }
        });
    }

    loadStatus();
})();
