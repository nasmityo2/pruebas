document.addEventListener('DOMContentLoaded', () => {
    const updateModal = document.getElementById('update-modal');
    const versionTag = document.getElementById('update-version-tag');
    const descriptionText = document.getElementById('update-description');
    const changelogContainer = document.getElementById('changelog-container');
    const changelogList = document.getElementById('update-changelog');
    const btnStart = document.getElementById('btn-start-update');
    const btnLater = document.getElementById('btn-later-update');
    const btnClose = document.getElementById('btn-close-update');
    const progressContainer = document.getElementById('update-progress-container');
    const progressBar = document.getElementById('update-progress-bar');
    const progressPercent = document.getElementById('update-progress-percent');

    let updateInfo = null;

    async function checkUpdates() {
        try {
            if (localStorage.getItem('disableAutoUpdates') === 'true') {
                console.log('[UPDATER] Actualizaciones automáticas desactivadas.');
                return;
            }

            const res = await fetch('/api/license/check-update-status');
            const data = await res.json();

            if (data.hasUpdate && data.update) {
                const skipVersion = localStorage.getItem('skipUpdateVersion');
                if (skipVersion === data.update.version) {
                    console.log('[UPDATER] Omitiendo alerta automática para versión:', data.update.version);
                    return;
                }
                updateInfo = data.update;
                showUpdateModal(updateInfo);
            }
        } catch (error) {
            console.error('[UPDATER] Error verificando actualizaciones:', error);
        }
    }

    function showUpdateModal(info) {
        updateInfo = info;
        versionTag.textContent = info.version;
        if (info.description) descriptionText.textContent = info.description;
        
        if (info.changelog && info.changelog.length > 0) {
            changelogList.innerHTML = '';
            info.changelog.forEach(item => {
                const li = document.createElement('li');
                li.textContent = item;
                changelogList.appendChild(li);
            });
            changelogContainer.classList.remove('hidden');
        } else {
            changelogContainer.classList.add('hidden');
        }

        const chkSkip = document.getElementById('chk-skip-version');
        if (chkSkip) chkSkip.checked = false;

        updateModal.classList.remove('hidden');
    }

    // Exponer la función globalmente para que sea accesible desde el iframe de configuración
    window.showUpdateModal = showUpdateModal;

    btnLater.onclick = btnClose.onclick = () => {
        const chkSkip = document.getElementById('chk-skip-version');
        if (chkSkip && chkSkip.checked && updateInfo) {
            localStorage.setItem('skipUpdateVersion', updateInfo.version);
        }
        updateModal.classList.add('hidden');
    };

    btnStart.onclick = async () => {
        if (!updateInfo || !updateInfo.downloadUrl) return;

        btnStart.disabled = true;
        btnLater.classList.add('hidden');
        progressContainer.classList.remove('hidden');
        btnStart.textContent = 'Iniciando descarga...';

        try {
            // Llamar al backend para iniciar la descarga
            const res = await fetch('/api/utils/download-update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: updateInfo.downloadUrl })
            });

            if (!res.ok) throw new Error('Fallo al iniciar descarga');

            // Iniciar polling de progreso
            pollProgress();

        } catch (error) {
            alert('Error al iniciar la actualización: ' + error.message);
            btnStart.disabled = false;
            btnStart.textContent = 'Reintentar Actualización';
            progressContainer.classList.add('hidden');
            btnLater.classList.remove('hidden');
        }
    };

    async function pollProgress() {
        const interval = setInterval(async () => {
            try {
                const res = await fetch('/api/utils/download-progress');
                const data = await res.json();

                if (data.percent !== undefined) {
                    const p = Math.round(data.percent);
                    progressBar.style.width = p + '%';
                    progressPercent.textContent = p + '%';
                    btnStart.textContent = `Descargando (${p}%)`;

                    if (data.completed) {
                        clearInterval(interval);
                        btnStart.textContent = 'Instalando...';
                        // Ejecutar actualización
                        await fetch('/api/utils/execute-update', { method: 'POST' });
                    }
                }
            } catch (e) {
                console.error('Error polling progress:', e);
            }
        }, 1000);
    }

    // Verificar actualizaciones al iniciar (con un pequeño delay)
    setTimeout(checkUpdates, 5000);
    
    // Y luego cada 30 minutos
    setInterval(checkUpdates, 30 * 60 * 1000);
});
